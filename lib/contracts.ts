/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Address } from "viem";

/* ----------------------------- Env & Constants ---------------------------- */

const asAddress = (v?: string) =>
  (v?.match(/^0x[a-fA-F0-9]{40}$/)
    ? (v as `0x${string}`)
    : ("0x0000000000000000000000000000000000000000" as const));

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "100"); // Gnosis (100) by default
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.gnosis.gateway.fm";

export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER ?? "https://gnosisscan.io";

/** 1inch Limit Order Protocol v4 (Gnosis) */
export const LOP_V4_GNOSIS =
  asAddress(process.env.NEXT_PUBLIC_LOP) ||
  ("0x111111125421ca6dc452d289314280a0f8842a65" as const);

/** 1inch Orderbook API (v4) */
export const ORDERBOOK_API_BASE =
  process.env.NEXT_PUBLIC_ONEINCH_ORDERBOOK_API ??
  "https://orderbook-api.1inch.io";

/** Public 1inch key for any client-side calls you might make (optional) */
export const ONEINCH_AUTH_KEY = process.env.NEXT_PUBLIC_ONEINCH_AUTH_KEY ?? "";

/** Core contracts (your deployments) */
export const VAULT_ADDRESS = asAddress(process.env.NEXT_PUBLIC_VAULT_ADDRESS);
export const CALLTOKEN_ADDRESS = asAddress(
  process.env.NEXT_PUBLIC_CALLTOKEN_ADDRESS
);

/** NEW: ERC-1155 proxy to adapt safeTransferFrom to IERC20.transferFrom semantics */
export const ERC1155_PROXY_ADDRESS = asAddress(
  process.env.NEXT_PUBLIC_ERC1155_PROXY_ADDRESS
);

/** Optional: oracle for GNO/WXDAI (1e18) */
export const ORACLE_GNO_WXDAI = asAddress(
  process.env.NEXT_PUBLIC_ORACLE_GNO_WXDAI
);

/* --------------------------------- ABIs ---------------------------------- */
/** OptionsVault ABI (subset focused on what the app calls/reads) */
export const vaultAbi = [
  // AccessControl
  {
    type: "function",
    stateMutability: "view",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },

  // defineSeries + event
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "defineSeries",
    inputs: [
      { name: "underlying", type: "address" },
      { name: "underlyingDecimals", type: "uint8" },
      { name: "strike", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "collateralPerOption", type: "uint256" },
      { name: "oracle", type: "address" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "event",
    name: "SeriesDefined",
    inputs: [
      { indexed: true, name: "id", type: "uint256" },
      { indexed: true, name: "underlying", type: "address" },
      { indexed: false, name: "strike", type: "uint256" },
      { indexed: false, name: "expiry", type: "uint64" },
    ],
    anonymous: false,
  },

  // collateral
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "deposit",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "withdraw",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "freeCollateralOf",
    inputs: [{ name: "maker", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "collateralBalance",
    inputs: [{ name: "maker", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "totalLocked",
    inputs: [{ name: "maker", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { indexed: true, name: "maker", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { indexed: true, name: "maker", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },

  // mintOptions + event
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "mintOptions",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "qty", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Minted",
    inputs: [
      { indexed: true, name: "maker", type: "address" },
      { indexed: true, name: "id", type: "uint256" },
      { indexed: false, name: "qty", type: "uint256" },
      { indexed: false, name: "collateralLocked", type: "uint256" },
    ],
    anonymous: false,
  },

  // settlement, exercise, reclaim
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "settleSeries",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { indexed: true, name: "id", type: "uint256" },
      { indexed: false, name: "priceWXDAI", type: "uint256" },
      { indexed: false, name: "inTheMoneyAtSettle", type: "bool" },
    ],
    anonymous: false,
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "exercise",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "qty", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Exercised",
    inputs: [
      { indexed: true, name: "holder", type: "address" },
      { indexed: true, name: "id", type: "uint256" },
      { indexed: false, name: "qty", type: "uint256" },
      { indexed: false, name: "payoffUnderlying", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ExercisePayout",
    inputs: [
      { indexed: true, name: "id", type: "uint256" },
      { indexed: true, name: "holder", type: "address" },
      { indexed: false, name: "qty", type: "uint256" },
      { indexed: false, name: "payout", type: "uint256" },
      { indexed: false, name: "totalExerciseOutAfter", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "reclaim",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event",
    name: "ReclaimCalculated",
    inputs: [
      { indexed: true, name: "maker", type: "address" },
      { indexed: true, name: "id", type: "uint256" },
      { indexed: false, name: "makerLockedBefore", type: "uint256" },
      { indexed: false, name: "exerciseShare", type: "uint256" },
      { indexed: false, name: "reclaimed", type: "uint256" },
      { indexed: false, name: "totalLockedBySeriesAfter", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Reclaimed",
    inputs: [
      { indexed: true, name: "maker", type: "address" },
      { indexed: true, name: "id", type: "uint256" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
    anonymous: false,
  },

  // views
  {
    type: "function",
    stateMutability: "view",
    name: "series",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "underlying", type: "address" },
      { name: "underlyingDecimals", type: "uint8" },
      { name: "strike", type: "uint256" },
      { name: "expiry", type: "uint64" },
      { name: "collateralPerOption", type: "uint256" },
      { name: "oracle", type: "address" },
      { name: "settled", type: "bool" },
    ],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "settlePrice",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "lockedPerSeries",
    inputs: [
      { name: "maker", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "totalLockedBySeries",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "lockedBaselineAtSettle",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "totalExerciseOut",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "exerciseShareOf",
    inputs: [
      { name: "maker", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "reclaimableOf",
    inputs: [
      { name: "maker", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [
      { name: "reclaimable", type: "uint256" },
      { name: "exerciseShare", type: "uint256" },
    ],
  },

  // admin
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "pause",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "unpause",
    inputs: [],
    outputs: [],
  },
] as const;

/* ------------------------------ CallToken (ERC1155) ------------------------------ */
export const erc1155Abi = [
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "isApprovedForAll",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "safeTransferFrom",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/* ---------------------------------- ERC-20 ---------------------------------- */
export const erc20Abi = [
  {
    type: "function",
    stateMutability: "view",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/* --------------------- ERC-1155 -> IERC20 Transfer Proxy (custom) --------------------- */
/**
 * Minimal ABI for a proxy that exposes a function sharing the IERC20.transferFrom selector
 * and internally calls ERC1155.safeTransferFrom with (id, value, data) taken from extra args.
 */
export const erc1155ProxyAbi = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "transferFrom", // must share IERC20.transferFrom selector (0x23b872dd)
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }, // value
      { name: "id", type: "uint256" },
      { name: "token", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/* ------------------------------- Convenience ------------------------------- */
export const ADDRESSES = {
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
  explorer: EXPLORER_URL,
  oneInchLopV4: LOP_V4_GNOSIS,
  orderbookApiBase: ORDERBOOK_API_BASE,
  oneInchAuthKey: ONEINCH_AUTH_KEY,
  vault: VAULT_ADDRESS,
  callToken1155: CALLTOKEN_ADDRESS,
  erc1155Proxy: ERC1155_PROXY_ADDRESS,
  oracleGnoWx: ORACLE_GNO_WXDAI,
} as const;