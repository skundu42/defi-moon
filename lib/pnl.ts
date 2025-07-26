// lib/pnl.ts
import { formatUnits } from "viem";
import type { TokenMeta } from "@/lib/token";

export type Fill = {
  seriesId?: bigint;               // optional if you can map makerAsset -> seriesId
  makerAsset: `0x${string}`;
  takerAsset: `0x${string}`;
  makingAmount: bigint;            // maker ERC20 decimals (18 for wrapped option)
  takingAmount: bigint;            // taker token decimals
  ts?: number;
  txHash?: `0x${string}`;
};

export function sumPremiumsInQuote(fills: Fill[], quote: TokenMeta) {
  const total = fills.reduce((acc, f) => {
    return acc + (f.takerAsset.toLowerCase() === quote.address.toLowerCase() ? f.takingAmount : 0n);
  }, 0n);
  return { raw: total, human: Number(formatUnits(total, quote.decimals)) };
}

export function exerciseShareToQuote(exerciseShareUnderlying: bigint, settlePriceWx: bigint, quoteDecimals = 18) {
  // convert underlying (1e18) * price(1e18) / 1e18 = 1e18
  const quoteAmount1e18 = (exerciseShareUnderlying * settlePriceWx) / 10n ** 18n;
  // If your quote is WXDAI with 18 decimals, return as-is. Otherwise rescale here.
  return quoteDecimals === 18
    ? quoteAmount1e18
    : quoteAmount1e18; // adjust if your quote != 18 decimals
}