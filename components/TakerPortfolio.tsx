// components/TakerPortfolio.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
} from "wagmi";
import {
  Address as ViemAddress,
  formatUnits,
  parseAbiItem,
} from "viem";
import { Card } from "@heroui/card";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";
import { Spinner } from "@heroui/spinner";
import { Chip } from "@heroui/chip";
import { Progress } from "@heroui/progress";

import {
  VAULT_ADDRESS,
  CALLTOKEN_ADDRESS,
  vaultAbi,
  erc1155Abi,
} from "@/lib/contracts";

// Events
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

type SeriesData = {
  id: bigint;
  underlying: `0x${string}`;
  strike: bigint;
  expiry: bigint;
  settled?: boolean;
  settlePrice?: bigint;
};

type PortfolioPosition = {
  series: SeriesData;
  balance: bigint;
  isExpired: boolean;
  isSettled: boolean;
  settlePrice: bigint;
  intrinsicValue: bigint;
  profitLoss: string;
};

function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

function formatDateUTC(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

function formatStrike(strike: bigint): string {
  return formatUnits(strike, 18);
}

function calculateIntrinsicValue(settlePrice: bigint, strike: bigint): bigint {
  return settlePrice > strike ? settlePrice - strike : 0n;
}

function calculateMoneyness(settlePrice: bigint, strike: bigint): {
  status: "ITM" | "ATM" | "OTM";
  color: "success" | "warning" | "danger";
} {
  if (settlePrice > strike) {
    return { status: "ITM", color: "success" };
  } else if (settlePrice === strike) {
    return { status: "ATM", color: "warning" };
  } else {
    return { status: "OTM", color: "danger" };
  }
}

export default function TakerPortfolio() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  // Load all series
  const [allSeries, setAllSeries] = useState<SeriesData[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(true);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const bootRef = useRef(false);

  // Load series data from events
  useEffect(() => {
    if (!publicClient || bootRef.current) return;
    bootRef.current = true;
    
    (async () => {
      setLoadingSeries(true);
      try {
        const latest = await publicClient.getBlockNumber();
        const span = 200_000n;
        const from = latest > span ? latest - span : 0n;
        const step = 20_000n;
        const acc: SeriesData[] = [];
        
        for (let b = from; b <= latest; b += step + 1n) {
          const to = b + step > latest ? latest : b + step;
          const logs = await publicClient.getLogs({
            address: VAULT_ADDRESS,
            abi: vaultAbi,
            event: SERIES_DEFINED,
            fromBlock: b,
            toBlock: to,
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
        
        const dedup = new Map<string, SeriesData>();
        acc.forEach((r) => dedup.set(r.id.toString(), r));
        setAllSeries(Array.from(dedup.values()));
      } catch (err) {
        console.error("Failed to load series:", err);
      } finally {
        setLoadingSeries(false);
      }
    })();
  }, [publicClient]);

  // Watch for new series
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setAllSeries((prev) => {
        const m = new Map(prev.map((r) => [r.id.toString(), r]));
        for (const l of logs) {
          m.set((l.args.id as bigint).toString(), {
            id: l.args.id as bigint,
            underlying: l.args.underlying as `0x${string}`,
            strike: l.args.strike as bigint,
            expiry: l.args.expiry as bigint,
          });
        }
        return Array.from(m.values());
      });
    },
  });

  // Load portfolio positions
  useEffect(() => {
    if (!address || !allSeries.length || loadingSeries) return;
    
    const loadPositions = async () => {
      setLoadingPositions(true);
      try {
        const positionsData: PortfolioPosition[] = [];
        const now = Math.floor(Date.now() / 1000);
        
        for (const series of allSeries) {
          // Get ERC1155 balance
          const balance = await publicClient.readContract({
            address: CALLTOKEN_ADDRESS as ViemAddress,
            abi: erc1155Abi,
            functionName: "balanceOf",
            args: [address as ViemAddress, series.id],
          }) as bigint;
          
          if (balance > 0n) {
            const isExpired = Number(series.expiry) <= now;
            
            // Get series settlement data
            let isSettled = false;
            let settlePrice = 0n;
            
            try {
              const seriesData = await publicClient.readContract({
                address: VAULT_ADDRESS,
                abi: vaultAbi,
                functionName: "series",
                args: [series.id],
              }) as any[];
              
              isSettled = Boolean(seriesData[6]);
            } catch {}
            
            if (isSettled) {
              try {
                settlePrice = await publicClient.readContract({
                  address: VAULT_ADDRESS,
                  abi: vaultAbi,
                  functionName: "settlePrice",
                  args: [series.id],
                }) as bigint;
              } catch {}
            }
            
            const intrinsicValue = isSettled 
              ? calculateIntrinsicValue(settlePrice, series.strike)
              : 0n;
            
            positionsData.push({
              series,
              balance,
              isExpired,
              isSettled,
              settlePrice,
              intrinsicValue,
              profitLoss: isSettled 
                ? intrinsicValue > 0n 
                  ? `+${formatUnits(intrinsicValue * balance, 18)} WXDAI`
                  : "0 WXDAI"
                : "N/A",
            });
          }
        }
        
        // Sort by expiry
        positionsData.sort((a, b) => Number(a.series.expiry - b.series.expiry));
        setPositions(positionsData);
      } catch (err) {
        console.error("Failed to load positions:", err);
      } finally {
        setLoadingPositions(false);
      }
    };
    
    loadPositions();
  }, [address, allSeries, loadingSeries, publicClient]);

  // Portfolio summary
  const portfolioSummary = useMemo(() => {
    const totalPositions = positions.length;
    const totalOptions = positions.reduce((sum, p) => sum + p.balance, 0n);
    const settledPositions = positions.filter(p => p.isSettled).length;
    const totalValue = positions.reduce((sum, p) => {
      return sum + (p.isSettled ? p.intrinsicValue * p.balance : 0n);
    }, 0n);
    
    return {
      totalPositions,
      totalOptions,
      settledPositions,
      totalValue,
    };
  }, [positions]);

  // Refresh positions on relevant events
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "Settled",
    onLogs: () => {
      // Refresh positions when series are settled
      if (address && allSeries.length) {
        setTimeout(() => {
          window.location.reload(); // Simple refresh for now
        }, 2000);
      }
    },
  });

  if (!isConnected) {
    return (
      <Card className="p-5">
        <div className="text-center py-8 text-default-500">
          Connect your wallet to view your portfolio
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Your Options Portfolio</h3>
        {(loadingSeries || loadingPositions) && <Spinner size="sm" />}
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Total Positions <Info tip="Number of different series you hold" />
          </div>
          <div className="text-2xl font-semibold">
            {portfolioSummary.totalPositions}
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Total Options <Info tip="Total number of option tokens" />
          </div>
          <div className="text-2xl font-semibold">
            {portfolioSummary.totalOptions.toString()}
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Settled Positions <Info tip="Positions ready for exercise" />
          </div>
          <div className="text-2xl font-semibold">
            {portfolioSummary.settledPositions}
          </div>
        </Card>
        
        <Card className="p-4">
          <div className="flex items-center gap-1 text-sm text-default-500">
            Intrinsic Value <Info tip="Total value if exercised now" />
          </div>
          <div className="text-2xl font-semibold">
            {formatUnits(portfolioSummary.totalValue, 18)} WXDAI
          </div>
        </Card>
      </div>

      {/* Positions List */}
      {loadingSeries || loadingPositions ? (
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <span>Loading positions...</span>
          </div>
        </div>
      ) : positions.length === 0 ? (
        <div className="text-center py-8 text-default-500">
          <div className="mb-2">No options positions found</div>
          <div className="text-sm">Purchase options from the Orderbook section to see them here</div>
        </div>
      ) : (
        <div className="space-y-4">
          <h4 className="font-medium">Your Positions</h4>
          {positions.map((position) => {
            const { series, balance, isExpired, isSettled, settlePrice, intrinsicValue } = position;
            const moneyness = isSettled ? calculateMoneyness(settlePrice, series.strike) : null;
            const timeToExpiry = Number(series.expiry) - Math.floor(Date.now() / 1000);
            const daysToExpiry = Math.max(0, Math.floor(timeToExpiry / 86400));
            
            return (
              <Card key={series.id.toString()} className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-semibold">
                        Series {series.id.toString()}
                      </span>
                      {isExpired && (
                        <Chip size="sm" color="warning" variant="flat">
                          Expired
                        </Chip>
                      )}
                      {isSettled && moneyness && (
                        <Chip size="sm" color={moneyness.color} variant="flat">
                          {moneyness.status}
                        </Chip>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="text-default-500">Position Size</div>
                        <div className="font-semibold text-lg">
                          {balance.toString()} options
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-default-500">Strike Price</div>
                        <div className="font-medium">
                          {formatStrike(series.strike)} WXDAI
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-default-500">Expiry</div>
                        <div className="font-medium">
                          {formatDateUTC(series.expiry)}
                        </div>
                        <div className="text-xs text-default-400">
                          {isExpired ? "Expired" : `${daysToExpiry} days left`}
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-default-500">Settlement</div>
                        <div className="font-medium">
                          {isSettled 
                            ? `${formatUnits(settlePrice, 18)} WXDAI`
                            : "Not settled"
                          }
                        </div>
                      </div>
                      
                      <div>
                        <div className="text-default-500">Intrinsic Value</div>
                        <div className={`font-medium ${
                          intrinsicValue > 0n ? "text-success" : "text-default-400"
                        }`}>
                          {isSettled 
                            ? `${formatUnits(intrinsicValue * balance, 18)} WXDAI`
                            : "TBD"
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    {isSettled && intrinsicValue > 0n && (
                      <Button
                        size="sm"
                        color="success"
                        variant="flat"
                        onPress={() => {
                          // Set the series in localStorage for the exercise component
                          localStorage.setItem("vault:selectedSeriesId", series.id.toString());
                          window.dispatchEvent(
                            new CustomEvent("vault:selectedSeriesChanged", { 
                              detail: series.id.toString() 
                            })
                          );
                        }}
                      >
                        Exercise
                      </Button>
                    )}
                    
                    <details className="cursor-pointer">
                      <summary className="text-xs text-default-500">Details</summary>
                      <div className="mt-2 p-3 bg-default-100 rounded text-xs space-y-1">
                        <div><strong>Series ID:</strong> {series.id.toString()}</div>
                        <div><strong>Underlying:</strong> {series.underlying}</div>
                        <div><strong>Strike:</strong> {formatStrike(series.strike)} WXDAI</div>
                        <div><strong>Expiry:</strong> {formatDateUTC(series.expiry)}</div>
                        {isSettled && (
                          <>
                            <div><strong>Settle Price:</strong> {formatUnits(settlePrice, 18)} WXDAI</div>
                            <div><strong>Per Option Value:</strong> {formatUnits(intrinsicValue, 18)} WXDAI</div>
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
                
                {/* Progress bar for time to expiry */}
                {!isExpired && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-default-500">
                      <span>Time to Expiry</span>
                      <span>{daysToExpiry} days remaining</span>
                    </div>
                    <Progress 
                      value={Math.min(100, Math.max(0, (daysToExpiry / 30) * 100))} 
                      size="sm"
                      color={daysToExpiry > 7 ? "success" : daysToExpiry > 2 ? "warning" : "danger"}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      
      {/* Quick Actions */}
      {positions.length > 0 && (
        <div className="pt-4 border-t border-default-200">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={() => {
                // Navigate to exercise section
                document.querySelector('[data-section="exercise"]')?.scrollIntoView({ 
                  behavior: 'smooth' 
                });
              }}
            >
              Exercise Options
            </Button>
            <Button
              size="sm"
              variant="flat"
              onPress={() => {
                // Refresh positions
                window.location.reload();
              }}
            >
              Refresh Positions
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}