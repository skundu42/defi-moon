// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { keccak256, encodeAbiParameters } from "viem";

// Shared in-memory storage (in production, use a proper database)
let orders: Map<string, any>;

if (global.ordersStorage) {
  orders = global.ordersStorage;
} else {
  orders = new Map<string, any>();
  global.ordersStorage = orders;
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
    let filteredOrders = Array.from(orders.values());

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

    console.log(`Found ${filteredOrders.length} orders, returning ${paginatedOrders.length}`);

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

    console.log("Received order submission:", { orderHash, order: order?.maker });

    // Validate required fields
    if (!order || !signature || !orderHash) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify order hash matches
    const calculatedHash = calculateOrderHash(order);
    if (calculatedHash !== orderHash) {
      console.error("Order hash mismatch:", { calculated: calculatedHash, provided: orderHash });
      return NextResponse.json(
        { error: "Order hash mismatch" },
        { status: 400 }
      );
    }

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
      order,
      signature,
      extension: extension || "0x",
      timestamp: Date.now(),
      cancelled: false,
      filled: false,
      fillTx: null,
      // Decode some useful fields for filtering
      maker: order.maker,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount,
      takingAmount: order.takingAmount,
      makerTraits: order.makerTraits,
    };

    orders.set(orderHash, orderData);

    console.log(`Order stored successfully. Total orders: ${orders.size}`);

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

// Helper function to calculate order hash
function calculateOrderHash(order: any): string {
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
        BigInt(order.salt),
        order.maker,
        order.receiver,
        order.makerAsset,
        order.takerAsset,
        BigInt(order.makingAmount),
        BigInt(order.takingAmount),
        BigInt(order.makerTraits),
      ]
    );

    return keccak256(encoded);
  } catch (error) {
    console.error("Error calculating order hash:", error);
    throw error;
  }
}

// Ensure global type
declare global {
  var ordersStorage: Map<string, any> | undefined;
}