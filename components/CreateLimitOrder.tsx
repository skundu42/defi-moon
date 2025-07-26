// src/components/vault/CreateLimitOrder.tsx
"use client";

import { useState } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";

export default function CreateLimitOrder() {
  const [seriesId, setSeriesId] = useState("");
  const [qty, setQty] = useState("");
  const [premium, setPremium] = useState("");

  const onCreate = async () => {
    // TODO: Plug into 1inch Limit Order SDK build/sign, then POST to orderbook API
    console.log("1inch order", { seriesId, qty, premium });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          label="Series ID (ERC-1155)"
          placeholder="0x..."
          value={seriesId}
          onValueChange={setSeriesId}
        />
        <Input
          label="Quantity"
          placeholder="1"
          value={qty}
          onValueChange={setQty}
          type="number"
          min="0"
        />
        <Input
          label="Premium (xDAI)"
          placeholder="5"
          value={premium}
          onValueChange={setPremium}
          type="number"
          min="0"
        />
      </div>

      <Button color="primary" onPress={onCreate}>Build & Sign Order</Button>

      <p className="text-xs text-default-500">
        Later you’ll integrate the 1inch SDK and LOP v3. We’ll keep UI stable and
        wire the submit to your signer once you add the dependency.
      </p>
    </div>
  );
}