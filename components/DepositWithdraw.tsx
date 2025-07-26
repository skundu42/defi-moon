// components/DepositWithdraw.tsx
"use client";

import React, { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract } from "wagmi";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";

export default function DepositWithdraw() {
  const [amount, setAmount] = useState<string>("");

  const { writeContractAsync, isPending } = useWriteContract();

  const deposit = async () => {
    const value = parseUnits(amount || "0", 18);
    await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "depositCollateral",
      args: [value],
    });
    alert("Deposit tx sent");
  };

  const withdraw = async () => {
    const value = parseUnits(amount || "0", 18);
    await writeContractAsync({
      address: VAULT_ADDRESS,
      abi: vaultAbi,
      functionName: "withdrawCollateral",
      args: [value],
    });
    alert("Withdraw tx sent");
  };

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="Amount" placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button color="primary" isLoading={isPending} onPress={deposit}>
          Deposit
        </Button>
        <Button variant="bordered" isLoading={isPending} onPress={withdraw}>
          Withdraw
        </Button>
      </div>
    </Card>
  );
}