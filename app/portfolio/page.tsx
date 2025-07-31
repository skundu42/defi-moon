"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
} from "wagmi";
import { Card } from "@heroui/card";
import { formatUnits, parseAbiItem } from "viem";
import { Input } from "@heroui/input";

import { useOrderbookOrders } from "../../hooks/useOrderbookOrders";
import { ALL_TOKENS, getTokenBySymbol } from "@/lib/token";
import {
  VAULT_ADDRESS,
  vaultAbi,
} from "@/lib/contracts";

/* ------------------------------ Constants ------------------------------ */
const WXDAI = ALL_TOKENS.find((t) => t.symbol === "WXDAI")!;
const WXDAI_ADDR = WXDAI.address.toLowerCase();
const ONE = 10n ** 18n;

const UNDERLYING = getTokenBySymbol("GNO");

/* ------------------------------ Event ABIs ------------------------------ */
// SeriesDefined
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);
// Minted (when a maker mints options)
const MINTED = parseAbiItem(
  "event Minted(address indexed maker, uint256 indexed id, uint256 qty, uint256 collateralLocked)"
);
// ReclaimCalculated
const RECLAIM_CALC = parseAbiItem(
  "event ReclaimCalculated(address indexed maker, uint256 indexed id, uint256 makerLockedBefore, uint256 exerciseShare, uint256 reclaimed, uint256 totalLockedBySeriesAfter)"
);

/* ------------------------------ Helpers ------------------------------ */
function fmt(bi: bigint, decimals = 18, max = 6) {
  const n = Number(formatUnits(bi, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

// price quote: underlyingAmount * price (WXDAI per underlying)
function wxQuote(underlyingAmount: bigint, priceWx18: bigint) {
  return (underlyingAmount * priceWx18) / ONE;
}

/* ------------------------------ Types ------------------------------ */
type SeriesMeta = {
  id: bigint;
  expiry: bigint;
  strike?: bigint;
  underlying?: string;
};

type PendingRow = {
  id: bigint;
  settlePrice: bigint; // WXDAI 1e18
  pendingUnderlying: bigint; // GNO 1e18
  pendingWXDAI: bigint; // WXDAI 1e18
};

type MintedPosition = {
  seriesId: bigint;
  qty: bigint; // how many options minted (sold)
  collateralLocked: bigint;
  expiry: bigint;
  strike: bigint;
};

type BoughtPosition = {
  seriesId: bigint;
  quantity: bigint; // options purchased
  spentWXDAI: bigint; // cost in WXDAI (takerAsset is WXDAI)
  expiry: bigint;
  strike: bigint;
};

/* ------------------------------ Page ------------------------------ */
export default function PortfolioPage() {
  const { address } = useAccount();
  const client = usePublicClient();

  /* ---------------- On-chain series discovery ---------------- */
  const [series, setSeries] = useState<SeriesMeta[]>([]);
  const [fromBlockOverride, setFromBlockOverride] = useState<string>("");
  const [latestBlock, setLatestBlock] = useState<bigint>(0n);
  const bootRef = useRef(false);
  const ENV_DEPLOY_BLOCK = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK
    ? BigInt(process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK!)
    : undefined;

  useEffect(() => {
    if (!client || bootRef.current) return;
    bootRef.current = true;

    (async () => {
      try {
        const latest = await client.getBlockNumber();
        setLatestBlock(latest);

        const override = fromBlockOverride.trim();
        const hasOverride = override.length > 0 && /^\d+$/.test(override);
        const DEFAULT_SPAN = 200_000n;

        const fromBlock = hasOverride
          ? BigInt(override)
          : ENV_DEPLOY_BLOCK !== undefined
          ? ENV_DEPLOY_BLOCK
          : latest > DEFAULT_SPAN
          ? latest - DEFAULT_SPAN
          : 0n;

        const logs = await client.getLogs({
          address: VAULT_ADDRESS,
          event: SERIES_DEFINED,
          fromBlock,
          toBlock: latest,
        });

        const map = new Map<string, SeriesMeta>();
        for (const l of logs) {
          const id = l.args.id as bigint;
          const expiry = l.args.expiry as bigint;
          map.set(id.toString(), { id, expiry });
        }
        setSeries(
          Array.from(map.values()).sort((a, b) => Number(b.expiry - a.expiry))
        );
      } catch (e) {
        console.warn("Series scan failed:", e);
        setSeries([]);
      }
    })();
  }, [client, fromBlockOverride, ENV_DEPLOY_BLOCK]);

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setSeries((prev) => {
        const map = new Map<string, SeriesMeta>();
        for (const s of prev) map.set(s.id.toString(), s);
        for (const l of logs) {
          const id = l.args?.id as bigint;
          const expiry = l.args?.expiry as bigint;
          map.set(id.toString(), { id, expiry });
        }
        return Array.from(map.values()).sort((a, b) => Number(b.expiry - a.expiry));
      });
    },
  });

  /* ---------------- On-chain balances for vault maker (you minted) ---------------- */
  const { data: collateral = 0n } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "collateralBalance",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`)],
    query: { enabled: Boolean(address) },
  });
  const { data: totalLocked = 0n } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "totalLocked",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`)],
    query: { enabled: Boolean(address) },
  });
  const { data: free = 0n } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "freeCollateralOf",
    args: [((address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`)],
    query: { enabled: Boolean(address) },
  });

  /* ---------------- Local orderbook (premiums & bought options) ---------------- */
  const { orders, loading: ordersLoading, error: ordersError } = useOrderbookOrders(
    address as `0x${string}`
  );

  // Premiums received in WXDAI (filled orders where takerAsset is WXDAI)
  const premiumsWX = useMemo(() => {
    if (!orders || !address) return 0n;
    let acc = 0n;
    for (const o of orders) {
      const tAsset = (o.takerAsset ?? "").toLowerCase();
      if (o.filled) {
        const tFilled = o.filledTakingAmount ?? o.takingAmount ?? "0";
        if (tAsset === WXDAI_ADDR) {
          try {
            acc += BigInt(tFilled);
          } catch {}
        }
      }
    }
    return acc;
  }, [orders, address]);

  // Bought options: aggregate fills where you were the taker (i.e., you purchased call options)
  const boughtOptions = useMemo<BoughtPosition[]>(() => {
    if (!orders || !address) return [];
    const map = new Map<string, BoughtPosition>(); // seriesId -> aggregated
    for (const o of orders) {
      if (!o.filled) continue;
      const extension = o.extension || "0x";
      // extract seriesId from ERC-1155 extension
      let seriesId = 0n;
      if (extension.length >= 66) {
        try {
          seriesId = BigInt("0x" + extension.slice(2, 66));
        } catch {}
      }
      const takerAsset = (o.takerAsset ?? "").toLowerCase();
      if (takerAsset !== WXDAI_ADDR) continue; // only cost in WXDAI accounted here

      const qty = BigInt(o.filledTakingAmount ? o.filledTakingAmount : "0"); // this is payment; for call options amount is makingAmount
      const optionsBought = BigInt(o.makingAmount);
      const key = seriesId.toString();
      const existing = map.get(key);
      if (existing) {
        existing.quantity += optionsBought;
        existing.spentWXDAI += qty;
      } else {
        // We need strike & expiry: placeholder until we enrich later
        map.set(key, {
          seriesId,
          quantity: optionsBought,
          spentWXDAI: qty,
          expiry: 0n,
          strike: 0n,
        });
      }
    }
    return Array.from(map.values());
  }, [orders]);

  /* ---------------- Pending exercise (settled but not reclaimed) ---------------- */
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);
  useEffect(() => {
    if (!client || !address || series.length === 0) {
      setPendingRows([]);
      return;
    }

    (async () => {
      try {
        const out: PendingRow[] = [];
        for (const s of series) {
          const seriesData = (await client.readContract({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "series",
            args: [s.id],
          })) as any;

          const isSettled = Boolean(seriesData?.[6]); // settled flag
          if (!isSettled) continue;

          const lockedForYou = (await client.readContract({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "lockedPerSeries",
            args: [address as `0x${string}`, s.id],
          })) as bigint;
          if (lockedForYou === 0n) continue;

          const shareUnderlying = (await client.readContract({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "exerciseShareOf",
            args: [address as `0x${string}`, s.id],
          })) as bigint;
          if (shareUnderlying === 0n) continue;

          const settlePx = (await client.readContract({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "settlePrice",
            args: [s.id],
          })) as bigint;

          const shareWx = wxQuote(shareUnderlying, settlePx);

          out.push({
            id: s.id,
            settlePrice: settlePx,
            pendingUnderlying: shareUnderlying,
            pendingWXDAI: shareWx,
          });
        }
        setPendingRows(out);
      } catch (e) {
        console.warn("Pending calc failed:", e);
        setPendingRows([]);
      }
    })();
  }, [client, address, series]);

  const pendingTotalWX = useMemo(
    () => pendingRows.reduce((a, r) => a + r.pendingWXDAI, 0n),
    [pendingRows]
  );

  /* ---------------- Realized exercise (from reclaim events) ---------------- */
  const [realizedWX, setRealizedWX] = useState<bigint>(0n);
  const realizedBoot = useRef(false);

  useEffect(() => {
    if (!client || !address || realizedBoot.current) return;
    realizedBoot.current = true;

    (async () => {
      try {
        const latest = await client.getBlockNumber();
        const DEFAULT_SPAN = 400_000n;
        const fromBlock =
          ENV_DEPLOY_BLOCK !== undefined
            ? ENV_DEPLOY_BLOCK
            : latest > DEFAULT_SPAN
            ? latest - DEFAULT_SPAN
            : 0n;

        const logs = await client.getLogs({
          address: VAULT_ADDRESS,
          event: RECLAIM_CALC,
          args: { maker: address as `0x${string}` },
          fromBlock,
          toBlock: latest,
        });

        const uniqIds = Array.from(
          new Set(logs.map((l) => (l.args?.id as bigint).toString()))
        ).map((s) => BigInt(s));
        const pxById = new Map<string, bigint>();
        for (const id of uniqIds) {
          const px = (await client.readContract({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "settlePrice",
            args: [id],
          })) as bigint;
          pxById.set(id.toString(), px);
        }

        let acc = 0n;
        for (const l of logs) {
          const id = l.args?.id as bigint;
          const share = l.args?.exerciseShare as bigint; // underlying
          if (share && share > 0n) {
            const px = pxById.get(id.toString()) ?? 0n;
            acc += wxQuote(share, px);
          }
        }

        setRealizedWX(acc);
      } catch (e) {
        console.warn("Realized calc failed:", e);
        setRealizedWX(0n);
      }
    })();
  }, [client, address, ENV_DEPLOY_BLOCK]);

  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "ReclaimCalculated",
    args: { maker: (address ?? undefined) as any },
    onLogs: async (logs) => {
      if (!client || !address || logs.length === 0) return;
      const ids = Array.from(
        new Set(logs.map((l) => (l.args?.id as bigint).toString()))
      ).map((s) => BigInt(s));

      const pxById = new Map<string, bigint>();
      for (const id of ids) {
        const px = (await client.readContract({
          address: VAULT_ADDRESS,
          abi: vaultAbi,
          functionName: "settlePrice",
          args: [id],
        })) as bigint;
        pxById.set(id.toString(), px);
      }

      let add = 0n;
      for (const l of logs) {
        const id = l.args?.id as bigint;
        const share = l.args?.exerciseShare as bigint;
        if (share && share > 0n) {
          const px = pxById.get(id.toString()) ?? 0n;
          add += wxQuote(share, px);
        }
      }
      setRealizedWX((x) => x + add);
    },
  });

  /* ---------------- Minted (sold) options via on-chain events ---------------- */
  const [mintedPositions, setMintedPositions] = useState<MintedPosition[]>([]);
  const mintedBoot = useRef(false);
  useEffect(() => {
    if (!client || !address || mintedBoot.current) return;
    mintedBoot.current = true;

    (async () => {
      try {
        const latest = await client.getBlockNumber();
        const DEFAULT_SPAN = 400_000n;
        const fromBlock =
          ENV_DEPLOY_BLOCK !== undefined
            ? ENV_DEPLOY_BLOCK
            : latest > DEFAULT_SPAN
            ? latest - DEFAULT_SPAN
            : 0n;

        const logs = await client.getLogs({
          address: VAULT_ADDRESS,
          event: MINTED,
          args: { maker: address as `0x${string}` },
          fromBlock,
          toBlock: latest,
        });

        // build per-series aggregation
        const map = new Map<string, MintedPosition>();
        for (const l of logs) {
          const id = l.args?.id as bigint;
          const qty = l.args?.qty as bigint;
          const collateralLocked = l.args?.collateralLocked as bigint;

          // fetch series detail (strike & expiry) once per unique
          if (!map.has(id.toString())) {
            const seriesData = (await client.readContract({
              address: VAULT_ADDRESS,
              abi: vaultAbi,
              functionName: "series",
              args: [id],
            })) as any;
            const strike = seriesData?.[2] as bigint; // strike
            const expiry = seriesData?.[3] as bigint; // expiry field positions may vary; adjust if needed
            map.set(id.toString(), {
              seriesId: id,
              qty,
              collateralLocked,
              expiry: expiry ?? 0n,
              strike: strike ?? 0n,
            });
          } else {
            const existing = map.get(id.toString())!;
            existing.qty += qty;
            existing.collateralLocked += collateralLocked;
          }
        }

        setMintedPositions(Array.from(map.values()));
      } catch (e) {
        console.warn("Minted scan failed:", e);
        setMintedPositions([]);
      }
    })();
  }, [client, address, ENV_DEPLOY_BLOCK]);

  /* ---------------- Enrich bought options with strike/expiry from on-chain series ---------------- */
  const enrichedBought = useMemo<BoughtPosition[]>(() => {
    return boughtOptions.map((b) => {
      const matching = series.find((s) => s.id.toString() === b.seriesId.toString());
      // fetch strike/expiry on-the-fly if available (could cache for performance)
      return {
        ...b,
        expiry: matching?.expiry ?? 0n,
        strike: 0n, // if you have a way to read strike, you can add similar readContract here or preload series detail
      };
    });
  }, [boughtOptions, series]);

  /* ---------------- Net Realized PnL (maker) ---------------- */
  const netRealizedWX = useMemo(() => {
    // Premiums received (WXDAI) minus realized exercise payoff (WXDAI)
    return premiumsWX - realizedWX;
  }, [premiumsWX, realizedWX]);

  /* ---------------- Total exposure summary ---------------- */
  const totalMintedOptions = useMemo(
    () => mintedPositions.reduce((acc, p) => acc + p.qty, 0n),
    [mintedPositions]
  );
  const totalBoughtOptions = useMemo(
    () => enrichedBought.reduce((acc, b) => acc + b.quantity, 0n),
    [enrichedBought]
  );

  /* ---------------- Render ------------------------------ */
  return (
    <section className="mx-auto max-w-6xl py-8 space-y-6">
      <h1 className="text-2xl font-semibold">Portfolio</h1>

      {!address ? (
        <Card className="p-5">Connect your wallet to view your portfolio.</Card>
      ) : (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-sm text-default-500">Collateral balance</div>
              <div className="text-2xl font-semibold">
                {fmt(collateral as bigint, UNDERLYING.decimals)} {UNDERLYING.symbol}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-default-500">Total locked</div>
              <div className="text-2xl font-semibold">
                {fmt(totalLocked as bigint, UNDERLYING.decimals)} {UNDERLYING.symbol}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-default-500">Free collateral</div>
              <div className="text-2xl font-semibold">
                {fmt(free as bigint, UNDERLYING.decimals)} {UNDERLYING.symbol}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-default-500">Premiums received (WXDAI)</div>
              <div className="text-2xl font-semibold">
                {fmt(premiumsWX, 18, 4)} {WXDAI.symbol}
              </div>
              {ordersLoading && (
                <div className="text-xs text-default-500 mt-1">Fetching orders…</div>
              )}
              {ordersError && (
                <div className="text-xs text-warning mt-1">Orderbook: {ordersError}</div>
              )}
            </Card>
          </div>

          {/* PnL / exercise */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-sm text-default-500">Realized exercise (WXDAI)</div>
              <div className="text-2xl font-semibold">{fmt(realizedWX, 18, 4)} {WXDAI.symbol}</div>
              <div className="text-xs text-default-500 mt-1">
                From on-chain reclaim events × settle price.
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-default-500">Pending exercise (WXDAI)</div>
              <div className="text-2xl font-semibold">
                {fmt(pendingTotalWX, 18, 4)} {WXDAI.symbol}
              </div>
              <div className="text-xs text-default-500 mt-1">
                Settled but not yet reclaimed.
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-default-500">Net Realized PnL (WXDAI)</div>
              <div
                className={`text-2xl font-semibold ${
                  netRealizedWX >= 0n ? "text-success" : "text-danger"
                }`}
              >
                {fmt(netRealizedWX, 18, 4)} {WXDAI.symbol}
              </div>
            </Card>
          </div>

          {/* Positions: Minted (sold) options */}
          <Card className="p-4">
            <div className="flex justify-between items-center mb-2">
              <div className="text-lg font-medium">Minted Call Options (as Maker)</div>
              <div className="text-sm text-default-500">
                Total minted: <span className="font-semibold">{fmt(totalMintedOptions, 0)}</span>
              </div>
            </div>
            {mintedPositions.length === 0 ? (
              <div className="text-sm text-default-500">No minted (sold) call options found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-default-500">
                      <th className="p-2 text-left">Series ID</th>
                      <th className="p-2 text-left">Qty Minted</th>
                      <th className="p-2 text-left">Strike</th>
                      <th className="p-2 text-left">Expiry</th>
                      <th className="p-2 text-left">Collateral Locked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mintedPositions.map((p) => (
                      <tr key={p.seriesId.toString()} className="border-t">
                        <td className="p-2 font-mono">{p.seriesId.toString()}</td>
                        <td className="p-2">{fmt(p.qty, 0)}</td>
                        <td className="p-2">{fmt(p.strike, 18)}</td>
                        <td className="p-2">
                          {p.expiry > 0n
                            ? new Date(Number(p.expiry) * 1000).toISOString().split("T")[0]
                            : "-"}
                        </td>
                        <td className="p-2">
                          {fmt(p.collateralLocked, UNDERLYING.decimals)} {UNDERLYING.symbol}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Positions: Bought call options */}
          <Card className="p-4">
            <div className="flex justify-between items-center mb-2">
              <div className="text-lg font-medium">Bought Call Options (as Taker)</div>
              <div className="text-sm text-default-500">
                Total bought: <span className="font-semibold">{fmt(totalBoughtOptions, 0)}</span>
              </div>
            </div>
            {enrichedBought.length === 0 ? (
              <div className="text-sm text-default-500">
                No bought call options detected (fills).
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-default-500">
                      <th className="p-2 text-left">Series ID</th>
                      <th className="p-2 text-left">Qty Bought</th>
                      <th className="p-2 text-left">Spent (WXDAI)</th>
                      <th className="p-2 text-left">Avg Price per Option</th>
                      <th className="p-2 text-left">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrichedBought.map((b) => {
                      const avgPrice = b.quantity === 0n ? 0n : (b.spentWXDAI * ONE) / b.quantity;
                      return (
                        <tr key={b.seriesId.toString()} className="border-t">
                          <td className="p-2 font-mono">{b.seriesId.toString()}</td>
                          <td className="p-2">{fmt(b.quantity, 0)}</td>
                          <td className="p-2">
                            {fmt(b.spentWXDAI, 18)} {WXDAI.symbol}
                          </td>
                          <td className="p-2">
                            {avgPrice > 0n
                              ? fmt(avgPrice, 18) + ` ${WXDAI.symbol}`
                              : "-"}
                          </td>
                          <td className="p-2">
                            {b.expiry > 0n
                              ? new Date(Number(b.expiry) * 1000).toISOString().split("T")[0]
                              : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Pending exercise breakdown */}
          <Card className="p-0 overflow-x-auto">
            <div className="flex items-center gap-3 p-3">
              <div className="text-sm font-medium">
                Pending Exercise (settled but not reclaimed)
              </div>
              <div className="ml-auto text-xs text-default-500">
                Vault: <span className="font-mono">{String(VAULT_ADDRESS)}</span> • Latest block:{" "}
                <span className="font-mono">{latestBlock.toString()}</span>
              </div>
            </div>
            <table className="min-w-full text-sm">
              <thead className="text-default-500">
                <tr>
                  <th className="text-left p-3">SeriesId</th>
                  <th className="text-left p-3">Settle Px (WXDAI)</th>
                  <th className="text-left p-3">Pending (Underlying)</th>
                  <th className="text-left p-3">Pending (WXDAI)</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.length === 0 ? (
                  <tr>
                    <td className="p-3" colSpan={4}>
                      No pending exercise.
                    </td>
                  </tr>
                ) : (
                  pendingRows.map((r) => (
                    <tr key={r.id.toString()} className="border-t border-default-200/50">
                      <td className="p-3 font-mono">{r.id.toString()}</td>
                      <td className="p-3">{fmt(r.settlePrice, 18, 6)}</td>
                      <td className="p-3">
                        {fmt(r.pendingUnderlying, 18, 6)} {UNDERLYING.symbol}
                      </td>
                      <td className="p-3">
                        {fmt(r.pendingWXDAI, 18, 6)} {WXDAI.symbol}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {pendingRows.length > 0 && (
              <div className="p-3 text-sm">
                <span className="text-default-500 mr-2">Total pending:</span>
                <span className="font-semibold">
                  {fmt(pendingTotalWX, 18, 6)} {WXDAI.symbol}
                </span>
              </div>
            )}
          </Card>

          {/* Series scan override input */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-default-500">From block (series scan):</span>
            <Input
              type="number"
              size="sm"
              placeholder={
                process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK ?? "auto (last ~200k)"
              }
              value={fromBlockOverride}
              onChange={(e) => setFromBlockOverride(e.target.value)}
              classNames={{ inputWrapper: "h-9 bg-default-100", input: "text-sm" }}
            />
          </div>
        </>
      )}
    </section>
  );
}