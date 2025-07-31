import { NextRequest, NextResponse } from "next/server";

// Access shared storage
declare global {
  var ordersStorage: Map<string, any> | undefined;
}

export async function POST(_request: NextRequest) {
  try {
    const orders = global.ordersStorage;
    if (!orders) {
      return NextResponse.json(
        { error: "Orders storage not initialized" },
        { status: 500 }
      );
    }

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

    console.log(`API: Cleaned up ${cleaned} expired orders`);

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${cleaned} expired orders`,
      cleaned,
    });
  } catch (error: any) {
    console.error("API: Cleanup action failed:", error);
    return NextResponse.json(
      { error: error.message || "Cleanup action failed" },
      { status: 500 }
    );
  }
}