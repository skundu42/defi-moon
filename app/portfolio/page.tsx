// app/portfolio/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWatchContractEvent } from "wagmi";
import { Card } from "@heroui/card";
import { formatUnits, parseAbiItem } from "viem";
import { Input } from "@heroui/input";

import { useOrderbookOrders } from "@/hooks/useOrderbookOrders";
import { ALL_TOKENS, getTokenBySymbol } from "@/lib/token";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";

/* ------------------------------ Constants ------------------------------ */

// Reporting quote token: WXDAI (18)
const WXDAI = ALL_TOKENS.find((t) => t.symbol === "WXDAI")!;
const WXDAI_ADDR = WXDAI.address.toLowerCase();
const ONE = 10n ** 18n;

// Assume vault underlying is GNO (18). If you generalize, pull from series[id].underlyingDecimals per id.
const UNDERLYING = getTokenBySymbol("GNO");

/* ------------------------------ Event ABIs ------------------------------ */

// event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry);
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

// event ReclaimCalculated(address indexed maker, uint256 indexed id, uint256 makerLockedBefore, uint256 exerciseShare, uint256 reclaimed, uint256 totalLockedBySeriesAfter);
const RECLAIM_CALC = parseAbiItem(
  "event ReclaimCalculated(address indexed maker, uint256 indexed id, uint256 makerLockedBefore, uint256 exerciseShare, uint256 reclaimed, uint256 totalLockedBySeriesAfter)"
);

/* ------------------------------ Helpers ------------------------------ */

function fmt(bi: bigint, decimals = 18, max = 6) {
  const n = Number(formatUnits(bi, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

function wxQuote(underlyingAmount: bigint, priceWx18: bigint) {
  // priceWx18 = WXDAI per 1 underlying (1e18)
  return (underlyingAmount * priceWx18) / ONE;
}

/* ------------------------------ Page ------------------------------ */

type SeriesMeta = { id: bigint; expiry: bigint };
type PendingRow = {
  id: bigint;
  settlePrice: bigint;          // WXDAI 1e18
  pendingUnderlying: bigint;    // GNO 1e18
  pendingWXDAI: bigint;         // WXDAI 1e18
};

export default function PortfolioPage() {
  const { address } = useAccount();
  const client = usePublicClient();

  /* ---------------- Balances (My Vault) ---------------- */

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

  /* ---------------- Premiums (1inch) ---------------- */

  const { orders, loading: ordersLoading, error: ordersError } = useOrderbookOrders(
    address as `0x${string}`
  );

  // Sum filled premiums in WXDAI only (to avoid cross-asset conversion here)
  const premiumsWX = useMemo(() => {
    if (!orders || !address) return 0n;
    let acc = 0n;
    for (const o of orders) {
      const tAsset = (o.takerAsset ?? "").toLowerCase();
      // prefer filled amounts if present, else fall back to full order amounts
      const tFilled = o.filledTakingAmount ?? o.takingAmount ?? "0";
      if (tAsset === WXDAI_ADDR) {
        try {
          const amt = BigInt(tFilled);
          acc += amt;
        } catch {}
      }
    }
    return acc;
  }, [orders, address]);

  /* ---------------- Series discovery (for pending exercise calc) ---------------- */

  const [series, setSeries] = useState<SeriesMeta[]>([]);
  const [fromBlockOverride, setFromBlockOverride] = useState<string>("");
  const [latestBlock, setLatestBlock] = useState<bigint>(0n);
  const bootRef = useRef(false);

  const ENV_DEPLOY_BLOCK = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK
    ? BigInt(process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK!)
    : undefined;

  // Backfill recent SeriesDefined to build an id list
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

        // Unique by id
        const map = new Map<string, SeriesMeta>();
        for (const l of logs) {
          const id = l.args.id as bigint;
          const expiry = l.args.expiry as bigint;
          map.set(id.toString(), { id, expiry });
        }
        setSeries(Array.from(map.values()).sort((a, b) => Number(b.expiry - a.expiry)));
      } catch (e) {
        console.warn("Series scan failed:", e);
        setSeries([]);
      }
    })();
  }, [client, fromBlockOverride]);

  // Live updates
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

  /* ---------------- Pending exercise (settled & you still have locks) ---------------- */

  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);
  useEffect(() => {
    if (!client || !address || series.length === 0) {
      setPendingRows([]);
      return;
    }

    (async () => {
      try {
        const out: PendingRow[] = [];

        // We’ll loop (keeps types simple & reliable across providers)
        for (const s of series) {
          // read settled + lockedPerSeries + settlePrice
          const settled = (await client.readContract({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            functionName: "series",
            args: [s.id],
          })) as any;

          const isSettled = Boolean(settled?.[6]); // Series.settled
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

  /* ---------------- Realized exercise (sum ReclaimCalculated for maker) ---------------- */

  const [realizedWX, setRealizedWX] = useState<bigint>(0n);
  const realizedBoot = useRef(false);

  useEffect(() => {
    if (!client || !address || realizedBoot.current) return;
    realizedBoot.current = true;

    (async () => {
      try {
        const latest = await client.getBlockNumber();
        const DEFAULT_SPAN = 400_000n; // a bit wider since reclaims may happen later than define
        const fromBlock =
          ENV_DEPLOY_BLOCK !== undefined
            ? ENV_DEPLOY_BLOCK
            : latest > DEFAULT_SPAN
            ? latest - DEFAULT_SPAN
            : 0n;

        // Filter by maker (indexed).
        const logs = await client.getLogs({
          address: VAULT_ADDRESS,
          event: RECLAIM_CALC,
          args: { maker: address as `0x${string}` },
          fromBlock,
          toBlock: latest,
        });

        // Need settlePrice(id) for each unique id
        const uniqIds = Array.from(new Set(logs.map((l) => (l.args?.id as bigint).toString()))).map(
          (s) => BigInt(s)
        );
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
          const share = l.args?.exerciseShare as bigint; // in underlying
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

  // Live add for realized when you reclaim again during session
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "ReclaimCalculated",
    args: { maker: (address ?? undefined) as any },
    onLogs: async (logs) => {
      if (!client || !address || logs.length === 0) return;
      // Fetch settle prices for the ids in these logs
      const ids = Array.from(new Set(logs.map((l) => (l.args?.id as bigint).toString()))).map(
        (s) => BigInt(s)
      );

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

  /* ---------------- Net PnL (realized) ---------------- */

  const netRealizedWX = useMemo(() => {
    // Realized PnL = premiums (WXDAI only) - realized exercise (WXDAI)
    const net = premiumsWX - realizedWX;
    return net;
  }, [premiumsWX, realizedWX]);

  /* ---------------- Render ---------------- */

  return (
    <section className="mx-auto max-w-5xl py-8 md:py-12 space-y-6">
      <h1 className="text-2xl font-semibold">Portfolio</h1>

      {!address ? (
        <Card className="p-5">Connect your wallet to view your portfolio.</Card>
      ) : (
        <>
          {/* Balances */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          </div>

          {/* PnL header metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div className="text-xs text-default-500 mt-1">
                (Counts fills where takerAsset is WXDAI.)
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm text-default-500">Realized exercise (sum, WXDAI)</div>
              <div className="text-2xl font-semibold">{fmt(realizedWX, 18, 4)} {WXDAI.symbol}</div>
              <div className="text-xs text-default-500 mt-1">
                From on-chain <code>ReclaimCalculated</code> events × settle price.
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm text-default-500">Net PnL (realized)</div>
              <div
                className={`text-2xl font-semibold ${
                  netRealizedWX >= 0n ? "text-success" : "text-danger"
                }`}
              >
                {fmt(netRealizedWX, 18, 4)} {WXDAI.symbol}
              </div>
            </Card>
          </div>

          {/* Pending exercise (if any settled series where you still have locks) */}
          <Card className="p-0 overflow-x-auto">
            <div className="flex items-center gap-3 p-3">
              <div className="text-sm font-medium">Pending exercise (settled but not reclaimed)</div>
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
                      <td className="p-3">{fmt(r.pendingUnderlying, 18, 6)} {UNDERLYING.symbol}</td>
                      <td className="p-3">{fmt(r.pendingWXDAI, 18, 6)} {WXDAI.symbol}</td>
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

          {/* Optional: from-block override for series scan */}
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