"use client";

import React, { useEffect, useMemo, useState } from "react";
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
    } catch {}
    const onChange = (e: any) =>
      setSeriesId(e.detail ? BigInt(e.detail) : undefined);
    window.addEventListener(SELECTED_EVENT, onChange);
    return () =>
      window.removeEventListener(SELECTED_EVENT, onChange);
  }, []);

  // Reads: wallet balance, vault balances, and ERC-1155 option balance
  const { data: walletBal = 0n, refetch: refetchWallet } =
    useReadContract({
      address: UNDERLYING.address as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as Address],
      enabled: Boolean(address),
    });
  const { data: deposited = 0n, refetch: refetchDeposited } =
    useReadContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "collateralBalance",
      args: [address as Address],
      enabled: Boolean(address),
    });
  const { data: locked = 0n, refetch: refetchLocked } =
    useReadContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "totalLocked",
      args: [address as Address],
      enabled: Boolean(address),
    });
  const { data: free = 0n, refetch: refetchFree } =
    useReadContract({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "freeCollateralOf",
      args: [address as Address],
      enabled: Boolean(address),
    });
  const { data: bal1155 = 0n, refetch: refetch1155 } =
    useReadContract({
      address: CALLTOKEN_ADDRESS as Address,
      abi: erc1155Abi,
      functionName: "balanceOf",
      args:
        seriesId && address
          ? [address as Address, seriesId]
          : undefined,
      enabled: Boolean(seriesId && address),
    });

  // Inputs & local UI state
  const [amtStr, setAmtStr] = useState("");
  const [infiniteApproval, setInfiniteApproval] =
    useState(true);
  const [mintQtyStr, setMintQtyStr] = useState("");

  const amtWei = useMemo(() => {
    try {
      return amtStr
        ? parseUnits(amtStr, UNDERLYING.decimals)
        : 0n;
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
  const pushNotice = (type: Notice["type"], text: string) =>
    setNotices((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, text },
    ]);
  const clearNotice = (id: string) =>
    setNotices((prev) => prev.filter((n) => n.id !== id));

  // Busy state
  const [busy, setBusy] = useState<
    "deposit" | "withdraw" | "mint" | null
  >(null);

  async function waitReceipt(hash?: `0x${string}`) {
    if (hash)
      await publicClient.waitForTransactionReceipt({ hash });
  }
  async function refetchAll() {
    await Promise.all([
      refetchWallet(),
      refetchDeposited(),
      refetchLocked(),
      refetchFree(),
      seriesId ? refetch1155() : Promise.resolve(),
    ]);
  }

  // Ensure allowance
  async function approveIfNeeded() {
    if (!address || deposited >= amtWei) return;
    if (!walletClient)
      throw new Error("Wallet client not available");

    const value = infiniteApproval
      ? 2n ** 256n - 1n
      : amtWei;
    const tx = await writeContract(walletClient, {
      address: UNDERLYING.address as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [VAULT_ADDRESS as Address, value],
    });
    await waitReceipt(tx);
    await refetchDeposited();
    pushNotice("success", `Approved ${UNDERLYING.symbol}`);
  }

  // Actions
  async function onDeposit() {
    if (!address || amtWei === 0n)
      return pushNotice("warning", "Enter amount");
    if (walletBal < amtWei)
      return pushNotice("warning", "Insufficient GNO");
    if (!walletClient)
      return pushNotice("error", "Wallet not connected");

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
        `Deposited ${formatUnits(
          amtWei,
          UNDERLYING.decimals
        )}`
      );
    } catch (e: any) {
      pushNotice("error", e.message || "Deposit failed");
    } finally {
      setBusy(null);
    }
  }

  async function onWithdraw() {
    if (!address || amtWei === 0n)
      return pushNotice("warning", "Enter amount");
    if (free < amtWei)
      return pushNotice(
        "warning",
        "Insufficient free collateral"
      );
    if (!walletClient)
      return pushNotice("error", "Wallet not connected");

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
        `Withdrew ${formatUnits(
          amtWei,
          UNDERLYING.decimals
        )}`
      );
    } catch (e: any) {
      pushNotice("error", e.message || "Withdraw failed");
    } finally {
      setBusy(null);
    }
  }

  async function onMint() {
    if (!address)
      return pushNotice("warning", "Connect wallet");
    if (!seriesId)
      return pushNotice("warning", "Select series");
    if (mintQty === 0n)
      return pushNotice("warning", "Enter mint quantity");
    if (!walletClient)
      return pushNotice("error", "Wallet not connected");

    setBusy("mint");
    try {
      let gas: bigint;
      try {
        gas =
          (await publicClient.estimateContractGas({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "mintOptions",
            args: [seriesId, mintQty],
            account: address as Address,
          })) *
          12n /
          10n;
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
      pushNotice("success", `Minted ${mintQty} options`);
    } catch (e: any) {
      pushNotice("error", e.message || "Mint failed");
    } finally {
      setBusy(null);
    }
  }

  // Watch events and refetch
  ["Deposited", "Withdrawn", "Minted", "Reclaimed"].forEach(
    (ev) =>
      useWatchContractEvent({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        eventName: ev,
        onLogs: () => void refetchAll(),
      })
  );

  // Render
  const hasAllowance = deposited >= amtWei;

  return (
    <Card className="p-5 space-y-4">
      {/* Notices */}
      {notices.map((n) => (
        <div
          key={n.id}
          className={`flex justify-between items-center p-3 text-sm rounded-xl ${
            n.type === "success"
              ? "border-success text-success border"
              : n.type === "error"
              ? "border-danger text-danger border"
              : "border-warning text-warning border"
          }`}
        >
          {n.text}
          <button
            className="text-xs"
            onClick={() => clearNotice(n.id)}
          >
            ×
          </button>
        </div>
      ))}

      {/* Balances */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
          <Card key={label} className="p-4">
            <div className="flex items-center gap-1 text-sm text-default-500">
              {label} <Info tip={tip} />
            </div>
            <div className="text-xl font-semibold">
              {fmt(value, UNDERLYING.decimals)}{" "}
              {UNDERLYING.symbol}
            </div>
          </Card>
        ))}
        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Your Options (ERC-1155){" "}
            <Info tip="Unwrapped options for the selected series" />
          </div>
          <div className="text-xl font-semibold">
            {seriesId ? bal1155.toString() : "—"}
          </div>
          <div className="text-xs mt-1">
            {seriesId
              ? "Updates on mint/burn"
              : "Select a series first"}
          </div>
        </Card>
      </div>

      {/* Deposit / Withdraw */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="flex items-center gap-1 mb-1 text-sm font-medium">
            Amount ({UNDERLYING.symbol}){" "}
            <Info tip="How much to deposit or withdraw" />
          </label>
          <Input
            placeholder="0.0"
            value={amtStr}
            onChange={(e) => setAmtStr(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
            endContent={
              <button
                className="text-xs text-primary"
                onClick={() =>
                  setAmtStr(
                    formatUnits(
                      walletBal,
                      UNDERLYING.decimals
                    )
                  )
                }
              >
                Max
              </button>
            }
          />
          <Checkbox
            className="mt-2 text-xs"
            isSelected={infiniteApproval}
            onValueChange={setInfiniteApproval}
          >
            Infinite approval
          </Checkbox>
        </div>
        <Button
          onPress={onDeposit}
          isDisabled={!address || amtWei === 0n || busy !== null}
          isLoading={busy === "deposit"}
          className="md:col-span-1 h-12 w-full"
          color="primary"
        >
          Deposit
        </Button>
        <Button
          variant="bordered"
          onPress={onWithdraw}
          isDisabled={!address || amtWei === 0n || busy !== null}
          isLoading={busy === "withdraw"}
          className="md:col-span-1 h-12 w-full"
        >
          Withdraw
        </Button>
      </div>

      {/* Mint Options */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Qty to Mint{" "}
            <Info tip="How many options to mint" />
          </label>
          <Input
            placeholder="e.g. 1"
            value={mintQtyStr}
            onChange={(e) => setMintQtyStr(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
        </div>
        <Button
          onPress={onMint}
          isDisabled={
            !address ||
            mintQty === 0n ||
            !seriesId ||
            busy !== null
          }
          isLoading={busy === "mint"}
          className="md:col-span-1 h-12 w-full"
          color="secondary"
        >
          Mint Options
        </Button>
      </div>
      {!hasAllowance && amtWei > 0n && (
        <div className="text-xs text-default-500">
          You’ll be prompted to approve {UNDERLYING.symbol} before
          depositing.
        </div>
      )}
    </Card>
  );
}