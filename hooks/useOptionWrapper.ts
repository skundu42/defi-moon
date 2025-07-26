"use client";

import { Address, erc20Abi, zeroAddress } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import {
  CALLTOKEN_ADDRESS,
  WRAPPER_ADDRESS,
  erc1155Abi,
  wrapperAbi,
} from "@/lib/contracts";

export function useOptionWrapper(seriesId?: bigint) {
  const { address } = useAccount();

  // Series ERC-20 address
  const { data: erc20Addr } = useReadContract({
    address: WRAPPER_ADDRESS,
    abi: wrapperAbi,
    functionName: "erc20For",
    args: seriesId !== undefined ? [seriesId] : undefined,
    query: { enabled: !!seriesId && WRAPPER_ADDRESS !== zeroAddress },
  });

  // isApprovedForAll(CallToken, wrapper)
  const { data: isApproved } = useReadContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "isApprovedForAll",
    args: address && WRAPPER_ADDRESS ? [address, WRAPPER_ADDRESS] : undefined,
    query: { enabled: !!address && WRAPPER_ADDRESS !== zeroAddress && CALLTOKEN_ADDRESS !== zeroAddress },
  });

  // User ERC-1155 balance for this series
  const { data: balance1155 } = useReadContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "balanceOf",
    args: address && seriesId !== undefined ? [address, seriesId] : undefined,
    query: { enabled: !!address && !!seriesId },
  });

  // ERC-20 metadata & balance if exists
  const erc20 = (erc20Addr as Address) ?? undefined;
  const { data: makerBalance20 } = useReadContract({
    address: erc20,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address && erc20 ? [address] : undefined,
    query: { enabled: !!address && !!erc20 },
  });
  const { data: makerSymbol20 } = useReadContract({
    address: erc20,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!erc20 },
  });
  const { data: makerDecimals20 } = useReadContract({
    address: erc20,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!erc20 },
  });

  const write = useWriteContract();

  const setApprovalForAll = async (approved: boolean) => {
    await write.writeContractAsync({
      address: CALLTOKEN_ADDRESS,
      abi: erc1155Abi,
      functionName: "setApprovalForAll",
      args: [WRAPPER_ADDRESS, approved],
    });
  };

  const ensureSeriesERC20 = async (name: string, symbol: string) => {
    if (seriesId === undefined) throw new Error("no seriesId");
    await write.writeContractAsync({
      address: WRAPPER_ADDRESS,
      abi: wrapperAbi,
      functionName: "ensureSeriesERC20",
      args: [seriesId, name, symbol],
    });
  };

  const wrap = async (qty: bigint) => {
    if (seriesId === undefined) throw new Error("no seriesId");
    await write.writeContractAsync({
      address: WRAPPER_ADDRESS,
      abi: wrapperAbi,
      functionName: "wrap",
      args: [seriesId, qty],
    });
  };

  const unwrap = async (amount: bigint) => {
    if (seriesId === undefined) throw new Error("no seriesId");
    await write.writeContractAsync({
      address: WRAPPER_ADDRESS,
      abi: wrapperAbi,
      functionName: "unwrap",
      args: [seriesId, amount],
    });
  };

  return {
    erc20Address: erc20,
    isApprovedForAll: Boolean(isApproved),
    balance1155: (balance1155 as bigint) ?? 0n,

    makerBalance20: (makerBalance20 as bigint) ?? 0n,
    makerSymbol20: (makerSymbol20 as string) ?? "wCALL",
    makerDecimals20: (makerDecimals20 as number) ?? 18,

    setApprovalForAll,
    ensureSeriesERC20,
    wrap,
    unwrap,
  };
}