// components/DepositWithdraw.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
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
import { Checkbox } from "@heroui/checkbox";

import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { getTokenBySymbol } from "@/lib/token";

const UNDERLYING = getTokenBySymbol("GNO");

function fmt(bi?: bigint, decimals = 18, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

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

export default function DepositWithdraw() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const selectedSeriesId = useSelectedSeriesId();

  const { data: gnoBal = 0n, refetch: refetchWallet } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [((address ?? "0x0") as Address)],
    query: { enabled: Boolean(address) },
  });

  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [((address ?? "0x0") as Address), VAULT_ADDRESS as Address],
    query: { enabled: Boolean(address) },
  });

  const { data: collateral = 0n, refetch: refetchVaultCollateral } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "collateralBalance",
    args: [((address ?? "0x0") as Address)],
    query: { enabled: Boolean(address) },
  });

  const { data: totalLocked = 0n, refetch: refetchTotalLocked } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [((address ?? "0x0") as Address)],
    query: { enabled: Boolean(address) },
  });

  const { data: free = 0n, refetch: refetchFree } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "freeCollateralOf",
    args: [((address ?? "0x0") as Address)],
    query: { enabled: Boolean(address) },
  });

  const [amountStr, setAmountStr] = useState<string>("");
  const [infiniteApproval, setInfiniteApproval] = useState(true);
  const [mintQtyStr, setMintQtyStr] = useState<string>("");

  const amountWei = useMemo(() => {
    try {
      if (!amountStr) return 0n;
      return parseUnits(amountStr, UNDERLYING.decimals);
    } catch {
      return 0n;
    }
  }, [amountStr]);

  const mintQty = useMemo(() => {
    try {
      return BigInt(mintQtyStr || "0");
    } catch {
      return 0n;
    }
  }, [mintQtyStr]);

  const hasAllowance = allowance >= amountWei;
  const { writeContractAsync, isPending } = useWriteContract();

  async function waitReceipt(hash?: `0x${string}`) {
    if (!hash || !publicClient) return;
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } catch {}
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
    if (!address || hasAllowance) return;
    const value = infiniteApproval ? (2n ** 256n - 1n) : amountWei;
    const hash = await writeContractAsync({
      address: UNDERLYING.address as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [VAULT_ADDRESS as Address, value],
    });
    await waitReceipt(hash);
    await refetchAllowance();
  }

  async function onDeposit() {
    if (!address || amountWei === 0n) return alert("Enter an amount");
    if (gnoBal < amountWei) return alert("Insufficient balance");
    await approveIfNeeded();
    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "deposit",
      args: [amountWei],
    });
    await waitReceipt(hash);
    setAmountStr("");
    await refetchAll();
  }

  async function onWithdraw() {
    if (!address || amountWei === 0n) return alert("Enter an amount");
    if (free < amountWei) return alert("Insufficient free collateral");
    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [amountWei],
    });
    await waitReceipt(hash);
    setAmountStr("");
    await refetchAll();
  }

  async function onMint() {
    if (!address) return alert("Connect your wallet.");
    if (!selectedSeriesId) return alert("Select a series in the Series section first.");
    if (mintQty === 0n) return alert("Enter a quantity to mint.");
    const hash = await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "mint",
      args: [selectedSeriesId, mintQty],
    });
    await waitReceipt(hash);
    setMintQtyStr("");
    await refetchAll();
  }

  // Light event-based refresh (best effort)
  const handleEvent = async () => {
    await refetchAll();
  };
  ["Deposited", "Withdrawn", "Minted", "Reclaimed"].forEach((event) => {
    useWatchContractEvent({ address: VAULT_ADDRESS, abi: vaultAbi, eventName: event, onLogs: handleEvent });
  });

  return (
    <Card className="p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[{ label: "Wallet", value: gnoBal }, { label: "Collateral", value: collateral }, { label: "Locked", value: totalLocked }, { label: "Free", value: free }].map(({ label, value }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-1 text-sm text-default-500">
              {label} ({UNDERLYING.symbol}) <Info tip={`${label} amount`} />
            </div>
            <div className="text-xl font-semibold">{fmt(value, UNDERLYING.decimals)} {UNDERLYING.symbol}</div>
          </Card>
        ))}
      </div>

      {/* Amount row with aligned buttons */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-3">
          <label className="flex items-center gap-1 mb-1 text-sm font-medium">
            Amount ({UNDERLYING.symbol})
            <Info tip={`Amount of ${UNDERLYING.symbol} to deposit or withdraw.`} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <Input
              placeholder="0.0"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              classNames={{ inputWrapper: "h-12 bg-default-100 col-span-3", input: "text-sm" }}
              endContent={
                <button
                  type="button"
                  className="text-xs text-primary"
                  onClick={() => setAmountStr(formatUnits(gnoBal, UNDERLYING.decimals))}
                >
                  Max
                </button>
              }
            />
            <Button
              onPress={onDeposit}
              isDisabled={!address || isPending || amountWei === 0n}
              isLoading={isPending}
              className="h-12 w-full col-span-1"
              color="primary"
            >
              Deposit
            </Button>
            <Button
              variant="bordered"
              onPress={onWithdraw}
              isDisabled={!address || isPending || amountWei === 0n}
              isLoading={isPending}
              className="h-12 w-full col-span-1"
            >
              Withdraw
            </Button>
          </div>
          <Checkbox
            isSelected={infiniteApproval}
            onValueChange={setInfiniteApproval}
            className="mt-2 text-xs"
          >
            Infinite approval
          </Checkbox>
        </div>
      </div>

      {/* Mint using selected series */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-3">
          <label className="text-sm font-medium mb-1 block">Qty to Mint (options)</label>
          <Input
            value={mintQtyStr}
            onChange={(e) => setMintQtyStr(e.target.value)}
            placeholder="e.g. 10"
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
          <div className="text-xs text-default-500 mt-1">
            Series: {selectedSeriesId ? <span className="font-mono">{selectedSeriesId.toString()}</span> : "— select a series in the Series section —"}
          </div>
        </div>
        <div className="md:col-span-2">
          <Button
            onPress={onMint}
            isDisabled={!address || isPending || mintQty === 0n || !selectedSeriesId}
            isLoading={isPending}
            className="h-12 w-full"
            color="secondary"
          >
            Mint Options
          </Button>
        </div>
      </div>

      {!hasAllowance && amountWei > 0n && (
        <div className="text-xs text-default-500">
          You'll be prompted to approve {UNDERLYING.symbol} before depositing.
        </div>
      )}
    </Card>
  );
}