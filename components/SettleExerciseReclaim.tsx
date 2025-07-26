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

function isHex(s: string) {
  return /^0x[0-9a-fA-F]+$/.test(s.trim());
}
function parseSeriesId(input: string): bigint | null {
  const s = (input || "").trim();
  if (!s) return null;
  try {
    if (isHex(s)) return BigInt(s);
    // decimal
    if (!/^\d+$/.test(s)) return null;
    return BigInt(s);
  } catch {
    return null;
  }
}

function fmt18(bi?: bigint, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

export default function SettleExerciseReclaim() {
  const { address, isConnected } = useAccount();
  const chainId = useWagmiChainId();
  const publicClient = usePublicClient();

  // SSR guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Inputs
  const [seriesIdStr, setSeriesIdStr] = useState<string>("");
  const [exerciseQtyStr, setExerciseQtyStr] = useState<string>("");

  const seriesId = useMemo(() => parseSeriesId(seriesIdStr), [seriesIdStr]);

  // Reads — series struct
  const { data: seriesData } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "series",
    args: seriesId ? [seriesId] : undefined,
    query: { enabled: Boolean(seriesId) },
  });
  // series() layout: [underlying, underlyingDecimals, strike, expiry, collateralPerOption, oracle, settled]
  const expirySec: bigint | undefined = seriesData ? (seriesData as any)[3] : undefined;
  const settled: boolean = seriesData ? Boolean((seriesData as any)[6]) : false;

  // Settle price (only meaningful if settled)
  const { data: settlePx = 0n, refetch: refetchSettlePx } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "settlePrice",
    args: seriesId ? [seriesId] : undefined,
    query: { enabled: Boolean(seriesId) },
  });

  // User 1155 balance of this series (needed for exercise)
  const { data: bal1155 = 0n, refetch: refetchBal1155 } = useReadContract({
    address: CALLTOKEN_ADDRESS as Address,
    abi: erc1155Abi,
    functionName: "balanceOf",
    args: seriesId && address ? [address as Address, seriesId] : undefined,
    query: { enabled: Boolean(seriesId && address) },
  });

  // User locked collateral in this series (for reclaim)
  const { data: locked = 0n, refetch: refetchLocked } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "lockedPerSeries",
    args: seriesId && address ? [address as Address, seriesId] : undefined,
    query: { enabled: Boolean(seriesId && address) },
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const expired = expirySec ? Number(expirySec) <= nowSec : undefined;

  // Exercise qty parsing (ERC-1155 = whole units)
  const exerciseQty = useMemo(() => {
    const s = exerciseQtyStr.trim();
    if (!s) return 0n;
    if (!/^\d+$/.test(s)) return 0n;
    try {
      return BigInt(s);
    } catch {
      return 0n;
    }
  }, [exerciseQtyStr]);

  // Status helpers
  const canSettle = Boolean(seriesId && expired && !settled);
  const canExercise = Boolean(seriesId && settled && bal1155 > 0n && exerciseQty > 0n && exerciseQty <= bal1155);
  const canReclaim = Boolean(seriesId && settled && locked > 0n);

  // Actions
  const { writeContractAsync, isPending } = useWriteContract();
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ type: "info" | "success" | "warn" | "error"; text: string } | null>(null);

  async function waitReceipt(hash: `0x${string}`) {
    if (!publicClient) return;
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } catch {
      // ignore
    }
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
    if (!seriesId) {
      setMsg({ type: "warn", text: "Enter a valid seriesId (decimal or 0x hex)." });
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
        args: [seriesId as bigint],
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
        args: [seriesId as bigint, exerciseQty],
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
        args: [seriesId as bigint],
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

      {/* Row: inputs */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-3">
          <label className="block mb-1 text-sm font-medium">SeriesId (decimal or 0x hex)</label>
          <Input
            placeholder="e.g. 123456789... or 0xabc..."
            value={seriesIdStr}
            onChange={(e) => setSeriesIdStr(e.target.value)}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        <div className="md:col-span-2">
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
                disabled={!seriesId || bal1155 === 0n}
              >
                Max
              </button>
            }
          />
        </div>

        <div className="md:col-span-1 flex gap-2">
          <Button
            color="primary"
            onPress={onSettle}
            isDisabled={!mounted || !seriesId || sending || !canSettle}
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
            isDisabled={!mounted || !seriesId || sending || !canExercise}
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
            isDisabled={!mounted || !seriesId || sending || !canReclaim}
            isLoading={sending && canReclaim}
            className="h-12 flex-1"
          >
            Reclaim
          </Button>
        </div>
      </div>

      {/* Status */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-sm text-default-500">Expiry (UTC)</div>
          <div className="text-xl font-semibold">{expiryLabel}</div>
          <div className="text-xs mt-1">
            {expired === undefined ? "—" : expired ? "Expired" : "Not expired"}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm text-default-500">Settled</div>
          <div className={`text-xl font-semibold ${settled ? "text-success" : "text-warning"}`}>
            {settled ? "Yes" : "No"}
          </div>
          {settled && (
            <div className="text-xs mt-1">
              Settle Px: {fmt18(settlePx)} WXDAI
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="text-sm text-default-500">Your 1155 balance (options)</div>
          <div className="text-xl font-semibold">{bal1155.toString()}</div>
          <div className="text-xs mt-1">
            {bal1155 > 0n ? "You can exercise after settlement." : "No options held."}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-sm text-default-500">Your locked collateral</div>
          <div className="text-xl font-semibold">{fmt18(locked)} GNO</div>
          <div className="text-xs mt-1">
            {settled ? "Reclaim available if > 0." : "Reclaim only after settlement."}
          </div>
        </Card>
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