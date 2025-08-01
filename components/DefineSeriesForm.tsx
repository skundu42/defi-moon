// components/DefineSeriesForm.tsx
"use client";

import React, { useCallback, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { usePublicClient, useWriteContract, useWatchContractEvent } from "wagmi";

import { Card } from "@heroui/card";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Select, SelectItem } from "@heroui/select";
import { Tooltip } from "@heroui/tooltip";

import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import {
  ALL_TOKENS,
  UNDERLYING_DEFAULT_SYMBOL,
  getTokenBySymbol,
  type TokenSymbol,
  type TokenMeta,
} from "@/lib/token";

function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

function isHexAddress(s: string): s is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(s);
}

type Notice = { id: string; type: "success" | "error"; text: string };

type DefineSeriesFormProps = {
  onSeriesCreated?: () => void;
};

export default function DefineSeriesForm({ onSeriesCreated }: DefineSeriesFormProps) {
  const { writeContractAsync, isPending: isSubmitting } = useWriteContract();
  const publicClient = usePublicClient();

  // Underlying selector + guaranteed fallback
  const [underSym, setUnderSym] = useState<TokenSymbol>(UNDERLYING_DEFAULT_SYMBOL);
  const underlying: TokenMeta = useMemo(() => {
    return getTokenBySymbol(underSym) ?? getTokenBySymbol(UNDERLYING_DEFAULT_SYMBOL)!;
  }, [underSym]);

  // form fields
  const [strikeHuman, setStrikeHuman] = useState("");
  const [expiryIso, setExpiryIso] = useState("");
  const [collatHuman, setCollatHuman] = useState("");
  const [oracleAddr, setOracleAddr] = useState("");

  const expirySec = useMemo(() => {
    if (!expiryIso) return 0;
    const ms = Date.parse(expiryIso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }, [expiryIso]);

  // notifications
  const [notices, setNotices] = useState<Notice[]>([]);
  
  const pushNotice = useCallback((type: Notice["type"], text: string) => {
    const id = crypto.randomUUID();
    setNotices((n) => [...n, { id, type, text }]);
    
    // Auto-clear success notices after 5 seconds
    if (type === "success") {
      setTimeout(() => {
        setNotices((n) => n.filter((x) => x.id !== id));
      }, 5000);
    }
  }, []);
  
  const clearNotice = useCallback((id: string) => {
    setNotices((n) => n.filter((x) => x.id !== id));
  }, []);

  // Remove the problematic event watcher that was causing false positives
  // The parent component will handle refreshing the series list

  const handleUnderlyingChange = useCallback((keys: any) => {
    const selectedKey = Array.from(keys as Set<string>)[0] as TokenSymbol;
    if (selectedKey) {
      setUnderSym(selectedKey);
    }
  }, []);

  const onSubmit = useCallback(async () => {
    // Clear previous error notices
    setNotices((n) => n.filter((x) => x.type !== "error"));

    if (!strikeHuman || !expirySec || !collatHuman || !oracleAddr) {
      pushNotice("error", "All fields are required.");
      return;
    }
    
    if (!isHexAddress(oracleAddr)) {
      pushNotice("error", "Oracle must be a valid 0x… address.");
      return;
    }

    // Validate expiry is in the future
    const now = Math.floor(Date.now() / 1000);
    if (expirySec <= now) {
      pushNotice("error", "Expiry must be in the future.");
      return;
    }

    // Validate numeric inputs
    try {
      const strikeNum = parseFloat(strikeHuman);
      const collatNum = parseFloat(collatHuman);
      
      if (strikeNum <= 0) {
        pushNotice("error", "Strike price must be greater than 0.");
        return;
      }
      
      if (collatNum <= 0) {
        pushNotice("error", "Collateral per option must be greater than 0.");
        return;
      }
    } catch {
      pushNotice("error", "Please enter valid numbers for strike and collateral.");
      return;
    }

    if (!publicClient) {
      pushNotice("error", "Wallet not connected or public client not available.");
      return;
    }

    try {
      const strikeWei = parseUnits(strikeHuman, 18);
      const collatWei = parseUnits(collatHuman, underlying.decimals);

      // submit and get the txHash string
      const txHash = await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "defineSeries",
        args: [
          underlying.address,
          underlying.decimals,
          strikeWei,
          BigInt(expirySec),
          collatWei,
          oracleAddr as `0x${string}`,
        ],
      });

      pushNotice("success", "Transaction submitted! Waiting for confirmation...");

      // wait for on-chain confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      
      // Check if transaction was successful
      if (receipt.status === "success") {
        pushNotice("success", "Series defined successfully!");
        
        // Trigger parent component to refresh series list
        if (onSeriesCreated) {
          onSeriesCreated();
        }
        
        // reset form
        setStrikeHuman("");
        setExpiryIso("");
        setCollatHuman("");
        setOracleAddr("");
      } else {
        pushNotice("error", "Transaction was reverted. Please check your inputs and try again.");
      }
    } catch (error: any) {
      console.error("DefineSeriesForm error:", error);
      
      let errorMessage = "Failed to define series.";
      
      // Handle common error types
      if (error?.shortMessage) {
        errorMessage = error.shortMessage;
      } else if (error?.message) {
        if (error.message.includes("user rejected")) {
          errorMessage = "Transaction was rejected by user.";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for transaction.";
        } else {
          errorMessage = error.message;
        }
      }
      
      pushNotice("error", errorMessage);
    }
  }, [
    strikeHuman,
    expirySec,
    collatHuman,
    oracleAddr,
    underlying.decimals,
    underlying.address,
    publicClient,
    writeContractAsync,
    pushNotice,
  ]);

  // Set default expiry to 7 days from now when component mounts
  React.useEffect(() => {
    if (!expiryIso) {
      const defaultExpiry = new Date();
      defaultExpiry.setDate(defaultExpiry.getDate() + 7);
      defaultExpiry.setHours(17, 0, 0, 0); // 5 PM
      setExpiryIso(defaultExpiry.toISOString().slice(0, 16));
    }
  }, [expiryIso]);

  return (
    <Card className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="text-center">
        <h3 className="text-xl font-semibold mb-2">
          Define New Option Series
        </h3>
        <p className="text-sm text-default-600">
          Create a new option series for trading
        </p>
      </div>

      {/* Notifications */}
      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((n) => (
            <div
              key={n.id}
              className={`p-3 text-sm rounded-lg flex items-center justify-between ${
                n.type === "success"
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              <span>{n.text}</span>
              <button
                onClick={() => clearNotice(n.id)}
                className="ml-2 text-lg font-bold opacity-50 hover:opacity-100 leading-none"
                aria-label="Close notification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Underlying */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              Underlying Token <Info tip="Token used as collateral for the options" />
            </label>
            <Select
              selectionMode="single"
              selectedKeys={new Set([underSym])}
              onSelectionChange={handleUnderlyingChange}
              classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
            >
              {ALL_TOKENS.map((t) => (
                <SelectItem
                  key={t.symbol}
                  textValue={`${t.symbol} — ${t.name}`}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="text-xs text-default-500">{t.name}</span>
                  </div>
                </SelectItem>
              ))}
            </Select>
          </div>

          {/* Strike */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              Strike Price (WXDAI) <Info tip="Exercise price in WXDAI (e.g. 150)" />
            </label>
            <Input
              placeholder="e.g. 150"
              value={strikeHuman}
              onChange={(e) => setStrikeHuman(e.target.value)}
              type="number"
              step="0.01"
              min="0"
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm",
              }}
            />
          </div>

          {/* Collateral */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              Collateral per Option ({underlying.symbol}){" "}
              <Info tip={`Amount of ${underlying.symbol} required as collateral per option (e.g. 0.001)`} />
            </label>
            <Input
              placeholder="e.g. 0.001"
              value={collatHuman}
              onChange={(e) => setCollatHuman(e.target.value)}
              type="number"
              step="0.001"
              min="0"
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm",
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Expiry */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              Expiry Date & Time <Info tip="When the option expires (UTC timezone)" />
            </label>
            <Input
              type="datetime-local"
              value={expiryIso}
              onChange={(e) => setExpiryIso(e.target.value)}
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm",
              }}
            />
            {expirySec > 0 && (
              <div className="text-xs text-default-600">
                Expires: {new Date(expirySec * 1000).toLocaleString()} UTC
              </div>
            )}
          </div>

          {/* Oracle */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              Oracle Address <Info tip="Price feed contract address that provides GNO/WXDAI prices" />
            </label>
            <Input
              placeholder="0x..."
              value={oracleAddr}
              onChange={(e) => setOracleAddr(e.target.value)}
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm font-mono",
              }}
            />
          </div>
        </div>

        {/* Summary */}
        {strikeHuman && collatHuman && expirySec > 0 && (
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-medium text-blue-800 mb-2">Series Summary:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-blue-700">
              <div>• Underlying: {underlying.symbol} ({underlying.name})</div>
              <div>• Strike: {strikeHuman} WXDAI</div>
              <div>• Collateral: {collatHuman} {underlying.symbol} per option</div>
              <div>• Expires: {new Date(expirySec * 1000).toLocaleDateString()}</div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-center pt-4">
          <Button
            color="primary"
            size="lg"
            onPress={onSubmit}
            isLoading={isSubmitting}
            isDisabled={
              !strikeHuman || 
              !expirySec || 
              !collatHuman || 
              !oracleAddr || 
              isSubmitting
            }
            className="h-14 px-8"
          >
            {isSubmitting ? "Defining Series..." : "Define Option Series"}
          </Button>
        </div>
      </div>
    </Card>
  );
}