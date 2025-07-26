// components/DepositWithdraw.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId as useWagmiChainId,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { Address, erc20Abi, formatUnits, parseUnits } from "viem";

import { Card } from "@heroui/card";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Checkbox } from "@heroui/checkbox";

import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { getTokenBySymbol } from "@/lib/token";

/** ---------- Config / Helpers ---------- */

// Application’s expected chain ID
const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "100");

// Vault underlying is GNO in this project (18 decimals)
const UNDERLYING = getTokenBySymbol("GNO"); // { address, symbol, decimals, ... }

function toHuman(bi?: bigint, decimals = 18, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

function isValidNumberString(s: string) {
  // allow "", "0", "0.", "1.23", but not letters or multiple dots
  return /^(\d+(\.\d*)?|\.\d+)?$/.test(s);
}

/** ---------- Component ---------- */

export default function DepositWithdraw() {
  const { address, isConnected } = useAccount();
  const connectedChainId = useWagmiChainId();
  const publicClient = usePublicClient();

  // SSR/hydration guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ---- Reads ----
  // Wallet GNO balance
  const { data: walletBal = 0n, refetch: refetchWalletBal } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  // GNO allowance to vault
  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [
      ((address ?? "0x0000000000000000000000000000000000000000") as Address),
      (VAULT_ADDRESS as Address),
    ],
    query: { enabled: Boolean(address) },
  });

  // Vault balances
  const { data: collateral = 0n, refetch: refetchCollateral } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "collateralBalance",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  const { data: totalLocked = 0n, refetch: refetchLocked } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  const { data: free = 0n, refetch: refetchFree } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "freeCollateralOf",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  // ---- Input state ----
  const [amountStr, setAmountStr] = useState<string>("");
  const [infiniteApproval, setInfiniteApproval] = useState<boolean>(true);
  const [message, setMessage] = useState<{ type: "info" | "warn" | "error" | "success"; text: string } | null>(null);

  // Parsed amount in wei
  const amountWei = useMemo(() => {
    try {
      if (!amountStr || !isValidNumberString(amountStr)) return 0n;
      return parseUnits(amountStr, UNDERLYING.decimals);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const hasSufficientWallet = walletBal >= amountWei;
  const hasSufficientFree = free >= amountWei;
  const hasAllowance = allowance >= amountWei;

  // Action states
  const { writeContractAsync, isPending } = useWriteContract();
  const [approving, setApproving] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // ---- Helpers ----
  function setMaxFromWallet() {
    setAmountStr(formatUnits(walletBal, UNDERLYING.decimals));
  }
  function setMaxFromFree() {
    setAmountStr(formatUnits(free, UNDERLYING.decimals));
  }

  function requireConnected(): address is `0x${string}` {
    if (!address) {
      setMessage({ type: "warn", text: "Please connect your wallet." });
      return false;
    }
    return true;
  }

  function requireRightNetwork(): boolean {
    if (connectedChainId && EXPECTED_CHAIN_ID && connectedChainId !== EXPECTED_CHAIN_ID) {
      setMessage({
        type: "warn",
        text: `Wrong network. Please switch to chainId ${EXPECTED_CHAIN_ID}.`,
      });
      return false;
    }
    return true;
  }

  function requirePositiveAmount(): boolean {
    if (amountWei === 0n) {
      setMessage({ type: "warn", text: "Enter a positive amount." });
      return false;
    }
    return true;
  }

  async function waitReceipt(txHash: `0x${string}`) {
    if (!publicClient) return;
    try {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (e) {
      // ignore, some providers may already be mined by the time we refetch reads
    }
  }

  async function refreshAll() {
    await Promise.all([refetchWalletBal(), refetchAllowance(), refetchCollateral(), refetchLocked(), refetchFree()]);
  }

  // ---- Actions ----
  async function onApprove() {
    setMessage(null);
    if (!requireConnected() || !requireRightNetwork() || !requirePositiveAmount()) return;

    try {
      setApproving(true);

      const value = infiniteApproval ? (2n ** 256n - 1n) : amountWei;
      const hash = await writeContractAsync({
        address: UNDERLYING.address as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [VAULT_ADDRESS as Address, value],
      });
      if (typeof hash === "string" && hash.startsWith("0x")) {
        await waitReceipt(hash as `0x${string}`);
      }

      await refetchAllowance();
      setMessage({ type: "success", text: `Approved ${infiniteApproval ? "infinite" : amountStr} ${UNDERLYING.symbol}.` });
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? "Approve failed";
      setMessage({ type: "error", text: msg });
    } finally {
      setApproving(false);
    }
  }

  async function onDeposit() {
    setMessage(null);
    if (!requireConnected() || !requireRightNetwork() || !requirePositiveAmount()) return;

    if (!hasSufficientWallet) {
      setMessage({ type: "error", text: `Insufficient ${UNDERLYING.symbol} wallet balance.` });
      return;
    }

    try {
      setDepositing(true);

      // Auto-approve if needed (exact amount)
      if (!hasAllowance) {
        const approveHash = await writeContractAsync({
          address: UNDERLYING.address as Address,
          abi: erc20Abi,
          functionName: "approve",
          args: [VAULT_ADDRESS as Address, amountWei],
        });
        if (typeof approveHash === "string" && approveHash.startsWith("0x")) {
          await waitReceipt(approveHash as `0x${string}`);
        }
        await refetchAllowance();
      }

      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "deposit", // << correct function
        args: [amountWei],
      });
      if (typeof hash === "string" && hash.startsWith("0x")) {
        await waitReceipt(hash as `0x${string}`);
      }

      setAmountStr("");
      await refreshAll();
      setMessage({ type: "success", text: "Deposit successful." });
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? "Deposit failed";
      setMessage({ type: "error", text: msg });
    } finally {
      setDepositing(false);
    }
  }

  async function onWithdraw() {
    setMessage(null);
    if (!requireConnected() || !requireRightNetwork() || !requirePositiveAmount()) return;

    if (!hasSufficientFree) {
      setMessage({ type: "error", text: "Amount exceeds your free collateral." });
      return;
    }

    try {
      setWithdrawing(true);
      const hash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "withdraw", // << correct function
        args: [amountWei],
      });
      if (typeof hash === "string" && hash.startsWith("0x")) {
        await waitReceipt(hash as `0x${string}`);
      }

      setAmountStr("");
      await refreshAll();
      setMessage({ type: "success", text: "Withdraw successful." });
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? "Withdraw failed";
      setMessage({ type: "error", text: msg });
    } finally {
      setWithdrawing(false);
    }
  }

  // ---- Render ----
  return (
    <Card className="p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-default-500">Wallet ({UNDERLYING.symbol})</div>
          <div className="text-xl font-semibold">
            {mounted ? `${toHuman(walletBal, UNDERLYING.decimals)} ${UNDERLYING.symbol}` : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-default-500">Collateral</div>
          <div className="text-xl font-semibold">
            {mounted ? `${toHuman(collateral as bigint, UNDERLYING.decimals)} ${UNDERLYING.symbol}` : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-default-500">Locked</div>
          <div className="text-xl font-semibold">
            {mounted ? `${toHuman(totalLocked as bigint, UNDERLYING.decimals)} ${UNDERLYING.symbol}` : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-default-500">Free</div>
          <div className="text-xl font-semibold">
            {mounted ? `${toHuman(free as bigint, UNDERLYING.decimals)} ${UNDERLYING.symbol}` : "—"}
          </div>
        </Card>
      </div>

      {/* Network / connection notices */}
      {mounted && isConnected && EXPECTED_CHAIN_ID && connectedChainId !== EXPECTED_CHAIN_ID && (
        <div className="rounded-xl border border-warning p-3 text-warning text-sm">
          Wrong network connected (chainId {connectedChainId}). Please switch to {EXPECTED_CHAIN_ID}.
        </div>
      )}
      {!isConnected && mounted && (
        <div className="rounded-xl border border-default-200/50 bg-content2 p-3 text-sm text-foreground/70">
          Connect your wallet to deposit/withdraw.
        </div>
      )}

      {/* Amount + actions */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Amount ({UNDERLYING.symbol})
          </label>
          <Input
            placeholder="0.0"
            value={amountStr}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (isValidNumberString(v)) setAmountStr(v);
            }}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
          <div className="flex gap-3 mt-2 text-xs">
            <Button size="sm" variant="bordered" onPress={setMaxFromWallet}>
              Max (Wallet)
            </Button>
            <Button size="sm" variant="bordered" onPress={setMaxFromFree}>
              Max (Free)
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1 md:col-span-1">
          <Checkbox
            isSelected={infiniteApproval}
            onValueChange={setInfiniteApproval}
            className="text-sm"
          >
            Infinite approval
          </Checkbox>
          <Button
            variant="flat"
            onPress={onApprove}
            isDisabled={!mounted || !isConnected || amountWei === 0n || approving}
            isLoading={approving}
            className="h-12"
          >
            {approving ? "Approving..." : "Approve"}
          </Button>
        </div>

        <Button
          color="primary"
          onPress={onDeposit}
          isDisabled={!mounted || !isConnected || depositing || amountWei === 0n}
          isLoading={depositing}
          className="h-12"
        >
          {depositing ? "Depositing..." : "Deposit"}
        </Button>

        <Button
          variant="bordered"
          onPress={onWithdraw}
          isDisabled={!mounted || !isConnected || withdrawing || amountWei === 0n}
          isLoading={withdrawing}
          className="h-12"
        >
          {withdrawing ? "Withdrawing..." : "Withdraw"}
        </Button>
      </div>

      {/* Inline status messages */}
      {message && (
        <div
          className={`rounded-xl p-3 text-sm ${
            message.type === "success"
              ? "border border-success text-success"
              : message.type === "error"
              ? "border border-danger text-danger"
              : message.type === "warn"
              ? "border border-warning text-warning"
              : "border border-default-200 text-default-600"
          }`}
        >
          {message.text}
        </div>
      )}
    </Card>
  );
}