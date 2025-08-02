
// app/api/orders/cleanup/route.ts
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
        // Get makerTraits from either nested order or top level
        const makerTraits = BigInt(order.order?.makerTraits || order.makerTraits || "0");
        const expiration = Number((makerTraits >> 210n) & ((1n << 40n) - 1n));
        
        // Remove if expired (expiration > 0 means there is an expiration set)
        if (expiration > 0 && expiration <= now) {
          orders.delete(hash);
          cleaned++;
          console.log(`API: Cleaned expired order ${hash} (expired at ${expiration}, now ${now})`);
        }
      } catch (error) {
        // Skip invalid orders but log the error
        console.warn(`API: Error processing order ${hash} during cleanup:`, error);
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