"use client";

import React, { useMemo, useState } from "react";
import { parseUnits, parseAbiItem, decodeEventLog } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";

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

/** event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry) */
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);
// viem's decodeEventLog accepts an ABI array. We'll pass just this single event.
const SERIES_EVENTS_ABI = [SERIES_DEFINED] as const;

export default function DefineSeriesForm() {
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();

  // Underlying (decimals inferred internally)
  const [underSym, setUnderSym] = useState<TokenSymbol>(UNDERLYING_DEFAULT_SYMBOL);
  const underlying = useMemo(() => getTokenBySymbol(underSym), [underSym]);

  // Form fields (human units)
  const [strikeHuman, setStrikeHuman] = useState<string>("");
  const [expiryIso, setExpiryIso] = useState<string>("");
  const [collatHuman, setCollatHuman] = useState<string>("");
  const [oracleAddr, setOracleAddr] = useState<string>("");

  const expirySec = useMemo(() => {
    if (!expiryIso) return 0;
    const ms = Date.parse(expiryIso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }, [expiryIso]);

  const onSubmit = async () => {
    try {
      if (!strikeHuman || !expirySec || !collatHuman || !oracleAddr) {
        alert("Please fill all fields (including Oracle address).");
        return;
      }
      if (!isHexAddress(oracleAddr)) {
        alert("Oracle address must be a valid 0x…40-hex address.");
        return;
      }

      const strikeWei = parseUnits(strikeHuman, 18);                  // WXDAI 1e18
      const collatWei = parseUnits(collatHuman, underlying.decimals); // underlying decimals

      const hash = await writeContractAsync({
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

      // Wait for confirmation and decode the SeriesDefined event
      if (publicClient && hash) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Try to find the SeriesDefined event in the tx logs and broadcast it as a browser event.
        for (const log of receipt.logs ?? []) {
          try {
            const decoded = decodeEventLog({
              abi: SERIES_EVENTS_ABI as any,
              data: log.data,
              topics: log.topics,
            });

            if (decoded?.eventName === "SeriesDefined") {
              const { id, underlying, strike, expiry } = decoded.args as {
                id: bigint;
                underlying: `0x${string}`;
                strike: bigint;
                expiry: bigint;
              };

              // Fire an optimistic UI signal to the app — SeriesTable listens to this.
              window.dispatchEvent(
                new CustomEvent("series:defined", {
                  detail: { id, underlying, strike, expiry },
                })
              );

              break; // Found it
            }
          } catch {
            // Not the event we want — continue scanning logs
          }
        }
      }

      setStrikeHuman("");
      setExpiryIso("");
      setCollatHuman("");
      setOracleAddr("");
      alert("Series defined!");
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage ?? e?.message ?? "Failed to define series");
    }
  };

  return (
    <Card className="p-5">
      <div className="grid grid-cols-12 gap-3 items-end">
        {/* Underlying */}
        <div className="col-span-12 md:col-span-3">
          <label className="block mb-1 text-sm font-medium">
            Underlying <Info tip="Token used as collateral. Must match the vault’s underlying." />
          </label>
          <Select
            selectionMode="single"
            defaultSelectedKeys={new Set([UNDERLYING_DEFAULT_SYMBOL])}
            selectedKeys={new Set([underSym])}
            onSelectionChange={(keys) => {
              const next = Array.from(keys)[0] as TokenSymbol;
              setUnderSym(next);
            }}
            classNames={{
              trigger: "h-12 bg-default-100",
              value: "text-sm",
            }}
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
            Strike (WXDAI) <Info tip="Enter the strike price in WXDAI (human units)." />
          </label>
          <Input
            placeholder="e.g. 150"
            value={strikeHuman}
            onChange={(e) => setStrikeHuman(e.target.value)}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        {/* Expiry */}
        <div className="col-span-12 md:col-span-3">
          <label className="block mb-1 text-sm font-medium">
            Expiry <Info tip="UTC date & time when the option expires." />
          </label>
          <Input
            type="datetime-local"
            value={expiryIso}
            onChange={(e) => setExpiryIso(e.target.value)}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        {/* Collateral per option */}
        <div className="col-span-12 md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Collateral / option ({underlying.symbol}){" "}
            <Info tip={`Amount of ${underlying.symbol} locked per option (e.g., “1”).`} />
          </label>
          <Input
            placeholder="e.g. 1"
            value={collatHuman}
            onChange={(e) => setCollatHuman(e.target.value)}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        {/* Oracle (manual entry) */}
        <div className="col-span-12 md:col-span-2">
          <label className="block mb-1 text-sm font-medium">
            Oracle <Info tip="Oracle contract that returns price in WXDAI (1e18 scale)." />
          </label>
          <Input
            placeholder="0x…"
            value={oracleAddr}
            onChange={(e) => setOracleAddr(e.target.value)}
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        {/* Button */}
        <div className="col-span-12 md:col-span-2 flex md:justify-end">
          <Button color="primary" onPress={onSubmit} isLoading={isPending} className="h-12">
            Define Series
          </Button>
        </div>
      </div>
    </Card>
  );
}