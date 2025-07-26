// components/CreateLimitOrder.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Address, parseUnits, formatUnits } from "viem";
import { useAccount, useSignTypedData } from "wagmi";
import { useSearchParams } from "next/navigation";

import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { Snippet } from "@heroui/snippet";
import { Spacer } from "@heroui/spacer";
import { Tooltip } from "@heroui/tooltip";

import { useTokenAllowance } from "@/hooks/useTokenAllowance";
import { useOptionWrapper } from "@/hooks/useOptionWrapper";
import { buildLimitOrder, submitSignedOrder, fetchOrdersByMaker } from "@/lib/oneInch";
import { LOP_V4_GNOSIS } from "@/lib/contracts";
import { QUOTE_TOKENS, type TokenMeta } from "@/lib/token";

/** Minimal inline info badge */
function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

function fmt(num: number, maxFrac = 6) {
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

export default function CreateLimitOrder() {
  const { address } = useAccount();

  // Hydration-safe selection
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // seriesId from URL
  const search = useSearchParams();
  const seriesIdParam = search?.get("seriesId");
  const seriesId = useMemo(() => {
    try { return seriesIdParam ? BigInt(seriesIdParam) : undefined; } catch { return undefined; }
  }, [seriesIdParam]);

  // Wrapper & balances
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
  } = useOptionWrapper(seriesId);

  // Taker token dropdown
  const defaultTaker = QUOTE_TOKENS.find(q => q.symbol === "USDC")?.symbol ?? QUOTE_TOKENS[0]?.symbol;
  const [takerSym, setTakerSym] = useState<string | undefined>(defaultTaker);
  const takerToken: TokenMeta | undefined = useMemo(
    () => QUOTE_TOKENS.find(t => t.symbol === takerSym),
    [takerSym]
  );

  // Inputs
  const [wrapQty, setWrapQty] = useState<string>("");
  const [makingAmount, setMakingAmount] = useState<string>("");
  const [takingAmount, setTakingAmount] = useState<string>("");

  // State
  const [submitting, setSubmitting] = useState(false);
  const [orderHash, setOrderHash] = useState<`0x${string}` | null>(null);
  const [openOrders, setOpenOrders] = useState<any[]>([]);

  // Ensure ERC-20 exists (client-only)
  useEffect(() => {
    (async () => {
      if (!mounted) return;
      if (!seriesId) return;
      if (erc20Address && erc20Address !== "0x0000000000000000000000000000000000000000") return;
      try {
        await ensureSeriesERC20(
          `WrappedCall-${seriesId}`,
          `wCALL-${seriesId.toString().slice(0, 6)}`
        );
      } catch {/* ok if exists */}
    })();
  }, [mounted, seriesId, erc20Address, ensureSeriesERC20]);

  // Allowance
  const { approve, hasEnough, isApproving, refetchAllowance } = useTokenAllowance(
    (erc20Address as Address | undefined),
    LOP_V4_GNOSIS,
  );
  const { signTypedDataAsync } = useSignTypedData();

  // Displays
  const makerBalanceOptions = useMemo(() => {
    const dec = makerDecimals20 ?? 18;
    const human = formatUnits((makerBalance20 ?? 0n), dec);
    const n = Number(human);
    return fmt(n);
  }, [makerBalance20, makerDecimals20]);

  const impliedPrice = useMemo(() => {
    if (!makingAmount || !takingAmount || !takerToken) return "";
    const m = Number(makingAmount), t = Number(takingAmount);
    if (!Number.isFinite(m) || !Number.isFinite(t) || m <= 0) return "";
    return String(t / m);
  }, [makingAmount, takingAmount, takerToken]);

  // Actions
  const doWrap = async () => {
    if (!seriesId) return alert("No seriesId");
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
    return true;
  }, [address, erc20Address, takerToken, makingAmount, takingAmount]);

  const handleSubmit = async () => {
    if (!address || !erc20Address || !takerToken) return;

    const making = parseUnits(makingAmount, (makerDecimals20 ?? 18));
    const taking = parseUnits(takingAmount, takerToken.decimals);

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
        expirationSec: 2 * 60 * 60,
      });

      const sig = await signTypedDataAsync({
        domain: typedData.domain as any,
        types: typedData.types as any,
        primaryType: "Order",
        message: typedData.message as any,
      });

      const hash = await submitSignedOrder(order, sig as `0x${string}`);
      setOrderHash(hash);

      const orders = await fetchOrdersByMaker(address);
      setOpenOrders(orders.items ?? orders);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Order submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-lg font-medium mb-4">Create 1inch Limit Order</h3>

      {/* Row 1: Series + Wrap */}
      <div className="rounded-2xl border border-default-200/50 bg-content1 p-4 mb-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 md:col-span-3">
            <label className="block mb-1 text-sm font-medium">
              SeriesId <Info tip="Series you’re selling (from Series table/URL)." />
            </label>
            <Input
              isReadOnly
              value={mounted ? (seriesId?.toString() ?? "") : ""}
              placeholder="No series selected"
              classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
            />
          </div>

          <div className="col-span-6 md:col-span-2">
            <label className="block mb-1 text-sm font-medium">
              1155 Balance (options) <Info tip="Unwrapped ERC-1155 options for this series." />
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
            <Button onPress={doWrap} isDisabled={!mounted || !seriesId} className="h-12">
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
                Maker Token (ERC20) <Info tip="The ERC-20 you’ll sell (wrapped options)." />
              </label>
              <Input
                isReadOnly
                value={mounted ? (erc20Address ?? "") : ""}
                classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
              />
            </div>
            <div className="col-span-12 md:col-span-5">
              <label className="block mb-1 text-sm font-medium">
                Making Amount <Info tip="How many maker ERC-20 units to sell. (1 option = 1e18 units)" />
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
                {QUOTE_TOKENS.map(t => (
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

      <div className="mt-3 text-default-500 text-sm">
        {(() => {
          const m = Number(makingAmount || "0");
          const t = Number(takingAmount || "0");
          const ok = Number.isFinite(m) && Number.isFinite(t) && m > 0;
          const implied = ok ? t / m : 0;
          return ok
            ? <>Implied price: <span className="font-mono">{implied.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span> {takerToken?.symbol} per maker-unit</>
            : <>Enter amounts to see implied price.</>;
        })()}
      </div>

      <Spacer y={3} />

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
          onPress={async () => { await approve(); await refetchAllowance(); }}
        >
          Approve 1inch (maker)
        </Button>
      </div>

      {orderHash && (
        <div className="mt-5 space-y-2">
          <div className="text-sm text-default-500">Order Hash</div>
          <Snippet variant="flat" className="max-w-full break-all">{orderHash}</Snippet>
        </div>
      )}

      {openOrders?.length > 0 && (
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
      )}
    </Card>
  );
}