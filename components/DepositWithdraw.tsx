// src/components/vault/DepositWithdraw.tsx
"use client";

import { useState } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";

export default function DepositWithdraw() {
  const [amount, setAmount] = useState("");

  const onDeposit = async () => {
    // TODO: vault.deposit(amount)
    console.log("deposit", amount);
  };

  const onWithdraw = async () => {
    // TODO: vault.withdraw(amount)
    console.log("withdraw", amount);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          label="Amount (GNO)"
          placeholder="10.0"
          value={amount}
          onValueChange={setAmount}
          type="number"
          min="0"
        />
      </div>

      <div className="flex gap-3">
        <Button color="primary" onPress={onDeposit}>Deposit</Button>
        <Button color="danger" variant="flat" onPress={onWithdraw}>Withdraw</Button>
      </div>
    </div>
  );
}