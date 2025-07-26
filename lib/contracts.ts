import type { Address } from "viem";

/* =========================
 * Addresses from environment
 * ========================= */

export const VAULT_ADDRESS: Address =
  (process.env.NEXT_PUBLIC_VAULT_ADDRESS as Address) ??
  "0x0000000000000000000000000000000000000000";

/** Strongly recommended to bound log scans (e.g. for SeriesTable). */
export const VAULT_DEPLOY_BLOCK: bigint | undefined = (() => {
  const raw = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK;
  if (!raw) return undefined;
  try {
    const n = BigInt(raw);
    return n > 0n ? n : undefined;
  } catch {
    return undefined;
  }
})();

/** Strike price display decimals (purely UI formatting; defaults to 18). */
export const STRIKE_DECIMALS: number = (() => {
  const raw = process.env.NEXT_PUBLIC_STRIKE_DECIMALS;
  const n = raw ? Number(raw) : 18;
  return Number.isFinite(n) && n >= 0 && n <= 36 ? n : 18;
})();

/** 1inch Limit Order Protocol v4 (Gnosis) — spender for maker ERC-20 approvals. */
export const LOP_V4_GNOSIS: Address =
  "0x111111125421ca6dc452d289314280a0f8842a65";

/** ERC-20 helper ABI (minimal). */
export const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/* =========================
 * Your OptionsVault ABI (matches the contract you posted)
 * ========================= */

/**
 * event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry);
 * defineSeries(address,uint8,uint256,uint64,uint256,address) returns (uint256)
 * deposit(uint256)
 * withdraw(uint256)
 * mintOptions(uint256 id, uint256 qty)
 * settleSeries(uint256 id)
 * exercise(uint256 id, uint256 qty)
 * reclaim(uint256 id)
 */
export const vaultAbi = [
  {
    type: "event",
    name: "SeriesDefined",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "underlying", type: "address", indexed: true },
      { name: "strike", type: "uint256", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "defineSeries",
    stateMutability: "nonpayable",
    inputs: [
      { name: "underlying", type: "address" },
      { name: "underlyingDecimals", type: "uint8" },
      { name: "strike", type: "uint256" },              // 1e18 WXDAI
      { name: "expiry", type: "uint64" },                // unix
      { name: "collateralPerOption", type: "uint256" },  // in underlying decimals
      { name: "oracle", type: "address" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "mintOptions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "qty", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleSeries",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "exercise",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "qty", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reclaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  // Optional handy view if you need it elsewhere:
  {
    type: "function",
    name: "freeCollateralOf",
    stateMutability: "view",
    inputs: [{ name: "maker", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/* =========================
 * Wrapper + CallToken (ERC-1155) exports
 * ========================= */

export const CALLTOKEN_ADDRESS: Address =
  (process.env.NEXT_PUBLIC_CALLTOKEN_ADDRESS as Address) ??
  "0x0000000000000000000000000000000000000000";

export const WRAPPER_ADDRESS: Address =
  (process.env.NEXT_PUBLIC_WRAPPER_ADDRESS as Address) ??
  "0x0000000000000000000000000000000000000000";

/** Minimal ERC-1155 ABI we use for approvals & balances. */
export const erc1155Abi = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" }
    ],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" }
    ],
    outputs: [{ type: "uint256" }]
  },
] as const;

/** Wrapper ABI (ensureSeriesERC20 / wrap / unwrap / erc20For). */
export const wrapperAbi = [
  {
    type: "function",
    name: "erc20For",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "ensureSeriesERC20",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "name_", type: "string" },
      { name: "symbol_", type: "string" },
    ],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "wrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "qty", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unwrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;