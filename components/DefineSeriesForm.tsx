// components/DefineSeriesForm.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
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

export default function DefineSeriesForm() {
  const { writeContractAsync, isLoading: isSubmitting } = useWriteContract();
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
  const pushNotice = (type: Notice["type"], text: string) =>
    setNotices((n) => [...n, { id: crypto.randomUUID(), type, text }]);
  const clearNotice = (id: string) =>
    setNotices((n) => n.filter((x) => x.id !== id));

  // re-broadcast on-chain events
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      for (const log of logs) {
        const detail = {
          id: (log.args.id as bigint).toString(),
          underlying: log.args.underlying as `0x${string}`,
          strike: log.args.strike as bigint,
          expiry: log.args.expiry as bigint,
        };
        window.dispatchEvent(new CustomEvent("series:defined", { detail }));
      }
    },
  });

  const onSubmit = async () => {
    if (!strikeHuman || !expirySec || !collatHuman || !oracleAddr) {
      pushNotice("error", "All fields are required.");
      return;
    }
    if (!isHexAddress(oracleAddr)) {
      pushNotice("error", "Oracle must be a valid 0x… address.");
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

      // wait for on-chain confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      pushNotice("success", "Series defined successfully!");

      // reset form
      setStrikeHuman("");
      setExpiryIso("");
      setCollatHuman("");
      setOracleAddr("");
    } catch (e: any) {
      console.error(e);
      pushNotice("error", e?.shortMessage ?? e?.message ?? "Failed to define series.");
    }
  };

  return (
    <Card className="p-5 space-y-4">
      {/* Notifications */}
      {notices.map((n) => (
        <div
          key={n.id}
          className={`p-3 text-sm rounded-xl ${
            n.type === "success"
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {n.text}
          <button
            onClick={() => clearNotice(n.id)}
            className="ml-2 text-xs opacity-50 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}

      {/* Form */}
      <div className="grid grid-cols-12 gap-3 items-end">
        {/* Underlying */}
        <div className="col-span-12 md:col-span-3">
          <label className="block mb-1 text-sm font-medium">
            Underlying <Info tip="Token used as collateral." />
          </label>
          <Select
            selectionMode="single"
            selectedKeys={new Set([underSym])}
            onSelectionChange={(keys) =>
              setUnderSym(Array.from(keys as Set<string>)[0] as TokenSymbol)
            }
            classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
          >
            {ALL_TOKENS.map((t) => (
              <SelectItem
                key={t.symbol}
                value={t.symbol}
                textValue={`${t.symbol} — ${t.name}`}
              >
                {t.symbol} — {t.name}
              </SelectItem>
            ))}
          </Select>
        </div>

        {/* Strike */}
        <div className="col-span-12 md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Strike (WXDAI) <Info tip="e.g. 150" />
          </label>
          <Input
            placeholder="e.g. 150"
            value={strikeHuman}
            onChange={(e) => setStrikeHuman(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
        </div>

        {/* Expiry */}
        <div className="col-span-12 md:col-span-3">
          <label className="block mb-1 text-sm font-medium">
            Expiry <Info tip="UTC date & time" />
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
        </div>

        {/* Collateral */}
        <div className="col-span-12 md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Collateral/option ({underlying.symbol}){" "}
            <Info tip={`e.g. 1 ${underlying.symbol}`} />
          </label>
          <Input
            placeholder="e.g. 1"
            value={collatHuman}
            onChange={(e) => setCollatHuman(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
        </div>

        {/* Oracle */}
        <div className="col-span-12 md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Oracle <Info tip="Price feed in WXDAI (1e18 scale)" />
          </label>
          <Input
            placeholder="0x…"
            value={oracleAddr}
            onChange={(e) => setOracleAddr(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
        </div>

        {/* Submit */}
        <div className="col-span-12 md:col-span-2 flex md:justify-end">
          <Button
            color="primary"
            onPress={onSubmit}
            isLoading={isSubmitting}
            className="h-12"
          >
            Define Series
          </Button>
        </div>
      </div>
    </Card>
  );
}