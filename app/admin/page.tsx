// app/admin/series/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  usePublicClient,
  useWatchContractEvent,
} from "wagmi";
import { Card } from "@heroui/card";
import { Link } from "@heroui/link";
import { Checkbox } from "@heroui/checkbox";
import { Input } from "@heroui/input";
import { Spinner } from "@heroui/spinner";
import { Skeleton } from "@heroui/skeleton";
import { parseAbiItem } from "viem";

import DefineSeriesForm from "@/components/DefineSeriesForm";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { ALL_TOKENS } from "@/lib/token";

const SERIES_ADMIN_ROLE =
  "0x31614bb72d45cac63afb2594a1e18378fbabc0e1821b20fb54a1e918334a268a" as const;

// event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

type SeriesRow = {
  id: bigint;
  underlying: `0x${string}`;
  strike: bigint;       // 1e18 WXDAI
  expiry: bigint;       // unix seconds
  txHash: `0x${string}`;
  blockNumber: bigint;
};

function symFromAddress(addr: string): string {
  const t = ALL_TOKENS.find((x) => x.address.toLowerCase() === addr.toLowerCase());
  return t ? t.symbol : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatStrike(n: bigint): string {
  const s = n.toString().padStart(19, "0");
  const head = s.slice(0, -18) || "0";
  const tail = s.slice(-18).replace(/0+$/, "");
  return tail.length ? `${head}.${tail}` : head;
}

function formatDateUTC(ts: bigint): string {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER || "https://gnosisscan.io";
const ENV_DEPLOY_BLOCK = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK!)
  : undefined;

export default function AdminDefineSeriesPage() {
  const { address, isConnected } = useAccount();

  // Non-blocking role check
  const { data: isAdmin, isLoading } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "hasRole",
    args: [
      SERIES_ADMIN_ROLE,
      (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
    ],
    query: { enabled: Boolean(address) },
  });

  // --- Series table state ---
  const client = usePublicClient();
  const [rows, setRows] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [latestBlock, setLatestBlock] = useState<bigint>(0n);
  const [fromBlockOverride, setFromBlockOverride] = useState<string>("");
  const [showExpired, setShowExpired] = useState<boolean>(true);

  // Loader progress UI
  const [scanFrom, setScanFrom] = useState<bigint | null>(null);
  const [scanTo, setScanTo] = useState<bigint | null>(null);
  const [scanAt, setScanAt] = useState<bigint | null>(null);
  const progressPct = useMemo(() => {
    if (!scanFrom || !scanTo || !scanAt) return 0;
    const span = Number(scanTo - scanFrom);
    const done = Number((scanAt > scanTo ? scanTo : scanAt) - scanFrom);
    if (span <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round((done / span) * 100)));
  }, [scanFrom, scanTo, scanAt]);

  // Backfill (chunked getLogs) — re-runs when fromBlockOverride changes
  useEffect(() => {
    if (!client) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setRows([]); // reset table for new scan
        setScanFrom(null);
        setScanTo(null);
        setScanAt(null);

        const latest = await client.getBlockNumber();
        if (cancelled) return;
        setLatestBlock(latest);

        const override = fromBlockOverride.trim();
        const hasOverride = override.length > 0 && /^\d+$/.test(override);
        const DEFAULT_SPAN = 200_000n;
        const fromBlock = hasOverride
          ? BigInt(override)
          : ENV_DEPLOY_BLOCK !== undefined
          ? ENV_DEPLOY_BLOCK
          : latest > DEFAULT_SPAN
          ? latest - DEFAULT_SPAN
          : 0n;

        const step = 10_000n; // conservative chunk size
        setScanFrom(fromBlock);
        setScanTo(latest);

        const acc: SeriesRow[] = [];

        for (let start = fromBlock; start <= latest; start += step + 1n) {
          if (cancelled) return;
          const end = start + step > latest ? latest : start + step;
          setScanAt(end);

          const logs = await client.getLogs({
            address: VAULT_ADDRESS,
            event: SERIES_DEFINED,
            fromBlock: start,
            toBlock: end,
          });

          for (const l of logs) {
            acc.push({
              id: l.args.id as bigint,
              underlying: l.args.underlying as `0x${string}`,
              strike: l.args.strike as bigint,
              expiry: l.args.expiry as bigint,
              txHash: l.transactionHash!,
              blockNumber: l.blockNumber!,
            });
          }
        }

        // de-dup + sort
        const map = new Map<string, SeriesRow>();
        for (const r of acc) map.set(r.id.toString(), r);
        const list = Array.from(map.values()).sort((a, b) =>
          a.expiry === b.expiry
            ? Number(b.blockNumber - a.blockNumber)
            : Number(b.expiry - a.expiry)
        );

        if (!cancelled) setRows(list);
      } catch (err) {
        if (!cancelled) console.error("Series backfill error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, fromBlockOverride]);

  // Live watcher
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setRows((prev) => {
        const map = new Map<string, SeriesRow>();
        for (const r of prev) map.set(r.id.toString(), r);
        for (const l of logs) {
          map.set((l.args?.id as bigint).toString(), {
            id: l.args?.id as bigint,
            underlying: l.args?.underlying as `0x${string}`,
            strike: l.args?.strike as bigint,
            expiry: l.args?.expiry as bigint,
            txHash: l.transactionHash!,
            blockNumber: l.blockNumber!,
          });
        }
        const list = Array.from(map.values()).sort((a, b) =>
          a.expiry === b.expiry
            ? Number(b.blockNumber - a.blockNumber)
            : Number(b.expiry - a.expiry)
        );
        return list;
      });
    },
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const displayRows = useMemo(
    () => (showExpired ? rows : rows.filter((r) => Number(r.expiry) > nowSec)),
    [rows, showExpired, nowSec]
  );

  const scanning = loading && (scanFrom !== null && scanTo !== null);

  return (
    <section className="mx-auto max-w-5xl py-8 md:py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin — Define Option Series</h1>
        <p className="text-default-500">
          Create new option series for the vault. (Requires on-chain{" "}
          <span className="font-mono">SERIES_ADMIN_ROLE</span>.)
        </p>
      </div>

      {!isConnected && (
        <Card className="p-5">
          <p>Please connect your wallet to continue.</p>
        </Card>
      )}

      {isConnected && (
        <>
          {!isLoading && isAdmin === false && (
            <Card className="p-4 border-warning text-warning">
              <p>
                You’re connected as <span className="font-mono">{address}</span>, but this
                address does not have <span className="font-mono">SERIES_ADMIN_ROLE</span>. You can
                fill the form; transactions will revert if the role is missing.
              </p>
            </Card>
          )}
          <DefineSeriesForm />
        </>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Checkbox
          isSelected={showExpired}
          onValueChange={setShowExpired}
          className="text-sm"
          isDisabled={loading}
        >
          Show expired
        </Checkbox>

        <div className="flex items-center gap-2 text-sm">
          <span>From block:</span>
          <Input
            type="number"
            size="sm"
            placeholder={
              ENV_DEPLOY_BLOCK !== undefined ? ENV_DEPLOY_BLOCK.toString() : "auto"
            }
            value={fromBlockOverride}
            onChange={(e) => setFromBlockOverride(e.target.value)}
            classNames={{ inputWrapper: "h-9 bg-default-100", input: "text-sm" }}
            isDisabled={loading}
          />
        </div>

        <div className="ml-auto text-xs text-default-500">
          Vault: <span className="font-mono">{String(VAULT_ADDRESS)}</span> • Latest:{" "}
          <span className="font-mono">{latestBlock.toString()}</span>
        </div>
      </div>

      {/* Scanning banner with spinner + progress */}
      {scanning && (
        <div className="flex items-center gap-2 rounded-xl border border-default-200/50 bg-content2 p-3 text-sm">
          <Spinner size="sm" />
          <div className="flex-1">
            Scanning logs {scanFrom?.toString()} → {scanTo?.toString()}…
            <span className="ml-2 font-medium">{progressPct}%</span>
          </div>
        </div>
      )}

      {/* Table */}
      {loading && rows.length === 0 ? (
        // Skeleton table while first load
        <Card className="p-3">
          <div className="mb-3 text-default-500 text-sm">Loading series…</div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="grid grid-cols-6 gap-3">
                <Skeleton className="h-5 w-full col-span-2" />
                <Skeleton className="h-5 w-full col-span-1" />
                <Skeleton className="h-5 w-full col-span-1" />
                <Skeleton className="h-5 w-full col-span-1" />
                <Skeleton className="h-5 w-full col-span-1" />
              </div>
            ))}
          </div>
        </Card>
      ) : displayRows.length === 0 ? (
        <Card className="p-3 text-sm text-foreground/70">No series found.</Card>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-default-500">
              <tr>
                <th className="text-left p-3">SeriesId</th>
                <th className="text-left p-3">Underlying</th>
                <th className="text-left p-3">Strike (WXDAI)</th>
                <th className="text-left p-3">Expiry (UTC)</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Block</th>
                <th className="text-left p-3">Tx</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => {
                const expired = Number(r.expiry) <= nowSec;
                return (
                  <tr key={r.id.toString()} className="border-t border-default-200/50">
                    <td className="p-3 font-mono">{r.id.toString()}</td>
                    <td className="p-3">{symFromAddress(r.underlying)}</td>
                    <td className="p-3">{formatStrike(r.strike)}</td>
                    <td className="p-3">{formatDateUTC(r.expiry)}</td>
                    <td className="p-3">
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs " +
                          (expired
                            ? "bg-danger-100 text-danger-700"
                            : "bg-success-100 text-success-700")
                        }
                      >
                        {expired ? "Expired" : "Active"}
                      </span>
                    </td>
                    <td className="p-3">{r.blockNumber.toString()}</td>
                    <td className="p-3">
                      <Link
                        isExternal
                        href={`${EXPLORER}/tx/${r.txHash}`}
                        className="font-mono text-primary"
                        title={r.txHash}
                      >
                        {r.txHash.slice(0, 10)}…{r.txHash.slice(-6)}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}