"use client";

import Orderbook from "@/components/Orderbook";
import { Card } from "@heroui/card";

export default function OrderbookPage() {
  return (
    <section className="mx-auto max-w-4xl py-10 md:py-14 space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Options Orderbook</h1>
        <p className="text-default-500">
          Browse and fill ERC-1155 limit orders on the Gnosis Chain.
        </p>
      </header>

      <Card className="p-5">
        <Orderbook />
      </Card>
    </section>
  );
}