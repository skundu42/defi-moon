
// app/api/orders/fill/route.ts
import { NextRequest, NextResponse } from "next/server";

// Access shared storage
declare global {
  var ordersStorage: Map<string, any> | undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderHash, txHash } = body;

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

    // Prevent double-filling
    if (order.filled) {
      console.warn(`API: Order ${orderHash} already filled`);
      return NextResponse.json(
        { error: "Order already filled" },
        { status: 409 }
      );
    }

    // Mark as filled
    order.filled = true;
    order.fillTx = txHash;
    order.filledAt = Date.now();
    // Store the actual filled amount (for now, assume full fill)
    order.filledTakingAmount = order.takingAmount || order.order?.takingAmount;
    orders.set(orderHash, order);

    console.log(`API: Order ${orderHash} marked as filled with tx ${txHash}`);

    return NextResponse.json({
      success: true,
      message: "Order marked as filled",
      orderHash,
      txHash,
    });
  } catch (error: any) {
    console.error("API: Fill action failed:", error);
    return NextResponse.json(
      { error: error.message || "Fill action failed" },
      { status: 500 }
    );
  }
}

