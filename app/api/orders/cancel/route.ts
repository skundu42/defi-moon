
// app/api/orders/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";

// Access shared storage
declare global {
  var ordersStorage: Map<string, any> | undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderHash } = body;

    if (!orderHash) {
      return NextResponse.json(
        { error: "Missing orderHash" },
        { status: 400 }
      );
    }

    const orders = global.ordersStorage;
    if (!orders) {
      return NextResponse.json(
        { error: "Orders storage not initialized" },
        { status: 500 }
      );
    }

    const order = orders.get(orderHash);
    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // Prevent double-cancelling
    if (order.cancelled) {
      console.warn(`API: Order ${orderHash} already cancelled`);
      return NextResponse.json(
        { error: "Order already cancelled" },
        { status: 409 }
      );
    }

    // Prevent cancelling filled orders
    if (order.filled) {
      return NextResponse.json(
        { error: "Cannot cancel filled order" },
        { status: 409 }
      );
    }

    // Mark as cancelled
    order.cancelled = true;
    order.cancelledAt = Date.now();
    orders.set(orderHash, order);

    console.log(`API: Order ${orderHash} marked as cancelled`);

    return NextResponse.json({
      success: true,
      message: "Order cancelled",
      orderHash,
    });
  } catch (error: any) {
    console.error("API: Cancel action failed:", error);
    return NextResponse.json(
      { error: error.message || "Cancel action failed" },
      { status: 500 }
    );
  }
}

