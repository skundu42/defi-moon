// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { keccak256, encodeAbiParameters } from "viem";

// Shared in-memory storage (in production, use a proper database)
declare global {
  var ordersStorage: Map<string, any> | undefined;
}

// Initialize storage
if (!global.ordersStorage) {
  global.ordersStorage = new Map<string, any>();
}

// Helper function to calculate order hash - MUST match the client-side calculation
function calculateOrderHash(order: any): string {
  try {
    // Ensure all values are exactly the same type as client calculation
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
        BigInt(order.salt),
        order.maker as `0x${string}`,
        order.receiver as `0x${string}`,
        order.makerAsset as `0x${string}`,
        order.takerAsset as `0x${string}`,
        BigInt(order.makingAmount),
        BigInt(order.takingAmount),
        BigInt(order.makerTraits),
      ]
    );

    const hash = keccak256(encoded);
    
    console.log("API: Order hash calculation:", {
      order: {
        salt: order.salt.toString(),
        maker: order.maker,
        receiver: order.receiver,
        makerAsset: order.makerAsset,
        takerAsset: order.takerAsset,
        makingAmount: order.makingAmount.toString(),
        takingAmount: order.takingAmount.toString(),
        makerTraits: order.makerTraits.toString(),
      },
      encoded,
      hash,
    });
    
    return hash;
  } catch (error) {
    console.error("API: Error calculating order hash:", error);
    throw error;
  }
}

// Validate order structure
function validateOrder(order: any): { isValid: boolean; error?: string } {
  try {
    // Check required fields
    const requiredFields = ['salt', 'maker', 'receiver', 'makerAsset', 'takerAsset', 'makingAmount', 'takingAmount', 'makerTraits'];
    for (const field of requiredFields) {
      if (!order[field]) {
        return { isValid: false, error: `Missing required field: ${field}` };
      }
    }

    // Validate addresses (should be 42 characters starting with 0x)
    const addressFields = ['maker', 'receiver', 'makerAsset', 'takerAsset'];
    for (const field of addressFields) {
      const addr = order[field];
      if (typeof addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return { isValid: false, error: `Invalid address format for ${field}: ${addr}` };
      }
    }

    // Validate numeric fields can be converted to BigInt
    const numericFields = ['salt', 'makingAmount', 'takingAmount', 'makerTraits'];
    for (const field of numericFields) {
      try {
        BigInt(order[field]);
      } catch {
        return { isValid: false, error: `Invalid numeric format for ${field}: ${order[field]}` };
      }
    }

    // Validate amounts are positive
    if (BigInt(order.makingAmount) <= 0n) {
      return { isValid: false, error: 'makingAmount must be positive' };
    }
    if (BigInt(order.takingAmount) <= 0n) {
      return { isValid: false, error: 'takingAmount must be positive' };
    }

    return { isValid: true };
  } catch (error: any) {
    return { isValid: false, error: `Validation error: ${error.message}` };
  }
}

// Validate signature format
function validateSignature(signature: string): { isValid: boolean; error?: string } {
  if (!signature) {
    return { isValid: false, error: 'Signature is required' };
  }
  if (typeof signature !== 'string') {
    return { isValid: false, error: 'Signature must be a string' };
  }
  if (!signature.startsWith('0x')) {
    return { isValid: false, error: 'Signature must start with 0x' };
  }
  if (signature.length !== 132) { // 0x + 130 hex chars = 132
    return { isValid: false, error: `Invalid signature length: ${signature.length}, expected 132` };
  }
  return { isValid: true };
}

// Validate extension format for ERC-1155
function validateExtension(extension: string): { isValid: boolean; error?: string } {
  if (!extension) {
    return { isValid: false, error: 'Extension is required for ERC-1155 orders' };
  }
  if (extension === "0x") {
    return { isValid: false, error: 'Extension cannot be empty for ERC-1155 orders' };
  }
  if (extension.length < 130) { // Minimum length for encoded ERC-1155 data
    return { isValid: false, error: `Extension too short: ${extension.length}, expected at least 130` };
  }
  return { isValid: true };
}

// GET /api/orders - Fetch orders with filters
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const maker = searchParams.get("maker");
  const takerAsset = searchParams.get("takerAsset");
  const makerAsset = searchParams.get("makerAsset");
  const active = searchParams.get("active") === "true";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const orders = global.ordersStorage!;
    let filteredOrders = Array.from(orders.values());

    console.log(`API: GET request - total stored orders: ${orders.size}`);

    // Apply filters
    if (maker) {
      filteredOrders = filteredOrders.filter(
        (o) => o.order?.maker?.toLowerCase() === maker.toLowerCase()
      );
    }

    if (takerAsset) {
      filteredOrders = filteredOrders.filter(
        (o) => o.order?.takerAsset?.toLowerCase() === takerAsset.toLowerCase()
      );
    }

    if (makerAsset) {
      filteredOrders = filteredOrders.filter(
        (o) => o.order?.makerAsset?.toLowerCase() === makerAsset.toLowerCase()
      );
    }

    if (active) {
      const now = Math.floor(Date.now() / 1000);
      filteredOrders = filteredOrders.filter((o) => {
        if (o.cancelled || o.filled) return false;
        try {
          const expiration = Number((BigInt(o.order.makerTraits) >> 210n) & ((1n << 40n) - 1n));
          return expiration === 0 || expiration > now;
        } catch {
          return false; // Skip invalid orders
        }
      });
    }

    // Sort by timestamp (newest first)
    filteredOrders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Apply pagination
    const paginatedOrders = filteredOrders.slice(offset, offset + limit);

    // Log extension data for debugging
    paginatedOrders.forEach(order => {
      console.log(`API: Order ${order.orderHash?.slice(0, 8)}: extension length = ${order.extension?.length || 0}`);
    });

    console.log(`API: Found ${filteredOrders.length} orders, returning ${paginatedOrders.length}`);

    return NextResponse.json({
      orders: paginatedOrders,
      total: filteredOrders.length,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("GET /api/orders error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

// POST /api/orders - Submit a new order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order, signature, extension, orderHash } = body;

    console.log("API: Received order submission:", { 
      orderHash, 
      maker: order?.maker,
      hasExtension: !!extension,
      extensionLength: extension?.length || 0,
      signatureLength: signature?.length || 0,
    });

    // Validate required fields
    if (!order || !signature || !orderHash) {
      return NextResponse.json(
        { error: "Missing required fields: order, signature, orderHash" },
        { status: 400 }
      );
    }

    // Validate order structure
    const orderValidation = validateOrder(order);
    if (!orderValidation.isValid) {
      console.error("API: Order validation failed:", orderValidation.error);
      return NextResponse.json(
        { error: `Order validation failed: ${orderValidation.error}` },
        { status: 400 }
      );
    }

    // Validate signature
    const signatureValidation = validateSignature(signature);
    if (!signatureValidation.isValid) {
      console.error("API: Signature validation failed:", signatureValidation.error);
      return NextResponse.json(
        { error: `Signature validation failed: ${signatureValidation.error}` },
        { status: 400 }
      );
    }

    // Validate extension for ERC-1155 orders
    const extensionValidation = validateExtension(extension);
    if (!extensionValidation.isValid) {
      console.error("API: Extension validation failed:", extensionValidation.error);
      return NextResponse.json(
        { error: `Extension validation failed: ${extensionValidation.error}` },
        { status: 400 }
      );
    }

    // Verify order hash matches
    const calculatedHash = calculateOrderHash(order);
    if (calculatedHash !== orderHash) {
      console.error("API: Order hash mismatch:", { 
        calculated: calculatedHash, 
        provided: orderHash,
        order: {
          salt: order.salt.toString(),
          maker: order.maker,
          receiver: order.receiver,
          makerAsset: order.makerAsset,
          takerAsset: order.takerAsset,
          makingAmount: order.makingAmount.toString(),
          takingAmount: order.takingAmount.toString(),
          makerTraits: order.makerTraits.toString(),
        },
      });
      return NextResponse.json(
        { error: "Order hash mismatch - order may be corrupted" },
        { status: 400 }
      );
    }

    const orders = global.ordersStorage!;

    // Check if order already exists
    if (orders.has(orderHash)) {
      return NextResponse.json(
        { error: "Order already exists" },
        { status: 409 }
      );
    }

    // Store order with the exact structure expected by the API
    const orderData = {
      orderHash,
      order: {
        salt: order.salt,
        maker: order.maker,
        receiver: order.receiver,
        makerAsset: order.makerAsset,
        takerAsset: order.takerAsset,
        makingAmount: order.makingAmount,
        takingAmount: order.takingAmount,
        makerTraits: order.makerTraits,
      },
      signature,
      extension: extension || "0x",
      timestamp: Date.now(),
      cancelled: false,
      filled: false,
      fillTx: null,
      filledTakingAmount: null,
      // Decode some useful fields for filtering
      maker: order.maker,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount,
      takingAmount: order.takingAmount,
      // Store makerTraits for expiration checks
      makerTraits: order.makerTraits,
    };

    orders.set(orderHash, orderData);

    console.log(`API: Order stored successfully. Total orders: ${orders.size}`);
    console.log("API: Stored order data:", {
      orderHash,
      extension: orderData.extension,
      extensionLength: orderData.extension?.length || 0,
      makerAsset: orderData.order.makerAsset,
      signature: orderData.signature,
      signatureLength: orderData.signature?.length || 0,
    });

    return NextResponse.json({
      success: true,
      orderHash,
      message: "Order submitted successfully",
    });
  } catch (error: any) {
    console.error("POST /api/orders error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to submit order" },
      { status: 500 }
    );
  }
}