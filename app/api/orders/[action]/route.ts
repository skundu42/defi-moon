// app/api/orders/[action]/route.ts
import { NextRequest, NextResponse } from "next/server";

// Import the shared orders Map from the main route
// In a real app, this would be a database
let orders: Map<string, any>;

// Initialize shared storage (in production, use a database)
if (global.ordersStorage) {
  orders = global.ordersStorage;
} else {
  orders = new Map<string, any>();
  global.ordersStorage = orders;
}

// POST /api/orders/fill - Mark order as filled
// POST /api/orders/cancel - Cancel order
// POST /api/orders/cleanup - Clean expired orders
export async function POST(
  request: NextRequest,
  { params }: { params: { action: string } }
) {
  const action = params.action;

  try {
    const body = await request.json();

    if (action === "fill") {
      const { orderHash, txHash } = body;

      if (!orderHash) {
        return NextResponse.json(
          { error: "Missing orderHash" },
          { status: 400 }
        );
      }

      const order = orders.get(orderHash);
      if (!order) {
        return NextResponse.json(
          { error: "Order not found" },
          { status: 404 }
        );
      }

      // Mark as filled
      order.filled = true;
      order.fillTx = txHash;
      order.filledAt = Date.now();
      orders.set(orderHash, order);

      return NextResponse.json({
        success: true,
        message: "Order marked as filled",
      });
    }

    if (action === "cancel") {
      const { orderHash } = body;

      if (!orderHash) {
        return NextResponse.json(
          { error: "Missing orderHash" },
          { status: 400 }
        );
      }

      const order = orders.get(orderHash);
      if (!order) {
        return NextResponse.json(
          { error: "Order not found" },
          { status: 404 }
        );
      }

      // Mark as cancelled
      order.cancelled = true;
      order.cancelledAt = Date.now();
      orders.set(orderHash, order);

      return NextResponse.json({
        success: true,
        message: "Order cancelled",
      });
    }

    if (action === "cleanup") {
      // Remove expired orders
      const now = Math.floor(Date.now() / 1000);
      let cleaned = 0;

      for (const [hash, order] of orders.entries()) {
        try {
          const expiration = Number((BigInt(order.order.makerTraits) >> 210n) & ((1n << 40n) - 1n));
          if (expiration > 0 && expiration <= now) {
            orders.delete(hash);
            cleaned++;
          }
        } catch (e) {
          // Skip invalid orders
          continue;
        }
      }

      return NextResponse.json({
        success: true,
        message: `Cleaned up ${cleaned} expired orders`,
        cleaned,
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Action failed" },
      { status: 500 }
    );
  }
}

// Ensure global type
declare global {
  var ordersStorage: Map<string, any> | undefined;
}