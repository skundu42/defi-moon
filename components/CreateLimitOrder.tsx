// components/CreateLimitOrder.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Address, parseUnits, formatUnits, parseAbiItem } from "viem";
import {
  useAccount,
  useSignTypedData,
  usePublicClient,
  useWatchContractEvent,
} from "wagmi";
import { useSearchParams } from "next/navigation";

import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { Snippet } from "@heroui/snippet";
import { Spacer } from "@heroui/spacer";
import { Tooltip } from "@heroui/tooltip";
import { Spinner } from "@heroui/spinner";

import { useTokenAllowance } from "@/hooks/useTokenAllowance";
import { useOptionWrapper } from "@/hooks/useOptionWrapper";
import {
  buildLimitOrder,
  submitSignedOrder,
  fetchOrdersByMaker,
} from "@/lib/oneInch";
import { LOP_V4_GNOSIS, VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";
import { QUOTE_TOKENS, type TokenMeta, ALL_TOKENS } from "@/lib/token";

/** Small round "i" badge with a tooltip */
function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span
        className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help"
        aria-label="info"
      >
        i
      </span>
    </Tooltip>
  );
}

function fmt(num: number, maxFrac = 6) {
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

type SeriesRow = {
  id: bigint;
  underlying: `0x${string}`;
  strike: bigint; // 1e18 WXDAI
  expiry: bigint; // unix
};

// event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

const DEPLOY_FROM = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK
  ? BigInt(process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK)
  : undefined;

function symFromAddress(addr: string): string {
  const t = ALL_TOKENS.find(
    (x) => x.address.toLowerCase() === addr.toLowerCase()
  );
  return t ? t.symbol : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatStrikeWXDAI(n: bigint): string {
  const s = n.toString().padStart(19, "0");
  const head = s.slice(0, -18) || "0";
  const tail = s.slice(-18).replace(/0+$/, "");
  return tail.length ? `${head}.${tail}` : head;
}

function formatDateUTC(ts: bigint): string {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function CreateLimitOrder() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();

  // Hydration-safe rendering
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ------------------ Load Active Series (historical + live) ------------------
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [allSeries, setAllSeries] = useState<SeriesRow[]>([]);
  const bootRef = useRef(false);

  // Backfill logs in chunks; then filter to active only on demand.
  useEffect(() => {
    if (!publicClient || bootRef.current) return;
    bootRef.current = true;

    (async () => {
      try {
        setSeriesLoading(true);
        const latest = await publicClient.getBlockNumber();
        const DEFAULT_SPAN = 200_000n;
        const fromBlock =
          DEPLOY_FROM !== undefined
            ? DEPLOY_FROM
            : latest > DEFAULT_SPAN
            ? latest - DEFAULT_SPAN
            : 0n;

        const step = 10_000n;
        const acc: SeriesRow[] = [];

        for (let start = fromBlock; start <= latest; start += step + 1n) {
          const end = start + step > latest ? latest : start + step;
          const logs = await publicClient.getLogs({
            address: VAULT_ADDRESS,
            event: SERIES_DEFINED,
            fromBlock: start,
            toBlock: end,
          });
          for (const l of logs) {
            acc.push({
              id: l.args.id as bigint,
              underlying: l.args.underlying as `0x${string}`,
              strike: l.args.strike as bigint,
              expiry: l.args.expiry as bigint,
            });
          }
        }

        const map = new Map<string, SeriesRow>();
        for (const r of acc) map.set(r.id.toString(), r);

        setAllSeries(Array.from(map.values()));
      } catch (err) {
        console.error("Backfill series failed:", err);
      } finally {
        setSeriesLoading(false);
      }
    })();
  }, [publicClient]);

  // Live subscribe for new SeriesDefined
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setAllSeries((prev) => {
        const map = new Map<string, SeriesRow>();
        for (const r of prev) map.set(r.id.toString(), r);
        for (const l of logs) {
          map.set((l.args?.id as bigint).toString(), {
            id: l.args?.id as bigint,
            underlying: l.args?.underlying as `0x${string}`,
            strike: l.args?.strike as bigint,
            expiry: l.args?.expiry as bigint,
          });
        }
        return Array.from(map.values());
      });
    },
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const activeSeries = useMemo(
    () =>
      allSeries
        .filter((s) => Number(s.expiry) > nowSec)
        .sort((a, b) =>
          a.expiry === b.expiry ? Number(a.id - b.id) : Number(a.expiry - b.expiry)
        ), // soonest expiry first
    [allSeries, nowSec]
  );

  // ------------------ Selection: URL param OR first active ------------------
  const search = useSearchParams();
  const seriesIdParam = search?.get("seriesId");
  const preselectFromUrl = useMemo(() => {
    if (!seriesIdParam) return undefined;
    try {
      const id = BigInt(seriesIdParam);
      return activeSeries.find((s) => s.id === id) ? id : undefined;
    } catch {
      return undefined;
    }
  }, [seriesIdParam, activeSeries]);

  const [selectedSeriesId, setSelectedSeriesId] = useState<bigint | undefined>(undefined);

  // Initialize selection once activeSeries is known
  useEffect(() => {
    if (!mounted) return;
    if (activeSeries.length === 0) {
      setSelectedSeriesId(undefined);
      return;
    }
    setSelectedSeriesId((prev) => {
      if (prev !== undefined) return prev;
      if (preselectFromUrl !== undefined) return preselectFromUrl;
      return activeSeries[0]?.id;
    });
  }, [mounted, activeSeries, preselectFromUrl]);

  const selectedSeries = useMemo(
    () => activeSeries.find((s) => s.id === selectedSeriesId),
    [activeSeries, selectedSeriesId]
  );

  // ------------------ Wrapper & balances (for selected series) ------------------
  const {
    erc20Address,
    isApprovedForAll,
    balance1155,
    makerBalance20,
    makerSymbol20,
    makerDecimals20,
    setApprovalForAll,
    ensureSeriesERC20,
    wrap,
  } = useOptionWrapper(selectedSeriesId);

  // Ensure ERC-20 exists when a series is selected
  useEffect(() => {
    (async () => {
      if (!mounted) return;
      if (!selectedSeriesId) return;
      if (erc20Address && erc20Address !== "0x0000000000000000000000000000000000000000") return;
      try {
        await ensureSeriesERC20(
          `WrappedCall-${selectedSeriesId}`,
          `wCALL-${selectedSeriesId.toString().slice(0, 6)}`
        );
      } catch {
        // ok if exists already or user cancels
      }
    })();
  }, [mounted, selectedSeriesId, erc20Address, ensureSeriesERC20]);

  // ------------------ Taker token dropdown ------------------
  const defaultTaker =
    QUOTE_TOKENS.find((q) => q.symbol === "USDC")?.symbol ?? QUOTE_TOKENS[0]?.symbol;
  const [takerSym, setTakerSym] = useState<string | undefined>(defaultTaker);
  const takerToken: TokenMeta | undefined = useMemo(
    () => QUOTE_TOKENS.find((t) => t.symbol === takerSym),
    [takerSym]
  );

  // ------------------ Inputs ------------------
  const [wrapQty, setWrapQty] = useState<string>("");
  const [makingAmount, setMakingAmount] = useState<string>("");
  const [takingAmount, setTakingAmount] = useState<string>("");

  // ------------------ State ------------------
  const [submitting, setSubmitting] = useState(false);
  const [orderHash, setOrderHash] = useState<`0x${string}` | null>(null);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Allowance (maker token approval for 1inch LOP)
  const { approve, hasEnough, isApproving, refetchAllowance } = useTokenAllowance(
    (erc20Address as Address | undefined),
    LOP_V4_GNOSIS
  );

  // Derived displays
  const makerBalanceOptions = useMemo(() => {
    const dec = makerDecimals20 ?? 18;
    const human = formatUnits(makerBalance20 ?? 0n, dec);
    const n = Number(human);
    return fmt(n);
  }, [makerBalance20, makerDecimals20]);

  const impliedPrice = useMemo(() => {
    if (!makingAmount || !takingAmount || !takerToken) return "";
    const m = Number(makingAmount),
      t = Number(takingAmount);
    if (!Number.isFinite(m) || !Number.isFinite(t) || m <= 0) return "";
    return String(t / m);
  }, [makingAmount, takingAmount, takerToken]);

  // ------------------ Actions ------------------
  const doWrap = async () => {
    if (!selectedSeriesId) return alert("Select an active series.");
    const qty = Number(wrapQty || "0");
    if (!Number.isFinite(qty) || qty <= 0) return alert("Enter wrap qty");
    if (!isApprovedForAll) {
      await setApprovalForAll(true);
    }
    await wrap(BigInt(qty));
  };

  const valid = useMemo(() => {
    if (!address || !erc20Address || !takerToken) return false;
    if (!makingAmount || !takingAmount) return false;
    if (!selectedSeriesId) return false;
    return true;
  }, [address, erc20Address, takerToken, makingAmount, takingAmount, selectedSeriesId]);

  const handleSubmit = async () => {
    if (!address || !erc20Address || !takerToken || !selectedSeriesId) return;

    const making = parseUnits(makingAmount, makerDecimals20 ?? 18);
    const taking = parseUnits(takingAmount, takerToken.decimals);

    // Ensure allowance
    if (!hasEnough?.(making)) {
      await approve();
      await refetchAllowance();
    }

    setSubmitting(true);
    setOrderHash(null);
    try {
      const { order, typedData } = buildLimitOrder({
        makerAddress: address,
        makerAsset: erc20Address,
        takerAsset: takerToken.address,
        makingAmount: making,
        takingAmount: taking,
        expirationSec: 2 * 60 * 60, // 2h
      });

      const sig = await signTypedDataAsync({
        domain: typedData.domain as any,
        types: typedData.types as any,
        primaryType: "Order",
        message: typedData.message as any,
      });

      const hash = await submitSignedOrder(order, sig as `0x${string}`);
      setOrderHash(hash);

      // Fetch user's open orders (best effort)
      setOrdersLoading(true);
      try {
        const orders = await fetchOrdersByMaker(address);
        setOpenOrders(orders.items ?? orders ?? []);
      } catch (err) {
        console.warn("Fetch orders failed:", err);
      } finally {
        setOrdersLoading(false);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.shortMessage ?? e?.message ?? "Order submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------ UI ------------------
  return (
    <Card className="p-5">
      <h3 className="text-lg font-medium mb-4">Create 1inch Limit Order</h3>

      {/* Row 0: Active Series Selector */}
      <div className="rounded-2xl border border-default-200/50 bg-content1 p-4 mb-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 md:col-span-6">
            <label className="block mb-1 text-sm font-medium">
              Active Series{" "}
              <Info tip="Choose an unexpired option series. Expired series are hidden here." />
            </label>

            {seriesLoading ? (
              <div className="h-12 flex items-center gap-2 px-3 rounded-medium bg-default-100">
                <Spinner size="sm" /> <span className="text-sm text-default-500">Loading series…</span>
              </div>
            ) : (
              <Select
                selectionMode="single"
                selectedKeys={
                  mounted && selectedSeriesId
                    ? new Set([selectedSeriesId.toString()])
                    : new Set()
                }
                onSelectionChange={(keys) => {
                  const raw = Array.from(keys)[0] as string | undefined;
                  if (!raw) {
                    setSelectedSeriesId(undefined);
                  } else {
                    try {
                      setSelectedSeriesId(BigInt(raw));
                    } catch {
                      setSelectedSeriesId(undefined);
                    }
                  }
                }}
                classNames={{
                  trigger: "h-12 bg-default-100",
                  value: "text-sm",
                }}
                disallowEmptySelection
                aria-label="Select active series"
              >
                {activeSeries.map((s) => (
                  <SelectItem
                    key={s.id.toString()}
                    value={s.id.toString()}
                    textValue={`${s.id.toString()} — ${symFromAddress(
                      s.underlying
                    )} — K ${formatStrikeWXDAI(s.strike)} — exp ${formatDateUTC(s.expiry)}`}
                  >
                    <div className="flex flex-col">
                      <span className="font-mono">{s.id.toString()}</span>
                      <span className="text-xs text-default-500">
                        {symFromAddress(s.underlying)} • K {formatStrikeWXDAI(s.strike)} • exp{" "}
                        {formatDateUTC(s.expiry)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </Select>
            )}
          </div>

          <div className="col-span-12 md:col-span-6">
            {!seriesLoading && activeSeries.length === 0 && (
              <div className="rounded-xl border border-default-200/50 bg-content2 p-3 text-sm text-foreground/70">
                No active series found. Define a new series (admin) or wait for a new one.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 1: Series + Wrap */}
      <div className="rounded-2xl border border-default-200/50 bg-content1 p-4 mb-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 md:col-span-3">
            <label className="block mb-1 text-sm font-medium">
              SeriesId <Info tip="The selected active series ID." />
            </label>
            <Input
              isReadOnly
              value={mounted ? (selectedSeriesId?.toString() ?? "") : ""}
              placeholder="Select an active series"
              classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            />
          </div>

          <div className="col-span-6 md:col-span-2">
            <label className="block mb-1 text-sm font-medium">
              1155 Balance (options){" "}
              <Info tip="Unwrapped ERC-1155 options for this series." />
            </label>
            <Input
              isReadOnly
              value={mounted ? (balance1155?.toString() ?? "0") : "0"}
              classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            />
          </div>

          <div className="col-span-6 md:col-span-3">
            <label className="block mb-1 text-sm font-medium">
              Series ERC20 <Info tip="ERC-20 wrapper token address for this series." />
            </label>
            <Input
              isReadOnly
              value={mounted ? (erc20Address ?? "") : ""}
              classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            />
          </div>

          <div className="col-span-6 md:col-span-2">
            <label className="block mb-1 text-sm font-medium">
              Wrap Qty (options) <Info tip="How many ERC-1155 options to wrap." />
            </label>
            <Input
              placeholder="e.g. 10"
              value={wrapQty}
              onChange={(e) => setWrapQty(e.target.value)}
              classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            />
          </div>

          <div className="col-span-6 md:col-span-2 flex md:justify-end">
            <Button
              onPress={doWrap}
              isDisabled={!mounted || !selectedSeriesId}
              className="h-12"
            >
              Wrap
            </Button>
          </div>

          <div className="col-span-12 md:col-span-2">
            <label className="block mb-1 text-sm font-medium">
              ERC20 Balance (options) {mounted ? `(${makerSymbol20})` : ""}{" "}
              <Info tip="Wrapped options balance. 1 option = 1e18 units." />
            </label>
            <Input
              isReadOnly
              value={mounted ? makerBalanceOptions : "0"}
              classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            />
          </div>
        </div>
      </div>

      {/* Row 2: Maker / Taker */}
      <div className="grid grid-cols-12 gap-4">
        {/* Maker */}
        <div className="col-span-12 md:col-span-6 rounded-2xl border border-default-200/50 bg-content1 p-4">
          <div className="mb-2 text-sm font-medium">Sell (Maker)</div>
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-12 md:col-span-7">
              <label className="block mb-1 text-sm font-medium">
                Maker Token (ERC20){" "}
                <Info tip="The ERC-20 you’ll sell (wrapped options for the selected series)." />
              </label>
              <Input
                isReadOnly
                value={mounted ? (erc20Address ?? "") : ""}
                classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
              />
            </div>
            <div className="col-span-12 md:col-span-5">
              <label className="block mb-1 text-sm font-medium">
                Making Amount{" "}
                <Info tip="How many maker ERC-20 units to sell. (1 option = 1e18 units)" />
              </label>
              <Input
                placeholder="1000"
                value={makingAmount}
                onChange={(e) => setMakingAmount(e.target.value)}
                classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
              />
            </div>
          </div>
        </div>

        {/* Taker */}
        <div className="col-span-12 md:col-span-6 rounded-2xl border border-default-200/50 bg-content1 p-4">
          <div className="mb-2 text-sm font-medium">Buy (Taker)</div>
          <div className="grid grid-cols-12 gap-3 items-end">
            <div className="col-span-12 md:col-span-7">
              <label className="block mb-1 text-sm font-medium">
                Taker Token <Info tip="Token you want to receive." />
              </label>
              <Select
                selectionMode="single"
                defaultSelectedKeys={defaultTaker ? new Set([defaultTaker]) : undefined}
                selectedKeys={mounted && takerSym ? new Set([takerSym]) : undefined}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0] as string | undefined;
                  setTakerSym(next);
                }}
                classNames={{
                  trigger: "h-12 bg-default-100",
                  value: "text-sm",
                }}
              >
                {QUOTE_TOKENS.map((t) => (
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

            <div className="col-span-12 md:col-span-5">
              <label className="block mb-1 text-sm font-medium">
                Taking Amount <Info tip="Total amount of the taker token you want." />
              </label>
              <Input
                placeholder="500"
                value={takingAmount}
                onChange={(e) => setTakingAmount(e.target.value)}
                classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Implied price */}
      <div className="mt-3 text-default-500 text-sm">
        {(() => {
          const m = Number(makingAmount || "0");
          const t = Number(takingAmount || "0");
          const ok = Number.isFinite(m) && Number.isFinite(t) && m > 0;
          const implied = ok ? t / m : 0;
          return ok ? (
            <>
              Implied price:{" "}
              <span className="font-mono">
                {implied.toLocaleString(undefined, { maximumFractionDigits: 8 })}
              </span>{" "}
              {takerToken?.symbol} per maker-unit
            </>
          ) : (
            <>Enter amounts to see implied price.</>
          );
        })()}
      </div>

      <Spacer y={3} />

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          color="primary"
          isDisabled={!mounted || !valid || submitting}
          isLoading={submitting}
          onPress={handleSubmit}
        >
          {submitting ? "Submitting..." : "Create Order"}
        </Button>
        <Button
          variant="bordered"
          isDisabled={!mounted || !erc20Address}
          isLoading={isApproving}
          onPress={async () => {
            await approve();
            await refetchAllowance();
          }}
        >
          Approve 1inch (maker)
        </Button>
      </div>

      {/* Order hash */}
      {orderHash && (
        <div className="mt-5 space-y-2">
          <div className="text-sm text-default-500">Order Hash</div>
          <Snippet variant="flat" className="max-w-full break-all">
            {orderHash}
          </Snippet>
        </div>
      )}

      {/* Your open orders */}
      {ordersLoading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-default-500">
          <Spinner size="sm" /> Loading your open orders…
        </div>
      ) : openOrders?.length > 0 ? (
        <div className="mt-6">
          <h4 className="font-medium mb-2">Your open orders</h4>
          <div className="rounded-xl border border-default-200/50 bg-content2 p-3 text-sm overflow-x-auto">
            <table className="min-w-full">
              <thead className="text-default-500">
                <tr>
                  <th className="text-left p-2">hash</th>
                  <th className="text-left p-2">makerAsset</th>
                  <th className="text-left p-2">takerAsset</th>
                  <th className="text-left p-2">making</th>
                  <th className="text-left p-2">taking</th>
                  <th className="text-left p-2">status</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o: any) => (
                  <tr key={o.hash} className="border-t border-default-200/50">
                    <td className="p-2">{o.hash}</td>
                    <td className="p-2">{o.makerAsset}</td>
                    <td className="p-2">{o.takerAsset}</td>
                    <td className="p-2">{o.makingAmount}</td>
                    <td className="p-2">{o.takingAmount}</td>
                    <td className="p-2">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}