// src/components/vault/MintOptionsForm.tsx
"use client";

import { useState } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";

export default function MintOptionsForm() {
  const [seriesId, setSeriesId] = useState("");
  const [qty, setQty] = useState("");

  const onMint = async () => {
    // TODO: vault.mintOptions(seriesId, qty)
    console.log("mint", { seriesId, qty });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          label="Series ID"
          placeholder="0x..."
          value={seriesId}
          onValueChange={setSeriesId}
        />
        <Input
          label="Quantity"
          placeholder="5"
          value={qty}
          onValueChange={setQty}
          type="number"
          min="0"
        />
      </div>

      <Button color="primary" onPress={onMint}>Mint Options</Button>
    </div>
  );
}