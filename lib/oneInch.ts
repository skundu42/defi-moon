// lib/oneInch.ts
import {
  Address as ViemAddress,
  encodeAbiParameters,
  keccak256,
  encodePacked,
  Hex,
} from "viem";

/* ----------------------------- Constants ----------------------------- */

export const NETWORK_ID = 100; // Gnosis Chain
export const CHAIN_ID = 100n;

// 1inch Limit Order Protocol v4 on Gnosis
export const LOP_V4_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65" as const;

// ERC1155 Proxy Address
export const ERC1155_PROXY_ADDRESS = "0x03F916C97e7DF446aB916776313299C13b533f91" as const;

// Bitwise flags for MakerTraits
const MAKER_AMOUNT_FLAG = 1n << 255n;
const USE_PERMIT2_FLAG = 1n << 254n;
const UNWRAP_WETH_FLAG = 1n << 253n;
const SKIP_ORDER_PERMIT_FLAG = 1n << 252n;
const USE_PERMIT_FLAG = 1n << 251n;
const NO_PARTIAL_FILLS_FLAG = 1n << 250n;

// Expiration time mask (40 bits starting at position 210)
const EXPIRATION_MASK = ((1n << 40n) - 1n) << 210n;

/* -------------------------------- Types -------------------------------- */

export interface Order {
  salt: bigint;
  maker: ViemAddress;
  receiver: ViemAddress;
  makerAsset: ViemAddress;
  takerAsset: ViemAddress;
  makingAmount: bigint;
  takingAmount: bigint;
  makerTraits: bigint;
}

export interface OrderWithExtension extends Order {
  extension: Hex;
}

export type BuildOrderArgs1155 = {
  makerAddress: ViemAddress;
  maker1155: {
    token: ViemAddress;
    tokenId: bigint;
    amount: bigint;
    data?: Hex;
  };
  takerAsset: ViemAddress;
  takerAmount: bigint;
  expirationSec?: number;
  receiver?: ViemAddress;
  allowPartialFill?: boolean;
};

/* ----------------------------- Order Builder ----------------------------- */

/**
 * Builds maker traits with expiration and other flags
 */
function buildMakerTraits(
  expirationSec: number,
  allowPartialFill: boolean = true
): bigint {
  const now = Math.floor(Date.now() / 1000);
  const expiration = BigInt(now + expirationSec);
  
  let traits = 0n;
  
  // Set expiration (40 bits at position 210)
  traits |= (expiration & ((1n << 40n) - 1n)) << 210n;
  
  // Set flags
  if (!allowPartialFill) {
    traits |= NO_PARTIAL_FILLS_FLAG;
  }
  
  return traits;
}

/**
 * Builds an ERC-1155 limit order for direct contract interaction
 */
export function buildLimitOrder1155({
  makerAddress,
  maker1155: { token, tokenId, amount, data },
  takerAsset,
  takerAmount,
  expirationSec = 2 * 60 * 60,
  receiver,
  allowPartialFill = true,
}: BuildOrderArgs1155): {
  order: OrderWithExtension;
  typedData: any;
  orderHash: Hex;
} {
  // Generate salt
  const salt = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  
  // Build maker traits
  const makerTraits = buildMakerTraits(expirationSec, allowPartialFill);
  
  // Build extension data for ERC1155
  const extension = encodeAbiParameters(
    [
      { name: "id", type: "uint256" },
      { name: "token", type: "address" },
      { name: "data", type: "bytes" },
    ],
    [tokenId, token, (data ?? "0x") as Hex]
  );
  
  // Create order struct
  const order: OrderWithExtension = {
    salt,
    maker: makerAddress,
    receiver: receiver || "0x0000000000000000000000000000000000000000",
    makerAsset: ERC1155_PROXY_ADDRESS,
    takerAsset,
    makingAmount: amount,
    takingAmount: takerAmount,
    makerTraits,
    extension,
  };
  
  // Create EIP-712 typed data
  const typedData = {
    domain: {
      name: "1inch Limit Order Protocol",
      version: "4",
      chainId: CHAIN_ID,
      verifyingContract: LOP_V4_ADDRESS as ViemAddress,
    },
    types: {
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
    },
    primaryType: "Order" as const,
    message: {
      salt: order.salt.toString(),
      maker: order.maker,
      receiver: order.receiver,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      makerTraits: order.makerTraits.toString(),
    },
  };
  
  // Calculate order hash
  const orderHash = getOrderHash(order);
  
  return { order, typedData, orderHash };
}

/**
 * Calculates the order hash according to 1inch protocol
 */
export function getOrderHash(order: Order): Hex {
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

/* ----------------------------- Contract ABIs ----------------------------- */

export const lopV4Abi = [
  // Standard fill order
  {
    type: "function",
    name: "fillOrder",
    stateMutability: "payable",
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
      { name: "orderHash", type: "bytes32" },
    ],
  },
  // Fill order with extension (alternative)
  {
    type: "function",
    name: "fillOrderExt",
    stateMutability: "payable",
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
      { name: "makingAmount", type: "uint256" },
      { name: "takingAmount", type: "uint256" },
      { name: "skipPermitAndThreshold", type: "uint256" },
    ],
    outputs: [
      { name: "actualMakingAmount", type: "uint256" },
      { name: "actualTakingAmount", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
  },
  // Cancel order
  {
    type: "function",
    name: "cancelOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "makerTraits", type: "uint256" },
      { name: "orderHash", type: "bytes32" },
    ],
    outputs: [],
  },
  // Batch cancel
  {
    type: "function",
    name: "batchCancelOrders",
    stateMutability: "nonpayable",
    inputs: [
      { name: "makerTraits", type: "uint256[]" },
      { name: "orderHashes", type: "bytes32[]" },
    ],
    outputs: [],
  },
  // Check if order is valid
  {
    type: "function",
    name: "checkPredicate",
    stateMutability: "view",
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
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  // Get remaining amount
  {
    type: "function",
    name: "remaining",
    stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Get remaining amount with order
  {
    type: "function",
    name: "remainingWithOrder",
    stateMutability: "view",
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
    outputs: [{ name: "", type: "uint256" }],
  },
  // Events
  {
    type: "event",
    name: "OrderFilled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderHash", type: "bytes32" },
      { indexed: false, name: "makingAmount", type: "uint256" },
      { indexed: false, name: "takingAmount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "OrderCancelled",
    anonymous: false,
    inputs: [
      { indexed: true, name: "orderHash", type: "bytes32" },
    ],
  },
] as const;

/* ------------------------- Helper Functions -------------------------- */

/**
 * Encodes the order for contract interaction
 */
export function encodeOrder(order: Order): Hex {
  return encodeAbiParameters(
    [
      {
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
    ],
    [order]
  );
}

/**
 * Validates if an order is still active (not expired)
 */
export function isOrderActive(makerTraits: bigint): boolean {
  const expiration = (makerTraits & EXPIRATION_MASK) >> 210n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return expiration === 0n || expiration > now;
}

/**
 * Extracts expiration timestamp from maker traits
 */
export function getExpiration(makerTraits: bigint): bigint {
  return (makerTraits & EXPIRATION_MASK) >> 210n;
}

/**
 * Checks if order allows partial fills
 */
export function allowsPartialFill(makerTraits: bigint): boolean {
  return (makerTraits & NO_PARTIAL_FILLS_FLAG) === 0n;
}