"use client";

import { useEffect, useMemo, useState } from "react";
import { erc20Abi, LOP_V4_GNOSIS } from "@/lib/contracts";
import { Address, erc20Abi as viemErc20Abi, maxUint256 } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";

const ABI = erc20Abi as unknown as typeof viemErc20Abi;

export function useTokenAllowance(token?: Address, spender?: Address) {
  const { address } = useAccount();
  const [decimals, setDecimals] = useState<number>(18);
  const [symbol, setSymbol] = useState<string>("TOKEN");

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: ABI,
    address: token,
    functionName: "allowance",
    args: address && token && spender ? [address, spender] : undefined,
    query: { enabled: !!address && !!token && !!spender },
  });

  const { data: dec } = useReadContract({
    abi: ABI,
    address: token,
    functionName: "decimals",
    query: { enabled: !!token },
  });

  const { data: sym } = useReadContract({
    abi: ABI,
    address: token,
    functionName: "symbol",
    query: { enabled: !!token },
  });

  useEffect(() => {
    if (typeof dec === "number") setDecimals(dec);
    if (typeof sym === "string") setSymbol(sym);
  }, [dec, sym]);

  const { writeContractAsync, isPending } = useWriteContract();

  const approve = async (amount?: bigint) => {
    if (!token || !spender) throw new Error("No token or spender");
    const amt = amount ?? maxUint256; // default to infinite approve
    await writeContractAsync({
      abi: ABI,
      address: token,
      functionName: "approve",
      args: [spender, amt],
    });
    await refetchAllowance();
  };

  const hasEnough = useMemo(() => {
    if (!allowance) return false;
    return (need: bigint) => (allowance as bigint) >= need;
  }, [allowance]);

  return {
    decimals,
    symbol,
    allowance: (allowance as bigint) ?? 0n,
    approve,
    hasEnough,
    isApproving: isPending,
    refetchAllowance,
  };
}