// lib/oneInch.ts
import { Address, encodeAbiParameters, keccak256, encodePacked } from "viem";
import { ERC1155_PROXY_ADDRESS, CALLTOKEN_ADDRESS } from "./contracts";

// 1inch Limit Order Protocol v4 address on Gnosis Chain
export const LOP_V4_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65" as const;

// CRITICAL: The exact EIP-712 domain for 1inch LOP v4 on Gnosis Chain
const DOMAIN = {
  name: "1inch Limit Order Protocol",
  version: "4",
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
const HAS_EXTENSION_FLAG = 255n; // Bit 255 for HAS_EXTENSION
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
 * Create proper 1inch extension for ERC-1155 orders that works with your proxy
 */
function create1inchExtension(maker1155: ERC1155AssetData): {
  extension: string;
  extensionHash: bigint;
} {
  // Your proxy expects: abi.encode(tokenAddress, tokenId, data)
  // This will be appended to the transferFrom call as suffix data
  const makerAssetSuffix = encodeAbiParameters(
    [
      { name: "token", type: "address" },    // The actual ERC1155 token
      { name: "tokenId", type: "uint256" },  // Token ID
      { name: "data", type: "bytes" },       // Transfer data
    ],
    [maker1155.token, maker1155.tokenId, maker1155.data as `0x${string}`]
  );

  console.log("🔍 MakerAssetSuffix for your proxy:", {
    token: maker1155.token,
    tokenId: maker1155.tokenId.toString(),
    data: maker1155.data,
    suffix: makerAssetSuffix,
    suffixLength: makerAssetSuffix.length,
  });

  // Create 1inch extension with proper offset structure
  // First 32 bytes = offset table, then the actual suffix data
  const makerAssetSuffixOffset = 32; // Start after the offset table
  
  // Create offset table (8 uint32 values = 32 bytes)
  const offsetTable = encodePacked(
    ["uint32", "uint32", "uint32", "uint32", "uint32", "uint32", "uint32", "uint32"],
    [
      makerAssetSuffixOffset, // MakerAssetSuffix at bytes [0..3]
      0, // TakerAssetSuffix at bytes [4..7] (not used)
      0, // bytes [8..11]
      0, // bytes [12..15]
      0, // bytes [16..19]
      0, // bytes [20..23]
      0, // bytes [24..27]
      0, // bytes [28..31]
    ]
  );

  // Combine: offset table + suffix data (remove 0x from suffix)
  const extensionData = offsetTable + makerAssetSuffix.slice(2);
  const extension = "0x" + extensionData;

  // Calculate extension hash for salt validation (lowest 160 bits)
  const extensionHash = BigInt(keccak256(extension as `0x${string}`)) & ((1n << 160n) - 1n);

  console.log("🔍 1inch Extension for your proxy:", {
    offsetTable,
    makerAssetSuffix,
    extension,
    extensionLength: extension.length,
    extensionHash: extensionHash.toString(),
  });

  return {
    extension,
    extensionHash,
  };
}

/**
 * Build a limit order for ERC-1155 tokens compatible with 1inch v4 and your proxy
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
    nonce,
  } = params;

  // Create proper 1inch extension that works with your proxy
  const { extension, extensionHash } = create1inchExtension(maker1155);

  // Generate salt with extension hash in lowest 160 bits
  const baseSalt = nonce || BigInt(Date.now() + Math.floor(Math.random() * 1000000));
  const salt = (baseSalt << 160n) | extensionHash;

  console.log("🔍 Salt with extension hash:", {
    baseSalt: baseSalt.toString(),
    extensionHash: extensionHash.toString(),
    finalSalt: salt.toString(),
    saltHex: "0x" + salt.toString(16),
  });

  // CRITICAL: Build makerTraits with HAS_EXTENSION flag FIRST
  let makerTraits = 0n;
  
  // MUST set HAS_EXTENSION flag (bit 255) - this is the critical fix
  makerTraits |= 1n << HAS_EXTENSION_FLAG;
  
  console.log("🔍 Setting HAS_EXTENSION flag:", {
    flagBit: HAS_EXTENSION_FLAG.toString(),
    flagValue: (1n << HAS_EXTENSION_FLAG).toString(),
    makerTraitsAfterFlag: makerTraits.toString(),
    makerTraitsHex: "0x" + makerTraits.toString(16),
    hasExtensionCheck: (makerTraits & (1n << HAS_EXTENSION_FLAG)) !== 0n,
  });
  
  // Set allow partial fill flag if requested
  if (allowPartialFill) {
    makerTraits |= 1n << ALLOW_MULTIPLE_FILLS_FLAG;
    console.log("🔍 Added partial fill flag:", {
      makerTraits: makerTraits.toString(),
      hasPartialFill: (makerTraits & (1n << ALLOW_MULTIPLE_FILLS_FLAG)) !== 0n,
    });
  }

  // Set expiration (40 bits at position 210)
  if (expirationSec > 0) {
    const expiration = BigInt(Math.floor(Date.now() / 1000) + expirationSec);
    makerTraits |= (expiration & EXPIRATION_MASK) << EXPIRATION_OFFSET;
    console.log("🔍 Added expiration:", {
      expiration: expiration.toString(),
      makerTraits: makerTraits.toString(),
    });
  }

  console.log("🔍 Final MakerTraits validation:", {
    makerTraits: makerTraits.toString(),
    makerTraitsHex: "0x" + makerTraits.toString(16),
    hasExtension: (makerTraits & (1n << HAS_EXTENSION_FLAG)) !== 0n,
    allowsPartialFill: (makerTraits & (1n << ALLOW_MULTIPLE_FILLS_FLAG)) !== 0n,
    bit255Set: (makerTraits & (1n << 255n)) !== 0n, // Double check bit 255
  });

  // Create order with YOUR proxy as makerAsset
  const order: LimitOrder = {
    salt,
    maker: makerAddress,
    receiver: makerAddress,
    makerAsset: ERC1155_PROXY_ADDRESS, // Your deployed proxy
    takerAsset: takerAsset,
    makingAmount: maker1155.amount,
    takingAmount: takerAmount,
    makerTraits,
  };

  // Calculate order hash
  const orderHash = getOrderHash(order);

  // Build typed data for EIP-712 signing
  const typedData = {
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order" as const,
    message: order,
  };

  console.log("🔍 Final order compatible with your proxy:", {
    order: {
      salt: order.salt.toString(),
      maker: order.maker,
      receiver: order.receiver,
      makerAsset: order.makerAsset, // Your proxy address
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      makerTraits: order.makerTraits.toString(),
    },
    extension,
    extensionLength: extension.length,
    orderHash,
    hasExtensionFlag: hasExtension(order.makerTraits),
    proxyWillReceive: "abi.encode(address token, uint256 tokenId, bytes data)",
  });

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
 * Calculate the hash of an order
 */
export function getOrderHash(order: LimitOrder): string {
  try {
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
 * Check if order has extension
 */
export function hasExtension(makerTraits: bigint): boolean {
  return (makerTraits & (1n << HAS_EXTENSION_FLAG)) !== 0n;
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
  
  // cancelOrder
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