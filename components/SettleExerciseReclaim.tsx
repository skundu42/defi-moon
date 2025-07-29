// components/SettleExerciseReclaim.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useChainId as useWagmiChainId,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import { Address, formatUnits, parseAbiItem } from "viem";

import { Card } from "@heroui/card";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Select, SelectItem } from "@heroui/select";
import { Tooltip } from "@heroui/tooltip";
import { Spinner } from "@heroui/spinner";

import {
  VAULT_ADDRESS,
  vaultAbi,
  CALLTOKEN_ADDRESS,
  erc1155Abi,
} from "@/lib/contracts";

const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);
const SELECTED_KEY = "vault:selectedSeriesId";
const SELECTED_EVENT = "vault:selectedSeriesChanged";
const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "100");

type SeriesRow = {
  id: bigint;
  underlying: `0x${string}`;
  strike: bigint;
  expiry: bigint;
};

function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

function fmt18(bi?: bigint, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

function shortId(id?: bigint) {
  if (!id) return "—";
  const s = id.toString();
  return s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
}

function useSelectedSeriesId(): bigint | undefined {
  const [id, setId] = useState<bigint>();
  useEffect(() => {
    // try URL param first
    try {
      const p = new URL(window.location.href).searchParams.get("seriesId");
      if (p) return void setId(BigInt(p));
    } catch {}
    // fallback to localStorage
    try {
      const raw = localStorage.getItem(SELECTED_KEY);
      if (raw) setId(BigInt(raw));
    } catch {}
  }, []);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<string>).detail;
      if (d) setId(BigInt(d));
      else setId(undefined);
    };
    window.addEventListener(SELECTED_EVENT, h as any);
    return () => window.removeEventListener(SELECTED_EVENT, h as any);
  }, []);
  return id;
}

export default function SettleExerciseReclaim() {
  const { address, isConnected } = useAccount();
  const chainId = useWagmiChainId();
  const publicClient = usePublicClient();
  const selectedSeriesId = useSelectedSeriesId();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // backfill + live watch all series
  const [allSeries, setAllSeries] = useState<SeriesRow[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(true);
  const bootRef = useRef(false);
  useEffect(() => {
    if (!publicClient || bootRef.current) return;
    bootRef.current = true;
    (async () => {
      setLoadingSeries(true);
      try {
        const latest = await publicClient.getBlockNumber();
        const span = 200_000n;
        const from = latest > span ? latest - span : 0n;
        const chunk = 20_000n;
        const acc: SeriesRow[] = [];
        for (let start = from; start <= latest; start += chunk + 1n) {
          const end = start + chunk > latest ? latest : start + chunk;
          const logs = await publicClient.getLogs({
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
            });
          }
        }
        const m = new Map(acc.map((r) => [r.id.toString(), r]));
        setAllSeries(Array.from(m.values()));
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingSeries(false);
      }
    })();
  }, [publicClient]);

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setAllSeries((prev) => {
        const m = new Map(prev.map((r) => [r.id.toString(), r]));
        for (const l of logs) {
          m.set((l.args.id as bigint).toString(), {
            id: l.args.id as bigint,
            underlying: l.args.underlying as `0x${string}`,
            strike: l.args.strike as bigint,
            expiry: l.args.expiry as bigint,
          });
        }
        return Array.from(m.values());
      });
    },
  });

  const sorted = useMemo(
    () => [...allSeries].sort((a, b) => Number(a.expiry - b.expiry)),
    [allSeries]
  );

  const pickSeries = (v: string) => {
    localStorage.setItem(SELECTED_KEY, v);
    window.dispatchEvent(new CustomEvent(SELECTED_EVENT, { detail: v }));
  };

  // on-chain reads for selected series
  const {
    data: seriesData,
    refetch: refetchSeries,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "series",
    args: selectedSeriesId ? [selectedSeriesId] : undefined,
    query: { enabled: Boolean(selectedSeriesId) },
  });
  const expirySec = seriesData ? (seriesData as any)[3] as bigint : undefined;
  const settled = seriesData ? Boolean((seriesData as any)[6]) : false;

  const {
    data: settlePx = 0n,
    refetch: refetchSettlePx,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "settlePrice",
    args: selectedSeriesId ? [selectedSeriesId] : undefined,
    query: { enabled: Boolean(selectedSeriesId) },
  });
  const {
    data: bal1155 = 0n,
    refetch: refetch1155,
  } = useReadContract({
    address: CALLTOKEN_ADDRESS as Address,
    abi: erc1155Abi,
    functionName: "balanceOf",
    args:
      selectedSeriesId && address
        ? [address as Address, selectedSeriesId]
        : undefined,
    query: { enabled: Boolean(selectedSeriesId && address) },
  });
  const {
    data: locked = 0n,
    refetch: refetchLocked,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "lockedPerSeries",
    args:
      selectedSeriesId && address
        ? [address as Address, selectedSeriesId]
        : undefined,
    query: { enabled: Boolean(selectedSeriesId && address) },
  });

  // input + status
  const [exerciseQtyStr, setExerciseQtyStr] = useState("");
  const exerciseQty = useMemo(() => {
    const s = exerciseQtyStr.trim();
    return /^\d+$/.test(s) ? BigInt(s) : 0n;
  }, [exerciseQtyStr]);

  const now = Math.floor(Date.now() / 1000);
  const expired = expirySec ? Number(expirySec) <= now : undefined;
  const canSettle = Boolean(selectedSeriesId && expired && !settled);
  const canExercise = Boolean(
    selectedSeriesId &&
      settled &&
      bal1155 > 0n &&
      exerciseQty > 0n &&
      exerciseQty <= bal1155
  );
  const canReclaim = Boolean(selectedSeriesId && settled && locked > 0n);

  const { writeContractAsync } = useWriteContract();
  const [sending, setSending] = useState<
    "settle" | "exercise" | "reclaim" | null
  >(null);
  const [msg, setMsg] = useState<{
    type: "info" | "success" | "warn" | "error";
    text: string;
  } | null>(null);

  async function waitReceipt(hash?: `0x${string}`) {
    if (!hash || !publicClient) return;
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // *** now includes refetchSeries ***
  async function refreshAll() {
    await Promise.all([
      refetchSeries(),
      refetch1155(),
      refetchLocked(),
      refetchSettlePx(),
    ]);
  }

  function requireReady(): boolean {
    if (!mounted) return false;
    if (!isConnected) {
      setMsg({ type: "warn", text: "Connect your wallet." });
      return false;
    }
    if (!selectedSeriesId) {
      setMsg({ type: "warn", text: "Select a series first." });
      return false;
    }
    if (chainId !== EXPECTED_CHAIN_ID) {
      setMsg({
        type: "warn",
        text: `Switch to chain ${EXPECTED_CHAIN_ID}.`,
      });
      return false;
    }
    return true;
  }

  // wrapper to estimate gas + 20%
  async function estimateGasWithBuffer(fn: string, args: any[]) {
    try {
      let g = await publicClient.estimateContractGas({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: fn,
        args,
        account: address as Address,
      });
      return (g * 12n) / 10n;
    } catch {
      return undefined;
    }
  }

  // ——— Actions ———
  const onSettle = async () => {
    setMsg(null);
    if (!requireReady() || !canSettle) {
      if (!canSettle) setMsg({ type: "warn", text: "Not ready to settle." });
      return;
    }
    setSending("settle");
    try {
      const gasLimit = await estimateGasWithBuffer("settleSeries", [
        selectedSeriesId!,
      ]);
      const h = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "settleSeries",
        args: [selectedSeriesId!],
        ...(gasLimit ? { gas: gasLimit } : {}),
      });
      await waitReceipt(h);
      await refreshAll();              // <-- seriesData now refreshes too
      setMsg({ type: "success", text: "Settlement confirmed." });
    } catch (e: any) {
      setMsg({
        type: "error",
        text: e?.shortMessage ?? e?.message ?? "Settle failed.",
      });
    } finally {
      setSending(null);
    }
  };

  const onExercise = async () => {
    setMsg(null);
    if (!requireReady() || !canExercise) {
      if (!canExercise) setMsg({ type: "warn", text: "Cannot exercise." });
      return;
    }
    setSending("exercise");
    try {
      const gasLimit = await estimateGasWithBuffer("exercise", [
        selectedSeriesId!,
        exerciseQty,
      ]);
      const h = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "exercise",
        args: [selectedSeriesId!, exerciseQty],
        ...(gasLimit ? { gas: gasLimit } : {}),
      });
      await waitReceipt(h);
      setExerciseQtyStr("");
      await refreshAll();              // <-- updates bal1155, locked, etc.
      setMsg({ type: "success", text: "Exercise confirmed." });
    } catch (e: any) {
      setMsg({
        type: "error",
        text: e?.shortMessage ?? e?.message ?? "Exercise failed.",
      });
    } finally {
      setSending(null);
    }
  };

  const onReclaim = async () => {
    setMsg(null);
    if (!requireReady() || !canReclaim) {
      if (!canReclaim) setMsg({ type: "warn", text: "Nothing to reclaim." });
      return;
    }
    setSending("reclaim");
    try {
      const gasLimit = await estimateGasWithBuffer("reclaim", [
        selectedSeriesId!,
      ]);
      const h = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "reclaim",
        args: [selectedSeriesId!],
        ...(gasLimit ? { gas: gasLimit } : {}),
      });
      await waitReceipt(h);
      await refreshAll();              // <-- pulls back leftover collateral
      setMsg({ type: "success", text: "Reclaim confirmed." });
    } catch (e: any) {
      setMsg({
        type: "error",
        text: e?.shortMessage ?? e?.message ?? "Reclaim failed.",
      });
    } finally {
      setSending(null);
    }
  };

  // auto-refresh on events
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Settled",
    onLogs: refreshAll,
  });
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Exercised",
    onLogs: refreshAll,
  });
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Reclaimed",
    onLogs: refreshAll,
  });

  const expiryLabel =
    expirySec && Number.isFinite(Number(expirySec))
      ? new Date(Number(expirySec) * 1000)
          .toISOString()
          .replace("T", " ")
          .slice(0, 16) + "Z"
      : "—";

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-lg font-medium">Settle / Exercise / Reclaim</h3>

      {/* Series selector */}
      <div className="rounded-2xl border border-default-200/50 bg-content1 p-4">
        <label className="block mb-1 text-sm font-medium">
          Series <Info tip="Pick any series (expired or not)." />
        </label>
        {loadingSeries ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-default-100 rounded">
            <Spinner size="sm" /> Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-default-500">No series found.</div>
        ) : (
          <Select
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={
              selectedSeriesId
                ? new Set([selectedSeriesId.toString()])
                : new Set()
            }
            onSelectionChange={(keys) => {
              const v = Array.from(keys as Set<string>)[0];
              pickSeries(v);
            }}
            classNames={{
              trigger: "h-12 bg-default-100",
              value: "text-sm",
            }}
          >
            {sorted.map((r) => {
              const label = `${shortId(r.id)} • exp ${new Date(
                Number(r.expiry) * 1000
              )
                .toISOString()
                .slice(0, 16)}Z`;
              return (
                <SelectItem
                  key={r.id.toString()}
                  value={r.id.toString()}
                  textValue={label}
                >
                  <div className="flex flex-col">
                    <span className="font-mono">{shortId(r.id)}</span>
                    <span className="text-xs text-default-500">
                      {label}
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </Select>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-sm text-default-500">SeriesId</div>
          <div className="text-xl font-semibold">
            {selectedSeriesId ? shortId(selectedSeriesId) : "—"}
          </div>
        </div>
        <div>
          <div className="text-sm text-default-500">Expiry (UTC)</div>
          <div className="text-xl font-semibold">{expiryLabel}</div>
          <div className="text-xs">
            {expired ? "Expired" : "Not expired"}
          </div>
        </div>
        <div>
          <div className="text-sm text-default-500">Settled</div>
          <div
            className={`text-xl font-semibold ${
              settled ? "text-success" : "text-warning"
            }`}
          >
            {settled ? "Yes" : "No"}
          </div>
          {settled && (
            <div className="text-xs">Price: {fmt18(settlePx)} WXDAI</div>
          )}
        </div>
      </div>

      {/* Exercise / Reclaim */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-3">
          <label className="block mb-1 text-sm font-medium">
            Exercise Qty <Info tip="How many to burn & redeem." />
          </label>
          <Input
            placeholder="0"
            value={exerciseQtyStr}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^\d*$/.test(v)) setExerciseQtyStr(v);
            }}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
            endContent={
              <button
                className="text-xs text-primary"
                onClick={() =>
                  setExerciseQtyStr(bal1155.toString())
                }
                disabled={!selectedSeriesId || bal1155 === 0n}
              >
                Max
              </button>
            }
          />
          <div className="text-xs text-default-500">
            Your balance: {bal1155}
          </div>
        </div>

        <Button
          color="primary"
          onPress={onSettle}
          isDisabled={!mounted || sending !== null || !canSettle}
          isLoading={sending === "settle"}
          className="md:col-span-1 h-12"
        >
          Settle
        </Button>

        <Button
          variant="flat"
          onPress={onExercise}
          isDisabled={!mounted || sending !== null || !canExercise}
          isLoading={sending === "exercise"}
          className="md:col-span-1 h-12"
        >
          Exercise
        </Button>

        <Button
          variant="bordered"
          onPress={onReclaim}
          isDisabled={!mounted || sending !== null || !canReclaim}
          isLoading={sending === "reclaim"}
          className="md:col-span-1 h-12"
        >
          Reclaim
        </Button>
      </div>

      {msg && (
        <div
          className={`rounded-xl p-3 text-sm border ${
            msg.type === "success"
              ? "border-success text-success"
              : msg.type === "error"
              ? "border-danger text-danger"
              : "border-warning text-warning"
          }`}
        >
          {msg.text}
        </div>
      )}
    </Card>
  );
}