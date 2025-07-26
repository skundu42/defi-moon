// components/DepositWithdraw.tsx
"use client";

import React, { useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import { Address, erc20Abi, formatUnits, parseUnits } from "viem";
import { Card } from "@heroui/card";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";

import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { getTokenBySymbol } from "@/lib/token";

// ---- Helpers ----
const UNDERLYING = getTokenBySymbol("GNO"); // vault’s underlying on Gnosis (18 decimals)

function fmt(bi?: bigint, decimals = 18, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

/** Small round "i" badge with a tooltip */
function Info({ tip, className = "" }: { tip: string; className?: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span
        className={`inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help ${className}`}
        aria-label="info"
      >
        i
      </span>
    </Tooltip>
  );
}

export default function DepositWithdraw() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  // ---------- Reads ----------
  const {
    data: gnoBal = 0n,
    refetch: refetchWallet,
  } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  const {
    data: allowance = 0n,
    refetch: refetchAllowance,
  } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [
      ((address ?? "0x0000000000000000000000000000000000000000") as Address),
      (VAULT_ADDRESS as Address),
    ],
    query: { enabled: Boolean(address) },
  });

  const {
    data: collateral = 0n,
    refetch: refetchVaultCollateral,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "collateralBalance",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  const {
    data: totalLocked = 0n,
    refetch: refetchTotalLocked,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  const {
    data: free = 0n,
    refetch: refetchFree,
  } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "freeCollateralOf",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as Address)],
    query: { enabled: Boolean(address) },
  });

  // ---------- Inputs ----------
  const [amountStr, setAmountStr] = useState<string>("");

  const amountWei = useMemo(() => {
    try {
      if (!amountStr) return 0n;
      return parseUnits(amountStr, UNDERLYING.decimals);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const hasAllowance = allowance >= amountWei;

  // ---------- Writes ----------
  const { writeContractAsync, isPending } = useWriteContract();

  async function waitReceipt(hash?: `0x${string}`) {
    if (!hash || !publicClient) return;
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } catch {
      // ignore; we still refetch below
    }
  }

  async function refetchAll() {
    await Promise.all([
      refetchWallet(),
      refetchAllowance(),
      refetchVaultCollateral(),
      refetchTotalLocked(),
      refetchFree(),
    ]);
  }

  async function approveIfNeeded() {
    if (!address) return;
    if (hasAllowance) return;
    const hash = await writeContractAsync({
      address: UNDERLYING.address as Address,
      abi: erc20Abi,
      functionName: "approve",
      // (Optionally: MaxUint256 for “infinite” approval UX)
      args: [VAULT_ADDRESS as Address, amountWei],
    });
    await waitReceipt(hash as `0x${string}`);
    await refetchAllowance();
  }

  async function onDeposit() {
    if (!address) return;
    if (amountWei === 0n) return alert("Enter an amount");
    if (gnoBal < amountWei) return alert(`Insufficient ${UNDERLYING.symbol} balance`);

    if (!hasAllowance) {
      await approveIfNeeded();
    }

    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "deposit",
      args: [amountWei],
    });

    await waitReceipt(hash as `0x${string}`);
    setAmountStr("");
    await refetchAll();
  }

  async function onWithdraw() {
    if (!address) return;
    if (amountWei === 0n) return alert("Enter an amount");
    if (free < amountWei) return alert("Amount exceeds your free collateral");

    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [amountWei],
    });

    await waitReceipt(hash as `0x${string}`);
    setAmountStr("");
    await refetchAll();
  }

  // ---------- Event listeners (auto-sync if actions happen elsewhere) ----------
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Deposited",
    enabled: Boolean(isConnected),
    onLogs: async (logs) => {
      const mine = logs.some(
        (l) => (l.args?.maker as string)?.toLowerCase() === address?.toLowerCase()
      );
      if (mine) await refetchAll();
    },
  });

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Withdrawn",
    enabled: Boolean(isConnected),
    onLogs: async (logs) => {
      const mine = logs.some(
        (l) => (l.args?.maker as string)?.toLowerCase() === address?.toLowerCase()
      );
      if (mine) await refetchAll();
    },
  });

  // Locking & reclaim events also affect Free (and your withdrawable amount)
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Minted", // Minted(address maker, uint256 id, uint256 qty, uint256 collateralLocked)
    enabled: Boolean(isConnected),
    onLogs: async (logs) => {
      const mine = logs.some(
        (l) => (l.args?.maker as string)?.toLowerCase() === address?.toLowerCase()
      );
      if (mine) await refetchAll();
    },
  });

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Reclaimed", // Reclaimed(address maker, uint256 id, uint256 amount)
    enabled: Boolean(isConnected),
    onLogs: async (logs) => {
      const mine = logs.some(
        (l) => (l.args?.maker as string)?.toLowerCase() === address?.toLowerCase()
      );
      if (mine) await refetchAll();
    },
  });

  return (
    <Card className="p-5 space-y-4">
      {/* Balances */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Wallet ({UNDERLYING.symbol})
            <Info tip="Your wallet balance (outside the vault)." />
          </div>
          <div className="text-xl font-semibold">
            {fmt(gnoBal, UNDERLYING.decimals)} {UNDERLYING.symbol}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Collateral
            <Info tip="Total amount you’ve deposited into the vault." />
          </div>
          <div className="text-xl font-semibold">
            {fmt(collateral as bigint, UNDERLYING.decimals)} {UNDERLYING.symbol}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Locked
            <Info tip="Portion of your collateral reserved to back options you’ve minted. Not withdrawable until settlement + reclaim." />
          </div>
          <div className="text-xl font-semibold">
            {fmt(totalLocked as bigint, UNDERLYING.decimals)} {UNDERLYING.symbol}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Free
            <Info tip="Withdrawable now or usable to mint more options. Computed as: Free = Collateral − Locked." />
          </div>
          <div className="text-xl font-semibold">
            {fmt(free as bigint, UNDERLYING.decimals)} {UNDERLYING.symbol}
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="flex items-center gap-1 mb-1 text-sm font-medium">
            Amount ({UNDERLYING.symbol})
            <Info tip={`Enter the amount of ${UNDERLYING.symbol} to deposit (into the vault) or withdraw (from your Free).`} />
          </label>
          <Input
            placeholder="0.0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            endContent={
              <button
                type="button"
                className="text-xs text-primary"
                onClick={() => setAmountStr(formatUnits(gnoBal, UNDERLYING.decimals))}
                disabled={!isConnected || gnoBal === 0n}
                title="Use max wallet balance"
              >
                Max
              </button>
            }
          />
        </div>

        <Button
          onPress={onDeposit}
          isDisabled={!address || isPending || amountWei === 0n}
          isLoading={isPending}
          className="h-12"
          color="primary"
        >
          Deposit
        </Button>

        <Button
          variant="bordered"
          onPress={onWithdraw}
          isDisabled={!address || isPending || amountWei === 0n}
          isLoading={isPending}
          className="h-12"
        >
          Withdraw
        </Button>
      </div>

      {!hasAllowance && amountWei > 0n && (
        <div className="text-xs text-default-500">
          You’ll be asked to approve {UNDERLYING.symbol} to the vault before depositing.
        </div>
      )}
    </Card>
  );
}