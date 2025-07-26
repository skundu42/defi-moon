// components/MintOptionsForm.tsx
"use client";

import React, { useState } from "react";
import { Address, parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";

export default function MintOptionsForm() {
  const [seriesId, setSeriesId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const { writeContractAsync, isPending } = useWriteContract();

  const mint = async () => {
    const amt = parseUnits(amount || "0", 18);
    await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "mintOptions",
      args: [seriesId as any, amt],
    });
    alert("Mint tx sent");
  };

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="SeriesId (bytes32)" placeholder="0x..." value={seriesId} onChange={(e) => setSeriesId(e.target.value)} />
        <Input label="Amount" placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button color="primary" isLoading={isPending} onPress={mint}>
          Mint
        </Button>
      </div>
    </Card>
  );
}