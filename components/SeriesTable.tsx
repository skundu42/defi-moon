// components/SeriesTable.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@heroui/card";
import { Button } from "@heroui/button";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { ALL_TOKENS } from "@/lib/token";
import { parseAbiItem } from "viem";
import {
  usePublicClient,
  useWatchContractEvent,
} from "wagmi";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

// 1e18 -> human
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const bootstrappedRef = useRef(false);

  // Currently selected series id (string for easier URL/localStorage handling)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

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

  // ---- Initialize selection from URL or localStorage or default to first active ----
  useEffect(() => {
    // If URL already has seriesId, prefer it
    const fromUrl = searchParams?.get("seriesId");
    if (fromUrl && fromUrl !== selectedId) {
      setSelectedId(fromUrl);
      // also cache to localStorage for persistence across pages
      try {
        localStorage.setItem("selectedSeriesId", fromUrl);
      } catch {}
      return;
    }

    // Else try localStorage
    if (!fromUrl && typeof window !== "undefined" && !selectedId) {
      try {
        const fromStorage = localStorage.getItem("selectedSeriesId") || undefined;
        if (fromStorage) {
          setSelectedId(fromStorage);
          // keep URL in sync (no navigation away, just replace)
          const params = new URLSearchParams(searchParams?.toString());
          params.set("seriesId", fromStorage);
          router.replace(`${pathname}?${params.toString()}`);
          return;
        }
      } catch {}
    }

    // Else pick a default if any active rows exist and we still don't have a selection
    if (!selectedId && activeRows.length > 0) {
      const defaultId = activeRows[0].id.toString(); // choose the first active (newest expiry by our sort)
      setSelectedId(defaultId);
      try {
        localStorage.setItem("selectedSeriesId", defaultId);
      } catch {}
      const params = new URLSearchParams(searchParams?.toString());
      params.set("seriesId", defaultId);
      router.replace(`${pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, activeRows.length, pathname, router]);

  // ---- If selection expires or becomes invalid, clear it and choose a new default ----
  useEffect(() => {
    if (!selectedId) return;
    const stillActive = activeRows.some((r) => r.id.toString() === selectedId);
    if (!stillActive) {
      // clear selection and try to choose the next best
      const next = activeRows[0]?.id?.toString();
      setSelectedId(next);
      try {
        if (next) localStorage.setItem("selectedSeriesId", next);
        else localStorage.removeItem("selectedSeriesId");
      } catch {}
      const params = new URLSearchParams(searchParams?.toString());
      if (next) {
        params.set("seriesId", next);
      } else {
        params.delete("seriesId");
      }
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [activeRows, selectedId, pathname, router, searchParams]);

  // ---- Select handler: update state + URL + localStorage (+ fire a window event for immediate listeners) ----
  function selectSeries(id: string) {
    if (!id || id === selectedId) return;
    setSelectedId(id);
    try {
      localStorage.setItem("selectedSeriesId", id);
    } catch {}
    const params = new URLSearchParams(searchParams?.toString());
    params.set("seriesId", id);
    router.replace(`${pathname}?${params.toString()}`);

    // optional: broadcast for any listeners that want to react immediately
    try {
      window.dispatchEvent(new CustomEvent("series:selected", { detail: id }));
    } catch {}
  }

  const selectedRow = useMemo(
    () => activeRows.find((r) => r.id.toString() === selectedId),
    [activeRows, selectedId]
  );

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Active Series</h3>

        {/* Current selection summary */}
        <div className="text-xs md:text-sm rounded-xl border border-default-200/60 bg-content2 px-3 py-1.5">
          {selectedRow ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Selected:</span>
              <span className="font-mono">{selectedRow.id.toString()}</span>
              <span>• {symFromAddress(selectedRow.underlying)}</span>
              <span>• K {formatStrikeWXDAI(selectedRow.strike)}</span>
              <span>• exp {formatDate(selectedRow.expiry)}</span>
            </div>
          ) : (
            <span className="text-default-500">No series selected</span>
          )}
        </div>
      </div>

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
                <th className="text-left p-2">Select</th>
                <th className="text-left p-2">SeriesId</th>
                <th className="text-left p-2">Underlying</th>
                <th className="text-left p-2">Strike (WXDAI)</th>
                <th className="text-left p-2">Expiry (UTC)</th>
                <th className="text-left p-2"></th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((r) => {
                const idStr = r.id.toString();
                const isSelected = idStr === selectedId;
                return (
                  <tr
                    key={idStr}
                    className={`border-t border-default-200/50 ${
                      isSelected ? "bg-content1/40" : ""
                    }`}
                  >
                    <td className="p-2 align-middle">
                      <input
                        type="radio"
                        name="series-select"
                        className="cursor-pointer"
                        checked={isSelected}
                        onChange={() => selectSeries(idStr)}
                        aria-label={`Select series ${idStr}`}
                      />
                    </td>
                    <td className="p-2 font-mono align-middle">{idStr}</td>
                    <td className="p-2 align-middle">{symFromAddress(r.underlying)}</td>
                    <td className="p-2 align-middle">{formatStrikeWXDAI(r.strike)}</td>
                    <td className="p-2 align-middle">{formatDate(r.expiry)}</td>
                    <td className="p-2 align-middle">
                      {!isSelected ? (
                        <Button
                          size="sm"
                          onPress={() => selectSeries(idStr)}
                          className="h-8"
                        >
                          Select
                        </Button>
                      ) : (
                        <span className="text-xs text-success">Selected</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}