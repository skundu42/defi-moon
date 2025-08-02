import { Address, encodeAbiParameters, keccak256, encodePacked, getAddress } from "viem";
import { ERC1155_PROXY_ADDRESS, CALLTOKEN_ADDRESS } from "./contracts";

export const LOP_V4_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65" as const;

const DOMAIN = {
  name: "1inch Limit Order Protocol",
  version: "4",
  chainId: 100, // Gnosis Chain
  verifyingContract: LOP_V4_ADDRESS as Address,
} as const;

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

function create1inchExtension(maker1155: ERC1155AssetData): {
  extension: string;
  extensionHash: bigint;
} {
  // Validate inputs
  if (!maker1155.token || !getAddress(maker1155.token)) {
    throw new Error("Invalid ERC1155 token address");
  }
  
  if (maker1155.tokenId < 0n) {
    throw new Error("Invalid token ID");
  }
  
  if (maker1155.amount <= 0n) {
    throw new Error("Amount must be greater than 0");
  }

  // Your proxy expects: abi.encode(IERC1155 token, uint256 tokenId, bytes data)
  // This will be appended to the transferFrom call as suffix data
  const makerAssetSuffix = encodeAbiParameters(
    [
      { name: "token", type: "address" },    // The actual ERC1155 token (CallToken)
      { name: "tokenId", type: "uint256" },  // Option series ID
      { name: "data", type: "bytes" },       // Transfer data (usually empty for options)
    ],
    [
      getAddress(maker1155.token), 
      maker1155.tokenId, 
      (maker1155.data || "0x") as `0x${string}`
    ]
  );

  console.log("🔍 MakerAssetSuffix for ERC1155Proxy:", {
    token: maker1155.token,
    tokenId: maker1155.tokenId.toString(),
    amount: maker1155.amount.toString(),
    data: maker1155.data || "0x",
    suffix: makerAssetSuffix,
    suffixLength: (makerAssetSuffix.length - 2) / 2, // bytes length
  });

  // Create 1inch extension with proper offset structure
  // First 32 bytes = offset table (8 uint32 values), then the actual suffix data
  const makerAssetSuffixOffset = 32; // Start after the offset table
  
  // Create offset table (8 uint32 values = 32 bytes total)
  // FIXED: Use encodeAbiParameters instead of encodePacked for proper formatting
  const offsetTable = encodeAbiParameters(
    [
      { name: "makerAssetSuffixOffset", type: "uint32" },
      { name: "takerAssetSuffixOffset", type: "uint32" },
      { name: "reserved1", type: "uint32" },
      { name: "reserved2", type: "uint32" },
      { name: "reserved3", type: "uint32" },
      { name: "reserved4", type: "uint32" },
      { name: "reserved5", type: "uint32" },
      { name: "reserved6", type: "uint32" },
    ],
    [
      makerAssetSuffixOffset, // MakerAssetSuffix at bytes [0..3]
      0, // TakerAssetSuffix at bytes [4..7] (not used for options)
      0, // bytes [8..11] (reserved)
      0, // bytes [12..15] (reserved)  
      0, // bytes [16..19] (reserved)
      0, // bytes [20..23] (reserved)
      0, // bytes [24..27] (reserved)
      0, // bytes [28..31] (reserved)
    ]
  );

  // FIXED: Properly combine hex strings - both should not have 0x prefix when concatenating
  const offsetTableHex = offsetTable.slice(2); // Remove 0x
  const suffixHex = makerAssetSuffix.slice(2); // Remove 0x
  const extension = "0x" + offsetTableHex + suffixHex;

  // Validate the result is proper hex
  if (!/^0x[0-9a-fA-F]+$/.test(extension)) {
    console.error("❌ Generated invalid extension hex:", {
      extension,
      offsetTable,
      makerAssetSuffix,
      offsetTableHex,
      suffixHex,
    });
    throw new Error("Generated extension contains invalid hex characters");
  }

  // Calculate extension hash for salt validation (lowest 160 bits)
  const extensionHash = BigInt(keccak256(extension as `0x${string}`)) & ((1n << 160n) - 1n);

  console.log("🔍 1inch Extension created:", {
    offsetTableLength: offsetTable.length,
    makerAssetSuffixLength: makerAssetSuffix.length,
    extensionLength: extension.length,
    extensionSizeBytes: (extension.length - 2) / 2,
    extensionHash: "0x" + extensionHash.toString(16),
    extension: extension.slice(0, 66) + "...", // First 32 bytes for debugging
    isValidHex: /^0x[0-9a-fA-F]+$/.test(extension),
  });

  return {
    extension,
    extensionHash,
  };
}

/**
 * Build a limit order for ERC-1155 CallToken options compatible with 1inch v4
 * 
 * @param params - Order parameters
 * @returns Complete order data ready for signing and submission
 */
export function buildLimitOrder1155(params: {
  makerAddress: Address;
  maker1155: ERC1155AssetData;
  takerAsset: Address; // Usually USDC, WXDAI, etc.
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
    allowPartialFill = true, // Default true for options (spreads, partial fills)
    nonce,
  } = params;

  // Validate inputs
  if (!getAddress(makerAddress)) {
    throw new Error("Invalid maker address");
  }
  
  if (!getAddress(takerAsset)) {
    throw new Error("Invalid taker asset address");
  }
  
  if (takerAmount <= 0n) {
    throw new Error("Taker amount must be greater than 0");
  }

  // Ensure the ERC1155 token is your CallToken
  if (getAddress(maker1155.token) !== getAddress(CALLTOKEN_ADDRESS)) {
    console.warn("⚠️ Warning: ERC1155 token is not the expected CallToken address");
  }

  // Create proper 1inch extension that works with your ERC1155Proxy
  const { extension, extensionHash } = create1inchExtension(maker1155);

  // Generate salt with extension hash in lowest 160 bits
  const baseSalt = nonce || BigInt(Date.now() + Math.floor(Math.random() * 1000000));
  const salt = (baseSalt << 160n) | extensionHash;

  console.log("🔍 Salt generation:", {
    baseSalt: "0x" + baseSalt.toString(16),
    extensionHash: "0x" + extensionHash.toString(16),
    finalSalt: "0x" + salt.toString(16),
    saltDecimal: salt.toString(),
  });

  // Build makerTraits with proper flags
  let makerTraits = 0n;
  
  // CRITICAL: MUST set HAS_EXTENSION flag (bit 255) first
  makerTraits |= 1n << HAS_EXTENSION_FLAG;
  
  console.log("🔍 Setting HAS_EXTENSION flag:", {
    flagBit: HAS_EXTENSION_FLAG.toString(),
    flagMask: "0x" + (1n << HAS_EXTENSION_FLAG).toString(16),
    makerTraitsHex: "0x" + makerTraits.toString(16),
    hasExtensionSet: (makerTraits & (1n << HAS_EXTENSION_FLAG)) !== 0n,
  });
  
  // Set allow partial fill flag (recommended for options trading)
  if (allowPartialFill) {
    makerTraits |= 1n << ALLOW_MULTIPLE_FILLS_FLAG;
    console.log("🔍 Added partial fill capability");
  }

  // Set expiration if specified
  if (expirationSec > 0) {
    const currentTime = Math.floor(Date.now() / 1000);
    const expiration = BigInt(currentTime + expirationSec);
    
    // Ensure expiration fits in 40 bits
    if (expiration > EXPIRATION_MASK) {
      throw new Error("Expiration timestamp too large (max 40 bits)");
    }
    
    makerTraits |= (expiration & EXPIRATION_MASK) << EXPIRATION_OFFSET;
    console.log("🔍 Added expiration:", {
      currentTime,
      expirationSec,
      expiration: expiration.toString(),
      expirationDate: new Date(Number(expiration) * 1000).toISOString(),
    });
  }

  // Final validation of makerTraits
  const hasExtensionFlag = (makerTraits & (1n << HAS_EXTENSION_FLAG)) !== 0n;
  const hasPartialFillFlag = (makerTraits & (1n << ALLOW_MULTIPLE_FILLS_FLAG)) !== 0n;
  
  console.log("🔍 Final MakerTraits:", {
    value: "0x" + makerTraits.toString(16),
    decimal: makerTraits.toString(),
    hasExtension: hasExtensionFlag,
    allowsPartialFill: hasPartialFillFlag,
    expiration: getExpiration(makerTraits).toString(),
  });

  if (!hasExtensionFlag) {
    throw new Error("CRITICAL: HAS_EXTENSION flag not set properly");
  }

  // Create order with YOUR ERC1155Proxy as makerAsset
  const order: LimitOrder = {
    salt,
    maker: getAddress(makerAddress),
    receiver: getAddress(makerAddress), // Same as maker for simple orders
    makerAsset: getAddress(ERC1155_PROXY_ADDRESS), // Your deployed ERC1155Proxy
    takerAsset: getAddress(takerAsset),
    makingAmount: maker1155.amount, // Amount of options being sold
    takingAmount: takerAmount, // Amount of payment token expected
    makerTraits,
  };

  // Calculate order hash for verification
  const orderHash = getOrderHash(order);

  // Build typed data for EIP-712 signing
  const typedData = {
    domain: DOMAIN,
    types: ORDER_TYPES,
    primaryType: "Order" as const,
    message: order,
  };

  console.log("🔍 Order created for CallToken options:", {
    orderHash,
    maker: order.maker,
    makerAsset: order.makerAsset, // Your ERC1155Proxy
    takerAsset: order.takerAsset,
    optionTokenId: maker1155.tokenId.toString(),
    optionAmount: maker1155.amount.toString(),
    paymentAmount: takerAmount.toString(),
    extensionSize: (extension.length - 2) / 2,
    readyForSigning: true,
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
 * Calculate the keccak256 hash of an order for verification
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
    console.error("❌ Error calculating order hash:", error);
    throw new Error(`Failed to calculate order hash: ${error}`);
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
 * Check if order has extension data
 */
export function hasExtension(makerTraits: bigint): boolean {
  return (makerTraits & (1n << HAS_EXTENSION_FLAG)) !== 0n;
}

/**
 * Check if order is currently active (not expired)
 */
export function isOrderActive(makerTraits: bigint): boolean {
  const expiration = getExpiration(makerTraits);
  if (expiration === 0n) return true; // No expiration set
  
  const now = BigInt(Math.floor(Date.now() / 1000));
  return expiration > now;
}

/**
 * Validate that an order is properly configured for ERC1155 options trading
 */
export function validateERC1155Order(order: LimitOrder, extension: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!hasExtension(order.makerTraits)) {
    errors.push("HAS_EXTENSION flag must be set for ERC1155 orders");
  }

  if (getAddress(order.makerAsset) !== getAddress(ERC1155_PROXY_ADDRESS)) {
    errors.push("makerAsset must be the ERC1155Proxy address");
  }

  if (order.makingAmount <= 0n) {
    errors.push("makingAmount must be greater than 0");
  }

  if (order.takingAmount <= 0n) {
    errors.push("takingAmount must be greater than 0");
  }

  if (!extension || extension === "0x") {
    errors.push("Extension data is required for ERC1155 orders");
  }

  // Check warnings
  if (!allowsPartialFill(order.makerTraits)) {
    warnings.push("Consider allowing partial fills for better options liquidity");
  }

  const expiration = getExpiration(order.makerTraits);
  if (expiration === 0n) {
    warnings.push("No expiration set - order will be valid indefinitely");
  } else if (!isOrderActive(order.makerTraits)) {
    warnings.push("Order is already expired");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Export for easy usage in frontend
export { DOMAIN, ORDER_TYPES };