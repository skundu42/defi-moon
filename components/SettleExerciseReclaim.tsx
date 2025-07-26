"use client";

import React, { useState } from "react";
import { useWriteContract } from "wagmi";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";

export default function SettleExerciseReclaim() {
  const [seriesId, setSeriesId] = useState<string>("");

  const { writeContractAsync, isPending } = useWriteContract();

  const call = (fn: "settle" | "exercise" | "reclaim") => async () => {
    await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: fn,
      args: [seriesId as any],
    });
    alert(`${fn} tx sent`);
  };

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Input label="SeriesId (bytes32)" placeholder="0x..." value={seriesId} onChange={(e) => setSeriesId(e.target.value)} />
        <Button color="primary" isLoading={isPending} onPress={call("settle")}>
          Settle
        </Button>
        <Button variant="flat" isLoading={isPending} onPress={call("exercise")}>
          Exercise
        </Button>
        <Button variant="bordered" isLoading={isPending} onPress={call("reclaim")}>
          Reclaim
        </Button>
      </div>
    </Card>
  );
}