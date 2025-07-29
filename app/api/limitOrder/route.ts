// app/api/limitOrder/route.ts
import { NextResponse } from "next/server";
import {
  buildLimitOrder1155,
  submitSignedOrder,
  fetchOrdersByMaker,
} from "@/lib/oneInch";
import { Address as OneInchAddress } from "@1inch/limit-order-sdk";

export async function POST(request: Request) {
  try {
    const {
      makerAddress,
      makerAsset,
      takerAsset,
      takerAmount,
      expirationSec,
      signature,
    } = (await request.json()) as {
      makerAddress: string;
      makerAsset: { token: string; tokenId: string; amount: string; data?: string };
      takerAsset: string;
      takerAmount: string;
      expirationSec?: number;
      signature: `0x${string}`;
    };

    // Rebuild the on-chain order parameters exactly
    const built = buildLimitOrder1155({
      makerAddress,
      maker1155: {
        token: makerAsset.token,
        tokenId: BigInt(makerAsset.tokenId),
        amount: BigInt(makerAsset.amount),
        data: (makerAsset.data as any) ?? "0x",
      },
      takerAsset,
      takerAmount: BigInt(takerAmount),
      expirationSec,
    });

    // Submit to 1inch orderbook
    await submitSignedOrder(built, signature);

    // Compute the order hash (chainId = 100)
    const hash = built.order.getOrderHash(100);
    return NextResponse.json({ hash });
  } catch (err: any) {
    console.error("limitOrder POST error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const maker = url.searchParams.get("maker");
    if (!maker) throw new Error("Missing maker");
    const orders = await fetchOrdersByMaker(maker);
    return NextResponse.json(orders);
  } catch (err: any) {
    console.error("limitOrder GET error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}