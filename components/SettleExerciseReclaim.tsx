// src/components/vault/SettleExerciseReclaim.tsx
"use client";

import { useState } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";

export default function SettleExerciseReclaim() {
  const [seriesId, setSeriesId] = useState("");
  const [qty, setQty] = useState("");

  const onSettle = async () => {
    // TODO: vault.settleSeries(seriesId)
    console.log("settle", { seriesId });
  };

  const onExercise = async () => {
    // TODO: vault.exercise(seriesId, qty)
    console.log("exercise", { seriesId, qty });
  };

  const onReclaim = async () => {
    // TODO: vault.reclaim(seriesId)
    console.log("reclaim", { seriesId });
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
          label="Qty to Exercise"
          placeholder="1"
          value={qty}
          onValueChange={setQty}
          type="number"
          min="0"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onPress={onSettle}>Settle</Button>
        <Button onPress={onExercise}>Exercise</Button>
        <Button variant="flat" color="secondary" onPress={onReclaim}>
          Reclaim
        </Button>
      </div>
    </div>
  );
}