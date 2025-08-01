"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
  useWalletClient,
} from "wagmi";
import {
  Address,
  erc20Abi,
  formatUnits,
  parseUnits,
} from "viem";
import { writeContract } from "viem/actions";
import { Card } from "@heroui/card";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";
import { Checkbox } from "@heroui/checkbox";

import {
  VAULT_ADDRESS,
  vaultAbi,
  CALLTOKEN_ADDRESS,
  erc1155Abi,
} from "@/lib/contracts";
import { getTokenBySymbol } from "@/lib/token";

const UNDERLYING = getTokenBySymbol("GNO");
const SELECTED_KEY = "vault:selectedSeriesId";
const SELECTED_EVENT = "vault:selectedSeriesChanged";

type Notice = {
  id: string;
  type: "success" | "error" | "warning" | "info";
  text: string;
};

function fmt(bi?: bigint, decimals = 18, max = 6) {
  const n = Number(formatUnits(bi ?? 0n, decimals));
  return n.toLocaleString(undefined, {
    maximumFractionDigits: max,
  });
}

function Info({ tip }: { tip: string }) {
  return (
    <Tooltip
      content={tip}
      placement="top"
      offset={6}
    >
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

export default function DepositWithdraw() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  // Selected series ID (set elsewhere in app)
  const [seriesId, setSeriesId] = useState<bigint>();
  
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SELECTED_KEY);
      if (raw) setSeriesId(BigInt(raw));
    } catch {
      // Ignore localStorage errors
    }
    
    const onChange = (e: CustomEvent) =>
      setSeriesId(e.detail ? BigInt(e.detail) : undefined);
    
    window.addEventListener(SELECTED_EVENT, onChange as EventListener);
    return () =>
      window.removeEventListener(SELECTED_EVENT, onChange as EventListener);
  }, []);

  // Reads: wallet balance, vault balances, and ERC-1155 option balance
  const { data: walletBal = 0n, refetch: refetchWallet } = useReadContract({
    address: UNDERLYING.address as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as Address],
    query: { enabled: Boolean(address) },
  });

  const { data: deposited = 0n, refetch: refetchDeposited } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "collateralBalance",
    args: [address as Address],
    query: { enabled: Boolean(address) },
  });

  const { data: locked = 0n, refetch: refetchLocked } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [address as Address],
    query: { enabled: Boolean(address) },
  });

  const { data: free = 0n, refetch: refetchFree } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "freeCollateralOf",
    args: [address as Address],
    query: { enabled: Boolean(address) },
  });

  const { data: bal1155 = 0n, refetch: refetch1155 } = useReadContract({
    address: CALLTOKEN_ADDRESS as Address,
    abi: erc1155Abi,
    functionName: "balanceOf",
    args: seriesId && address ? [address as Address, seriesId] : undefined,
    query: { enabled: Boolean(seriesId && address) },
  });

  // Inputs & local UI state
  const [amtStr, setAmtStr] = useState("");
  const [infiniteApproval, setInfiniteApproval] = useState(true);
  const [mintQtyStr, setMintQtyStr] = useState("");

  const amtWei = useMemo(() => {
    try {
      return amtStr ? parseUnits(amtStr, UNDERLYING.decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [amtStr]);

  const mintQty = useMemo(() => {
    try {
      return BigInt(mintQtyStr || "0");
    } catch {
      return 0n;
    }
  }, [mintQtyStr]);

  // Notices
  const [notices, setNotices] = useState<Notice[]>([]);
  
  const pushNotice = useCallback((type: Notice["type"], text: string) => {
    const id = crypto.randomUUID();
    setNotices((prev) => [...prev, { id, type, text }]);
    
    // Auto-clear success notices after 5 seconds
    if (type === "success") {
      setTimeout(() => {
        setNotices((prev) => prev.filter((n) => n.id !== id));
      }, 5000);
    }
  }, []);

  const clearNotice = useCallback((id: string) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Busy state
  const [busy, setBusy] = useState<"deposit" | "withdraw" | "mint" | null>(null);

  const waitReceipt = useCallback(async (hash?: `0x${string}`) => {
    if (hash && publicClient) {
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }, [publicClient]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchWallet(),
      refetchDeposited(),
      refetchLocked(),
      refetchFree(),
      seriesId ? refetch1155() : Promise.resolve(),
    ]);
  }, [refetchWallet, refetchDeposited, refetchLocked, refetchFree, refetch1155, seriesId]);

  // Ensure allowance
  const approveIfNeeded = useCallback(async () => {
    if (!address || deposited >= amtWei) return;
    if (!walletClient) {
      throw new Error("Wallet client not available");
    }

    const value = infiniteApproval ? 2n ** 256n - 1n : amtWei;
    const tx = await writeContract(walletClient, {
      address: UNDERLYING.address as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [VAULT_ADDRESS as Address, value],
    });
    await waitReceipt(tx);
    await refetchDeposited();
    pushNotice("success", `Approved ${UNDERLYING.symbol}`);
  }, [address, deposited, amtWei, walletClient, infiniteApproval, waitReceipt, refetchDeposited, pushNotice]);

  // Actions
  const onDeposit = useCallback(async () => {
    if (!address || amtWei === 0n) {
      return pushNotice("warning", "Enter amount");
    }
    if (walletBal < amtWei) {
      return pushNotice("warning", "Insufficient GNO");
    }
    if (!walletClient) {
      return pushNotice("error", "Wallet not connected");
    }

    setBusy("deposit");
    try {
      await approveIfNeeded();
      const tx = await writeContract(walletClient, {
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "deposit",
        args: [amtWei],
      });
      await waitReceipt(tx);
      setAmtStr("");
      await refetchAll();
      pushNotice(
        "success",
        `Deposited ${formatUnits(amtWei, UNDERLYING.decimals)} ${UNDERLYING.symbol}`
      );
    } catch (error: any) {
      console.error("Deposit error:", error);
      pushNotice("error", error?.shortMessage || error?.message || "Deposit failed");
    } finally {
      setBusy(null);
    }
  }, [address, amtWei, walletBal, walletClient, approveIfNeeded, waitReceipt, refetchAll, pushNotice]);

  const onWithdraw = useCallback(async () => {
    if (!address || amtWei === 0n) {
      return pushNotice("warning", "Enter amount");
    }
    if (free < amtWei) {
      return pushNotice("warning", "Insufficient free collateral");
    }
    if (!walletClient) {
      return pushNotice("error", "Wallet not connected");
    }

    setBusy("withdraw");
    try {
      const tx = await writeContract(walletClient, {
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [amtWei],
      });
      await waitReceipt(tx);
      setAmtStr("");
      await refetchAll();
      pushNotice(
        "success",
        `Withdrew ${formatUnits(amtWei, UNDERLYING.decimals)} ${UNDERLYING.symbol}`
      );
    } catch (error: any) {
      console.error("Withdraw error:", error);
      pushNotice("error", error?.shortMessage || error?.message || "Withdraw failed");
    } finally {
      setBusy(null);
    }
  }, [address, amtWei, free, walletClient, waitReceipt, refetchAll, pushNotice]);

  const onMint = useCallback(async () => {
    if (!address) {
      return pushNotice("warning", "Connect wallet");
    }
    if (!seriesId) {
      return pushNotice("warning", "Select series");
    }
    if (mintQty === 0n) {
      return pushNotice("warning", "Enter mint quantity");
    }
    if (!walletClient) {
      return pushNotice("error", "Wallet not connected");
    }
    if (!publicClient) {
      return pushNotice("error", "Public client not available");
    }

    setBusy("mint");
    try {
      let gas: bigint;
      try {
        gas = ((await publicClient.estimateContractGas({
          address: VAULT_ADDRESS,
          abi: vaultAbi,
          functionName: "mintOptions",
          args: [seriesId, mintQty],
          account: address as Address,
        })) * 12n) / 10n;
      } catch {
        gas = 600_000n;
      }
      
      const tx = await writeContract(walletClient, {
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "mintOptions",
        args: [seriesId, mintQty],
        gas,
      });
      await waitReceipt(tx);
      setMintQtyStr("");
      await refetchAll();
      pushNotice("success", `Minted ${mintQty.toString()} options`);
    } catch (error: any) {
      console.error("Mint error:", error);
      pushNotice("error", error?.shortMessage || error?.message || "Mint failed");
    } finally {
      setBusy(null);
    }
  }, [address, seriesId, mintQty, walletClient, publicClient, waitReceipt, refetchAll, pushNotice]);

  const handleMaxClick = useCallback(() => {
    setAmtStr(formatUnits(walletBal, UNDERLYING.decimals));
  }, [walletBal]);

  // Watch events and refetch
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Deposited",
    onLogs: () => void refetchAll(),
  });

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Withdrawn",
    onLogs: () => void refetchAll(),
  });

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Minted",
    onLogs: () => void refetchAll(),
  });

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Reclaimed",
    onLogs: () => void refetchAll(),
  });

  // Render
  const hasAllowance = deposited >= amtWei;

  return (
    <Card className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="text-center">
        <h3 className="text-xl font-semibold mb-2">
          Deposit & Withdraw Collateral
        </h3>
        <p className="text-sm text-default-600">
          Manage your {UNDERLYING.symbol} collateral and mint option tokens
        </p>
      </div>

      {/* Notices */}
      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((n) => (
            <div
              key={n.id}
              className={`flex justify-between items-center p-3 text-sm rounded-lg ${
                n.type === "success"
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : n.type === "error"
                  ? "bg-red-50 border border-red-200 text-red-800"
                  : "bg-yellow-50 border border-yellow-200 text-yellow-800"
              }`}
            >
              <span>{n.text}</span>
              <button
                className="text-lg font-bold opacity-50 hover:opacity-100 leading-none ml-2"
                onClick={() => clearNotice(n.id)}
                aria-label="Close notification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Balances */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          {
            label: "Wallet Balance",
            value: walletBal,
            tip: `Your on-chain ${UNDERLYING.symbol} balance`,
          },
          {
            label: "Collateral Deposited",
            value: deposited,
            tip: `Total ${UNDERLYING.symbol} deposited in vault`,
          },
          {
            label: "Locked Collateral",
            value: locked,
            tip: `Collateral backing your minted options`,
          },
          {
            label: "Free Collateral",
            value: free,
            tip: `Withdrawal-eligible collateral`,
          },
        ].map(({ label, value, tip }) => (
          <Card key={label} className="p-4 bg-default-50">
            <div className="flex items-center gap-1 text-sm text-default-500 mb-1">
              {label} <Info tip={tip} />
            </div>
            <div className="text-lg font-semibold">
              {fmt(value, UNDERLYING.decimals)}
            </div>
            <div className="text-xs text-default-600">
              {UNDERLYING.symbol}
            </div>
          </Card>
        ))}
        
        <Card className="p-4 bg-default-50">
          <div className="flex items-center gap-1 text-sm text-default-500 mb-1">
            Your Options <Info tip="Unwrapped options for the selected series" />
          </div>
          <div className="text-lg font-semibold">
            {seriesId ? bal1155.toString() : "—"}
          </div>
          <div className="text-xs text-default-600">
            {seriesId ? "ERC-1155 tokens" : "Select a series first"}
          </div>
        </Card>
      </div>

      {/* Deposit / Withdraw Section */}
      <div className="space-y-4">
        <h4 className="font-medium text-lg">Manage Collateral</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-6 space-y-2">
            <label className="flex items-center gap-1 text-sm font-medium">
              Amount ({UNDERLYING.symbol}) <Info tip="How much to deposit or withdraw" />
            </label>
            <Input
              placeholder="0.0"
              value={amtStr}
              onChange={(e) => setAmtStr(e.target.value)}
              type="number"
              step="0.001"
              min="0"
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm",
              }}
              endContent={
                <button
                  className="text-xs text-primary hover:text-primary-600 px-2"
                  onClick={handleMaxClick}
                  type="button"
                >
                  Max
                </button>
              }
            />
            
            <Checkbox
              className="text-xs"
              isSelected={infiniteApproval}
              onValueChange={setInfiniteApproval}
            >
              Infinite approval (saves gas on future deposits)
            </Checkbox>
          </div>

          <Button
            onPress={onDeposit}
            isDisabled={!address || amtWei === 0n || busy !== null}
            isLoading={busy === "deposit"}
            className="md:col-span-3 h-12"
            color="primary"
          >
            {busy === "deposit" ? "Depositing..." : "Deposit"}
          </Button>

          <Button
            variant="bordered"
            onPress={onWithdraw}
            isDisabled={!address || amtWei === 0n || busy !== null}
            isLoading={busy === "withdraw"}
            className="md:col-span-3 h-12"
          >
            {busy === "withdraw" ? "Withdrawing..." : "Withdraw"}
          </Button>
        </div>

        {!hasAllowance && amtWei > 0n && (
          <div className="text-xs text-default-600 bg-blue-50 p-2 rounded border border-blue-200">
            💡 You'll be prompted to approve {UNDERLYING.symbol} before depositing.
          </div>
        )}
      </div>

      {/* Mint Options Section */}
      <div className="space-y-4">
        <h4 className="font-medium text-lg">Mint Options</h4>
        
        {!seriesId && (
          <div className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded border border-yellow-200">
            ⚠️ Please select a series first to mint options
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-9 space-y-2">
            <label className="flex items-center gap-1 text-sm font-medium">
              Quantity to Mint <Info tip="How many option tokens to mint" />
            </label>
            <Input
              placeholder="e.g. 1"
              value={mintQtyStr}
              onChange={(e) => setMintQtyStr(e.target.value)}
              type="number"
              step="1"
              min="0"
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm",
              }}
            />
            <div className="text-xs text-default-600">
              {mintQty > 0n && seriesId && (
                <>Required collateral: {fmt(mintQty * 1000000000000000n, UNDERLYING.decimals)} {UNDERLYING.symbol}</>
              )}
            </div>
          </div>

          <Button
            onPress={onMint}
            isDisabled={!address || mintQty === 0n || !seriesId || busy !== null}
            isLoading={busy === "mint"}
            className="md:col-span-3 h-12"
            color="secondary"
          >
            {busy === "mint" ? "Minting..." : "Mint Options"}
          </Button>
        </div>
      </div>
    </Card>
  );
}