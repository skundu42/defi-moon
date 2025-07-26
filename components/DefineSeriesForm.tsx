// src/components/vault/DefineSeriesForm.tsx
"use client";

import { useState } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Code } from "@heroui/code";

export default function DefineSeriesForm() {
  const [underlying, setUnderlying] = useState(""); // e.g., GNO
  const [strike, setStrike] = useState("");
  const [expiry, setExpiry] = useState("");

  const onDefine = async () => {
    // TODO: wire to OptionsVault.defineSeries(...)
    console.log({ underlying, strike, expiry });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          label="Underlying (symbol)"
          placeholder="GNO"
          value={underlying}
          onValueChange={setUnderlying}
        />
        <Input
          label="Strike (in xDAI)"
          placeholder="100"
          value={strike}
          onValueChange={setStrike}
          type="number"
          min="0"
        />
        <Input
          label="Expiry (Unix seconds)"
          placeholder="1699999999"
          value={expiry}
          onValueChange={setExpiry}
          type="number"
          min="0"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button color="primary" onPress={onDefine}>
          Define Series
        </Button>
        <span className="text-xs text-default-500">
          Series id is typically derived (e.g., keccak256(underlying|strike|expiry)).
        </span>
      </div>

      <p className="text-xs text-default-500">
        You’ll later plug this into your on-chain factory, then reference the
        ERC-1155 id when minting. (HeroUI per-package imports match the docs. <Code>import {"{ Input }"} from "@heroui/input"</Code>.) 
      </p>
    </div>
  );
}