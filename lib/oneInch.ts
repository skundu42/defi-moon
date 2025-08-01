// lib/oneInch.ts
import { Address, encodeAbiParameters, keccak256 } from "viem";
import { ERC1155_PROXY_ADDRESS, CALLTOKEN_ADDRESS } from "./contracts";

// 1inch Limit Order Protocol v4 address on Gnosis Chain
export const LOP_V4_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65" as const;

// CRITICAL: The exact EIP-712 domain for 1inch LOP v4
// Based on 1inch v4 documentation and contract analysis
const DOMAIN = {
  name: "1inch Limit Order Protocol",
  version: "4", // v4 uses version "4"
  chainId: 100, // Gnosis Chain
  verifyingContract: LOP_V4_ADDRESS as Address,
} as const;

// Order struct types for EIP-712 - EXACT structure from 1inch v4
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

// Bit positions in makerTraits for 1inch v4
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
 * Build a limit order for ERC-1155 tokens compatible with 1inch v4
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
  order: LimitOrder & { extension?: string };
  typedData: {
    domain: typeof DOMAIN;
    types: typeof ORDER_TYPES;
    primaryType: "Order";
    message: LimitOrder;
  };
  orderHash: string;
  extension: string;
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

  // Build extension data for ERC-1155
  const extension = encodeAbiParameters(
    [
      { name: "token", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    [maker1155.token, maker1155.tokenId, maker1155.data as `0x${string}`]
  );

  // For 1inch v4, the salt should be the nonce without modification for basic orders
  // Extension validation is handled separately by the protocol
  let salt = nonce;

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

  // Create order with ERC1155 proxy as makerAsset
  const order: LimitOrder = {
    salt,
    maker: makerAddress,
    receiver: makerAddress, // Usually same as maker
    makerAsset: ERC1155_PROXY_ADDRESS, // Use the proxy for ERC-1155
    takerAsset: takerAsset,
    makingAmount: maker1155.amount,
    takingAmount: takerAmount,
    makerTraits,
  };

  // Calculate order hash using the same method as 1inch
  const orderHash = getOrderHash(order);

  // Build typed data for EIP-712 signing
  const typedData = {
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order" as const,
    message: order,
  };

  return {
    order: {
      ...order,
      extension,
    },
    typedData,
    orderHash,
    extension,
  };
}

/**
 * Calculate the hash of an order using the exact same method as the API
 * This must match the calculateOrderHash function in app/api/orders/route.ts
 */
export function getOrderHash(order: LimitOrder): string {
  try {
    // Convert all values to the exact same format as the API expects
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
        BigInt(order.salt.toString()),
        order.maker as `0x${string}`,
        order.receiver as `0x${string}`,
        order.makerAsset as `0x${string}`,
        order.takerAsset as `0x${string}`,
        BigInt(order.makingAmount.toString()),
        BigInt(order.takingAmount.toString()),
        BigInt(order.makerTraits.toString()),
      ]
    );

    return keccak256(encoded);
  } catch (error) {
    console.error("Error calculating order hash:", error);
    throw error;
  }
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
  // fillOrder - used to fill limit orders without extensions
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
  
  // fillOrderArgs - used to fill limit orders with parsed extension arguments
  {
    type: "function",
    name: "fillOrderArgs",
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
      { name: "args", type: "bytes" },
    ],
    outputs: [
      { name: "actualMakingAmount", type: "uint256" },
      { name: "actualTakingAmount", type: "uint256" },
    ],
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