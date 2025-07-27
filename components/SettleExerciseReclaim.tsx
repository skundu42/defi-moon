// components/SettleExerciseReclaim.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId as useWagmiChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { Address, formatUnits } from "viem";

import { Card } from "@heroui/card";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";

import {
  VAULT_ADDRESS,
  vaultAbi,
  CALLTOKEN_ADDRESS,
  erc1155Abi, // minimal ERC1155 ABI with balanceOf(address,uint256)
} from "@/lib/contracts";

const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "100");

function fmt18(bi?: bigint, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

/** Shared: read selected series id from URL/localStorage and window event */
function useSelectedSeriesId(): bigint | undefined {
  const [id, setId] = useState<bigint | undefined>(undefined);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get("seriesId");
      if (raw) {
        setId(BigInt(raw));
        return;
      }
    } catch {}
    try {
      const raw = localStorage.getItem("selectedSeriesId");
      if (raw) setId(BigInt(raw));
    } catch {}
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent<string>).detail;
        if (detail) setId(BigInt(detail));
      } catch {}
    };
    window.addEventListener("series:selected", handler as EventListener);
    return () => window.removeEventListener("series:selected", handler as EventListener);
  }, []);

  return id;
}

export default function SettleExerciseReclaim() {
  const { address, isConnected } = useAccount();
  const chainId = useWagmiChainId();
  const publicClient = usePublicClient();

  const selectedSeriesId = useSelectedSeriesId();

  // SSR guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Exercise input
  const [exerciseQtyStr, setExerciseQtyStr] = useState<string>("");

  // Reads — series struct
  const { data: seriesData } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "series",
    args: selectedSeriesId ? [selectedSeriesId] : undefined,
    query: { enabled: Boolean(selectedSeriesId) },
  });
  // series() layout: [underlying, underlyingDecimals, strike, expiry, collateralPerOption, oracle, settled]
  const expirySec: bigint | undefined = seriesData ? (seriesData as any)[3] : undefined;
  const settled: boolean = seriesData ? Boolean((seriesData as any)[6]) : false;

  // Settle price (only meaningful if settled)
  const { data: settlePx = 0n, refetch: refetchSettlePx } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "settlePrice",
    args: selectedSeriesId ? [selectedSeriesId] : undefined,
    query: { enabled: Boolean(selectedSeriesId) },
  });

  // User 1155 balance of this series (needed for exercise)
  const { data: bal1155 = 0n, refetch: refetchBal1155 } = useReadContract({
    address: CALLTOKEN_ADDRESS as Address,
    abi: erc1155Abi,
    functionName: "balanceOf",
    args: selectedSeriesId && address ? [address as Address, selectedSeriesId] : undefined,
    query: { enabled: Boolean(selectedSeriesId && address) },
  });

  // User locked collateral in this series (for reclaim)
  const { data: locked = 0n, refetch: refetchLocked } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "lockedPerSeries",
    args: selectedSeriesId && address ? [address as Address, selectedSeriesId] : undefined,
    query: { enabled: Boolean(selectedSeriesId && address) },
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const expired = expirySec ? Number(expirySec) <= nowSec : undefined;

  // Exercise qty parsing (ERC-1155 = whole units)
  const exerciseQty = useMemo(() => {
    const s = (exerciseQtyStr || "").trim();
    if (!s) return 0n;
    if (!/^\d+$/.test(s)) return 0n;
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }, [exerciseQtyStr]);

  // Status helpers
  const canSettle = Boolean(selectedSeriesId && expired && !settled);
  const canExercise = Boolean(selectedSeriesId && settled && bal1155 > 0n && exerciseQty > 0n && exerciseQty <= bal1155);
  const canReclaim = Boolean(selectedSeriesId && settled && locked > 0n);

  // Actions
  const { writeContractAsync, isPending } = useWriteContract();
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ type: "info" | "success" | "warn" | "error"; text: string } | null>(null);

  async function waitReceipt(hash: `0x${string}`) {
    if (!publicClient) return;
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } catch {}
  }

  async function refreshReads() {
    await Promise.all([refetchBal1155(), refetchLocked(), refetchSettlePx()]);
  }

  function requireReady(): boolean {
    if (!mounted) return false;
    if (!isConnected) {
      setMsg({ type: "warn", text: "Connect your wallet." });
      return false;
    }
    if (!selectedSeriesId) {
      setMsg({ type: "warn", text: "Select a series in the Series section first." });
      return false;
    }
    if (chainId !== EXPECTED_CHAIN_ID) {
      setMsg({ type: "warn", text: `Wrong network. Please switch to chainId ${EXPECTED_CHAIN_ID}.` });
      return false;
    }
    return true;
  }

  const onSettle = async () => {
    setMsg(null);
    if (!requireReady()) return;
    if (!canSettle) {
      setMsg({ type: "warn", text: "Series is not eligible for settlement yet." });
      return;
    }
    try {
      setSending(true);
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "settleSeries",
        args: [selectedSeriesId as bigint],
      });
      if (typeof hash === "string" && hash.startsWith("0x")) {
        await waitReceipt(hash as `0x${string}`);
      }
      await refreshReads();
      setMsg({ type: "success", text: "Settlement transaction confirmed." });
    } catch (e: any) {
      setMsg({ type: "error", text: e?.shortMessage ?? e?.message ?? "Settle failed" });
    } finally {
      setSending(false);
    }
  };

  const onExercise = async () => {
    setMsg(null);
    if (!requireReady()) return;
    if (!canExercise) {
      setMsg({ type: "warn", text: "Enter a valid quantity (≤ your balance) and ensure series is settled." });
      return;
    }
    try {
      setSending(true);
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "exercise",
        args: [selectedSeriesId as bigint, exerciseQty],
      });
      if (typeof hash === "string" && hash.startsWith("0x")) {
        await waitReceipt(hash as `0x${string}`);
      }
      setExerciseQtyStr("");
      await refreshReads();
      setMsg({ type: "success", text: "Exercise transaction confirmed." });
    } catch (e: any) {
      setMsg({ type: "error", text: e?.shortMessage ?? e?.message ?? "Exercise failed" });
    } finally {
      setSending(false);
    }
  };

  const onReclaim = async () => {
    setMsg(null);
    if (!requireReady()) return;
    if (!canReclaim) {
      setMsg({ type: "warn", text: "No locked collateral to reclaim for this series (or series not settled)." });
      return;
    }
    try {
      setSending(true);
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "reclaim",
        args: [selectedSeriesId as bigint],
      });
      if (typeof hash === "string" && hash.startsWith("0x")) {
        await waitReceipt(hash as `0x${string}`);
      }
      await refreshReads();
      setMsg({ type: "success", text: "Reclaim transaction confirmed." });
    } catch (e: any) {
      setMsg({ type: "error", text: e?.shortMessage ?? e?.message ?? "Reclaim failed" });
    } finally {
      setSending(false);
    }
  };

  // UI values
  const expiryLabel =
    expirySec && Number.isFinite(Number(expirySec))
      ? new Date(Number(expirySec) * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z"
      : "—";

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-lg font-medium">Settle / Exercise / Reclaim</h3>

      {/* Selected series summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-sm text-default-500">SeriesId</div>
          <div className="text-xl font-semibold">
            {selectedSeriesId ? <span className="font-mono">{selectedSeriesId.toString()}</span> : "— Select a series"}
          </div>
        </div>
        <div>
          <div className="text-sm text-default-500">Expiry (UTC)</div>
          <div className="text-xl font-semibold">{expiryLabel}</div>
          <div className="text-xs mt-1">
            {expirySec === undefined ? "—" : expired ? "Expired" : "Not expired"}
          </div>
        </div>
        <div>
          <div className="text-sm text-default-500">Settled</div>
          <div className={`text-xl font-semibold ${settled ? "text-success" : "text-warning"}`}>
            {settled ? "Yes" : "No"}
          </div>
          {settled && (
            <div className="text-xs mt-1">
              Settle Px: {fmt18(settlePx)} WXDAI
            </div>
          )}
        </div>
      </div>

      {/* Exercise input */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-3">
          <label className="block mb-1 text-sm font-medium">Exercise Qty (options)</label>
          <Input
            placeholder="0"
            value={exerciseQtyStr}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (/^\d*$/.test(v)) setExerciseQtyStr(v);
            }}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            endContent={
              <button
                type="button"
                className="text-xs text-primary"
                onClick={() => setExerciseQtyStr(bal1155.toString())}
                disabled={!selectedSeriesId || bal1155 === 0n}
              >
                Max
              </button>
            }
          />
          <div className="text-xs text-default-500 mt-1">Your 1155 balance: {bal1155.toString()}</div>
        </div>

        <div className="md:col-span-1 flex gap-2">
          <Button
            color="primary"
            onPress={onSettle}
            isDisabled={!mounted || !selectedSeriesId || sending || !canSettle}
            isLoading={sending && canSettle}
            className="h-12 flex-1"
          >
            Settle
          </Button>
        </div>

        <div className="md:col-span-1 flex gap-2">
          <Button
            variant="flat"
            onPress={onExercise}
            isDisabled={!mounted || !selectedSeriesId || sending || !canExercise}
            isLoading={sending && canExercise}
            className="h-12 flex-1"
          >
            Exercise
          </Button>
        </div>

        <div className="md:col-span-1 flex gap-2">
          <Button
            variant="bordered"
            onPress={onReclaim}
            isDisabled={!mounted || !selectedSeriesId || sending || !canReclaim}
            isLoading={sending && canReclaim}
            className="h-12 flex-1"
          >
            Reclaim
          </Button>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className={`rounded-xl p-3 text-sm ${
            msg.type === "success"
              ? "border border-success text-success"
              : msg.type === "error"
              ? "border border-danger text-danger"
              : msg.type === "warn"
              ? "border border-warning text-warning"
              : "border border-default-200 text-default-600"
          }`}
        >
          {msg.text}
        </div>
      )}
    </Card>
  );
}