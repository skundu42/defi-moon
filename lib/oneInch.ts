// lib/oneInch.ts
import { Address, encodeAbiParameters, keccak256 } from "viem";

// 1inch Limit Order Protocol v4 address on Gnosis Chain
export const LOP_V4_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65" as const;

// TypedData domain for 1inch LOP v4
const DOMAIN = {
  name: "1inch Limit Order Protocol",
  version: "4",
  chainId: 100, // Gnosis Chain
  verifyingContract: LOP_V4_ADDRESS as Address,
} as const;

// Order struct types for EIP-712
const ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "receiver", type: "address" },
    { name: "makerAsset", type: "address" },
    { name: "takerAsset", type: "address" },
    { name: "makingAmount", type: "uint256" },
    { name: "takingAmount", type: "uint256" },
    { name: "makerTraits", type: "uint256" },
  ],
} as const;

// Maker traits bit layout:
// [0..7]   - flags
// [8..247] - nonceOrEpoch, expiration, series, allowPartialFill, etc.
// [248..255] - reserved

// Bit positions in makerTraits
const ALLOW_MULTIPLE_FILLS_FLAG = 0n;
const EXPIRATION_OFFSET = 210n;
const EXPIRATION_MASK = (1n << 40n) - 1n;

export interface LimitOrder {
  salt: bigint;
  maker: Address;
  receiver: Address;
  makerAsset: Address;
  takerAsset: Address;
  makingAmount: bigint;
  takingAmount: bigint;
  makerTraits: bigint;
}

export interface ERC1155AssetData {
  token: Address;
  tokenId: bigint;
  amount: bigint;
  data: string;
}

/**
 * Build a limit order for ERC-1155 tokens
 * This creates an order that uses the ERC1155 proxy to handle the token transfer
 */
export function buildLimitOrder1155(params: {
  makerAddress: Address;
  maker1155: ERC1155AssetData;
  takerAsset: Address;
  takerAmount: bigint;
  expirationSec?: number;
  allowPartialFill?: boolean;
  nonce?: bigint;
}): {
  order: LimitOrder;
  typedData: {
    domain: typeof DOMAIN;
    types: typeof ORDER_TYPES;
    primaryType: "Order";
    message: LimitOrder;
  };
  orderHash: string;
} {
  const {
    makerAddress,
    maker1155,
    takerAsset,
    takerAmount,
    expirationSec = 0,
    allowPartialFill = false,
    nonce = BigInt(Date.now()),
  } = params;

  // Build makerTraits
  let makerTraits = 0n;
  
  // Set allow partial fill flag
  if (allowPartialFill) {
    makerTraits |= 1n << ALLOW_MULTIPLE_FILLS_FLAG;
  }

  // Set expiration (40 bits at position 210)
  if (expirationSec > 0) {
    const expiration = BigInt(Math.floor(Date.now() / 1000) + expirationSec);
    makerTraits |= (expiration & EXPIRATION_MASK) << EXPIRATION_OFFSET;
  }

  // For ERC-1155, we use the proxy address as makerAsset
  // The actual token address, tokenId, and amount are encoded in the extension
  const order: LimitOrder = {
    salt: nonce,
    maker: makerAddress,
    receiver: makerAddress, // receiver is typically same as maker
    makerAsset: "0x03F916C97e7DF446aB916776313299C13b533f91" as Address, // ERC1155_PROXY_ADDRESS
    takerAsset: takerAsset,
    makingAmount: maker1155.amount,
    takingAmount: takerAmount,
    makerTraits,
  };

  // Build extension data for ERC-1155
  // Extension format: tokenId (32 bytes) + token address (20 bytes) + data
  const extension = encodeAbiParameters(
    [
      { name: "tokenId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "data", type: "bytes" },
    ],
    [maker1155.tokenId, maker1155.token, maker1155.data as `0x${string}`]
  );

  // Calculate order hash
  const orderHash = getOrderHash(order);

  // Build typed data for signing
  const typedData = {
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order" as const,
    message: order,
  };

  return {
    order: {
      ...order,
      extension, // Add extension to order object
    } as any,
    typedData,
    orderHash,
  };
}

/**
 * Calculate the hash of an order
 */
export function getOrderHash(order: LimitOrder): string {
  const encoded = encodeAbiParameters(
    [
      { name: "salt", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "receiver", type: "address" },
      { name: "makerAsset", type: "address" },
      { name: "takerAsset", type: "address" },
      { name: "makingAmount", type: "uint256" },
      { name: "takingAmount", type: "uint256" },
      { name: "makerTraits", type: "uint256" },
    ],
    [
      order.salt,
      order.maker,
      order.receiver,
      order.makerAsset,
      order.takerAsset,
      order.makingAmount,
      order.takingAmount,
      order.makerTraits,
    ]
  );

  return keccak256(encoded);
}

/**
 * Extract expiration timestamp from makerTraits
 */
export function getExpiration(makerTraits: bigint): bigint {
  return (makerTraits >> EXPIRATION_OFFSET) & EXPIRATION_MASK;
}

/**
 * Check if order allows partial fills
 */
export function allowsPartialFill(makerTraits: bigint): boolean {
  return (makerTraits & (1n << ALLOW_MULTIPLE_FILLS_FLAG)) !== 0n;
}

/**
 * Check if order is currently active (not expired)
 */
export function isOrderActive(makerTraits: bigint): boolean {
  const expiration = getExpiration(makerTraits);
  if (expiration === 0n) return true; // No expiration
  
  const now = BigInt(Math.floor(Date.now() / 1000));
  return expiration > now;
}

// 1inch Limit Order Protocol v4 ABI (subset)
export const lopV4Abi = [
  // fillOrder - used to fill limit orders
  {
    type: "function",
    name: "fillOrder",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "salt", type: "uint256" },
          { name: "maker", type: "address" },
          { name: "receiver", type: "address" },
          { name: "makerAsset", type: "address" },
          { name: "takerAsset", type: "address" },
          { name: "makingAmount", type: "uint256" },
          { name: "takingAmount", type: "uint256" },
          { name: "makerTraits", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "makingAmount", type: "uint256" },
      { name: "takingAmount", type: "uint256" },
      { name: "extension", type: "bytes" },
    ],
    outputs: [
      { name: "actualMakingAmount", type: "uint256" },
      { name: "actualTakingAmount", type: "uint256" },
    ],
    stateMutability: "nonpayable",
  },
  
  // cancelOrder - cancel an order by its makerTraits and orderHash
  {
    type: "function",
    name: "cancelOrder",
    inputs: [
      { name: "makerTraits", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  
  // remainingWithOrder - check remaining fillable amount
  {
    type: "function",
    name: "remainingWithOrder",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "salt", type: "uint256" },
          { name: "maker", type: "address" },
          { name: "receiver", type: "address" },
          { name: "makerAsset", type: "address" },
          { name: "takerAsset", type: "address" },
          { name: "makingAmount", type: "uint256" },
          { name: "takingAmount", type: "uint256" },
          { name: "makerTraits", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "extension", type: "bytes" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
    stateMutability: "view",
  },
  
  // Events
  {
    type: "event",
    name: "OrderFilled",
    inputs: [
      { indexed: true, name: "orderHash", type: "bytes32" },
      { indexed: false, name: "makingAmount", type: "uint256" },
      { indexed: false, name: "takingAmount", type: "uint256" },
    ],
    anonymous: false,
  },
  
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { indexed: true, name: "orderHash", type: "bytes32" },
    ],
    anonymous: false,
  },
] as const;