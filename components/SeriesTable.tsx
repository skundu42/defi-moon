"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { Spinner } from "@heroui/spinner";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { ALL_TOKENS } from "@/lib/token";
import { parseAbiItem } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";

/** event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry); */
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

const SELECTED_KEY = "vault:selectedSeriesId";
const SELECTED_EVENT = "vault:selectedSeriesChanged";

type Row = {
  id: bigint;
  underlying: `0x${string}`;
  strike: bigint;
  expiry: bigint;
};

function symFromAddress(addr: string): string {
  const t = ALL_TOKENS.find(
    (x) => x.address.toLowerCase() === addr.toLowerCase()
  );
  return t ? t.symbol : addr.slice(0, 6) + "…" + addr.slice(-4);
}

function formatStrikeWXDAI(n: bigint): string {
  const s = n.toString().padStart(19, "0");
  const head = s.slice(0, -18) || "0";
  const tail = s.slice(-18).replace(/0+$/, "");
  return tail.length ? `${head}.${tail}` : head;
}

function formatDate(ts: bigint): string {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function SeriesTable() {
  const client = usePublicClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const bootstrappedRef = useRef(false);
  const lastBroadcastRef = useRef<string | undefined>(undefined);
  const [selectedSeriesId, setSelectedSeriesId] = useState<bigint>();

  const deployBlockEnv = useMemo(() => {
    const v = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK;
    return v ? Math.max(0, Number(v)) : undefined;
  }, []);

  // Historical backfill
  useEffect(() => {
    if (!client || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    (async () => {
      setLoading(true);
      try {
        const latest = await client.getBlockNumber();
        const DEFAULT_SPAN = 200_000n;
        const fromBlock =
          deployBlockEnv !== undefined
            ? BigInt(deployBlockEnv)
            : latest > DEFAULT_SPAN
            ? latest - DEFAULT_SPAN
            : 0n;
        const step = 20_000n;
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
            const args = log.args;
            if (!args?.id) continue;
            acc.push({
              id: args.id as bigint,
              underlying: args.underlying as `0x${string}`,
              strike: args.strike as bigint,
              expiry: args.expiry as bigint,
            });
          }
        }
        const uniq = new Map<string, Row>();
        for (const r of acc) uniq.set(r.id.toString(), r);
        const list = Array.from(uniq.values()).sort((a, b) =>
          a.expiry === b.expiry
            ? Number(b.id - a.id)
            : Number(b.expiry - a.expiry)
        );
        setRows(list);
      } catch (err) {
        console.error("Backfill error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [client, deployBlockEnv]);

  // Live updates
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: [vaultAbi],
    eventName: "SeriesDefined",
    onLogs(logs) {
      setRows((prev) => {
        const next = new Map<string, Row>();
        for (const r of prev) {
          next.set(r.id.toString(), r);
        }
        const arr = Array.isArray(logs) ? logs : [logs as any];
        for (const l of arr) {
          const args = (l as any).args;
          if (!args?.id) continue;
          const id = args.id as bigint;
          next.set(id.toString(), {
            id,
            underlying: args.underlying as `0x${string}`,
            strike: args.strike as bigint,
            expiry: args.expiry as bigint,
          });
        }
        return Array.from(next.values()).sort((a, b) =>
          a.expiry === b.expiry
            ? Number(b.id - a.id)
            : Number(b.expiry - a.expiry)
        );
      });
    },
  });

  // Filter active
  const nowSec = Math.floor(Date.now() / 1000);
  const activeRows = useMemo(
    () => rows.filter((r) => Number(r.expiry) > nowSec),
    [rows, nowSec]
  );

  // Load selection
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SELECTED_KEY);
      if (raw) setSelectedSeriesId(BigInt(raw));
    } catch {}
  }, []);

  // Broadcast selection
  const broadcastSelected = (id?: bigint) => {
    const val = id ? id.toString() : "";
    if (lastBroadcastRef.current === val) return;
    lastBroadcastRef.current = val;
    try {
      if (id) localStorage.setItem(SELECTED_KEY, val);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {}
    window.dispatchEvent(
      new CustomEvent(SELECTED_EVENT, { detail: val })
    );
  };

  // Reconcile
  useEffect(() => {
    if (loading) return;
    if (activeRows.length === 0) {
      if (selectedSeriesId !== undefined) {
        setSelectedSeriesId(undefined);
        broadcastSelected(undefined);
      }
      return;
    }
    const isActive = selectedSeriesId
      ? activeRows.some((r) => r.id === selectedSeriesId)
      : false;
    if (!isActive) {
      const first = [...activeRows].sort(
        (a, b) => Number(a.expiry - b.expiry)
      )[0];
      setSelectedSeriesId(first.id);
      broadcastSelected(first.id);
    }
  }, [loading, activeRows, selectedSeriesId]);

  // UI
  const hasActive = activeRows.length > 0;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Series</h3>
        <div className="text-xs text-default-600">
          Selected: <span className="font-mono">{selectedSeriesId?.toString() || "—"}</span>
        </div>
      </div>

      <div className="rounded-xl border bg-content2 p-3">
        {loading && !hasActive ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-default-100 rounded">
            <Spinner size="sm" /> Loading series…
          </div>
        ) : !hasActive ? (
          <div className="text-sm text-default-500">
            No active series found.
          </div>
        ) : (
          <Select
            selectionMode="single"
            selectedKeys={
              selectedSeriesId ? new Set([selectedSeriesId.toString()]) : new Set()
            }
            onSelectionChange={(keys) => {
              const raw = Array.from(keys as Set<string>)[0];
              if (!raw) {
                setSelectedSeriesId(undefined);
                broadcastSelected(undefined);
              } else {
                const id = BigInt(raw);
                setSelectedSeriesId(id);
                broadcastSelected(id);
              }
            }}
            classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
            disallowEmptySelection
            aria-label="Select series"
          >
            {[...activeRows]
              .sort((a, b) => Number(a.expiry - b.expiry))
              .map((s) => (
                <SelectItem
                  key={s.id.toString()}
                  value={s.id.toString()}
                  textValue={`${s.id.toString()} — ${symFromAddress(
                    s.underlying
                  )} — K ${formatStrikeWXDAI(s.strike)} — exp ${formatDate(
                    s.expiry
                  )}`}
                >
                  <div className="flex flex-col">
                    <span className="font-mono">{s.id.toString()}</span>
                    <span className="text-xs text-default-500">
                      {symFromAddress(s.underlying)} • K {formatStrikeWXDAI(
                        s.strike
                      )} • exp {formatDate(s.expiry)}
                    </span>
                  </div>
                </SelectItem>
              ))}
          </Select>
        )}
      </div>

      {hasActive && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-default-100 text-default-500">
              <tr>
                <th className="p-2 text-left">SeriesId</th>
                <th className="p-2 text-left">Underlying</th>
                <th className="p-2 text-left">Strike</th>
                <th className="p-2 text-left">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {[...activeRows]
                .sort((a, b) => Number(a.expiry - b.expiry))
                .map((r) => (
                  <tr key={r.id.toString()} className="border-t">
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
