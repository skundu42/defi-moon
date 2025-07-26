// components/SeriesTable.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@heroui/card";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { ALL_TOKENS } from "@/lib/token";
import { parseAbiItem } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";

/** event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry); */
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

type Row = {
  id: bigint;
  underlying: `0x${string}`;
  strike: bigint; // 1e18 WXDAI
  expiry: bigint; // unix
};

function symFromAddress(addr: string): string {
  const t = ALL_TOKENS.find(
    (x) => x.address.toLowerCase() === addr.toLowerCase()
  );
  return t ? t.symbol : addr.slice(0, 6) + "…" + addr.slice(-4);
}

function formatStrikeWXDAI(n: bigint): string {
  // 1e18 -> human
  const s = n.toString().padStart(19, "0");
  const head = s.slice(0, -18) || "0";
  const tail = s.slice(-18).replace(/0+$/, "");
  return tail.length ? `${head}.${tail}` : head;
}

function formatDate(ts: bigint): string {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime()) ? "-" : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function SeriesTable() {
  const client = usePublicClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const bootstrappedRef = useRef(false);

  const deployBlockEnv = useMemo(() => {
    const v = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK;
    return v ? Math.max(0, Number(v)) : undefined;
  }, []);

  // ---- Backfill historical logs (chunked) ----
  useEffect(() => {
    if (!client || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    (async () => {
      try {
        setLoading(true);
        const latest = await client.getBlockNumber();

        // choose a starting block:
        const DEFAULT_SPAN = 200_000n; // ~ a few days on Gnosis, fast
        const fromBlock =
          deployBlockEnv !== undefined
            ? BigInt(deployBlockEnv)
            : latest > DEFAULT_SPAN
            ? latest - DEFAULT_SPAN
            : 0n;

        const step = 20_000n; // chunk size to satisfy RPC getLogs limits
        const acc: Row[] = [];

        for (let start = fromBlock; start <= latest; start += step + 1n) {
          const end = start + step > latest ? latest : start + step;
          const logs = await client.getLogs({
            address: VAULT_ADDRESS,
            event: SERIES_DEFINED,
            fromBlock: start,
            toBlock: end,
          });
          for (const log of logs) {
            acc.push({
              id: log.args.id as bigint,
              underlying: log.args.underlying as `0x${string}`,
              strike: log.args.strike as bigint,
              expiry: log.args.expiry as bigint,
            });
          }
        }

        // de-dup (in case of reorgs) and sort newest expiry first
        const uniq = new Map<string, Row>();
        for (const r of acc) uniq.set(r.id.toString(), r);
        const list = Array.from(uniq.values()).sort((a, b) =>
          a.expiry === b.expiry ? Number(b.id - a.id) : Number(b.expiry - a.expiry)
        );

        setRows(list);
      } catch (err) {
        console.error("Backfill error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [client, deployBlockEnv]);

  // ---- Live subscribe to SeriesDefined ----
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setRows((prev) => {
        const next = new Map<string, Row>();
        for (const r of prev) next.set(r.id.toString(), r);
        for (const l of logs) {
          const id = l.args?.id as bigint;
          const underlying = l.args?.underlying as `0x${string}`;
          const strike = l.args?.strike as bigint;
          const expiry = l.args?.expiry as bigint;
          next.set(id.toString(), { id, underlying, strike, expiry });
        }
        return Array.from(next.values()).sort((a, b) =>
          a.expiry === b.expiry ? Number(b.id - a.id) : Number(b.expiry - a.expiry)
        );
      });
    },
  });

  // ---- Only show ACTIVE series (expiry in the future) ----
  const nowSec = Math.floor(Date.now() / 1000);
  const activeRows = useMemo(
    () => rows.filter((r) => Number(r.expiry) > nowSec),
    [rows, nowSec]
  );

  return (
    <Card className="p-5">
      <h3 className="text-lg font-medium mb-3">Active Series</h3>

      {loading && activeRows.length === 0 ? (
        <div className="rounded-xl border border-default-200/50 bg-content2 p-3 text-sm text-foreground/70">
          Loading series from chain…
        </div>
      ) : activeRows.length === 0 ? (
        <div className="rounded-xl border border-default-200/50 bg-content2 p-3 text-sm text-foreground/70">
          No active series found.
        </div>
      ) : (
        <div className="rounded-xl border border-default-200/50 bg-content2 p-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-default-500">
              <tr>
                <th className="text-left p-2">SeriesId</th>
                <th className="text-left p-2">Underlying</th>
                <th className="text-left p-2">Strike (WXDAI)</th>
                <th className="text-left p-2">Expiry (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((r) => (
                <tr key={r.id.toString()} className="border-t border-default-200/50">
                  <td className="p-2 font-mono">{r.id.toString()}</td>
                  <td className="p-2">{symFromAddress(r.underlying)}</td>
                  <td className="p-2">{formatStrikeWXDAI(r.strike)}</td>
                  <td className="p-2">{formatDate(r.expiry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}