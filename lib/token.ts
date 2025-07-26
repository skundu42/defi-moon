// lib/tokens.ts
import type { Address } from "viem";

export type TokenSymbol = "WXDAI" | "USDC" | "GNO";
export type TokenMeta = { symbol: TokenSymbol; name: string; address: Address; decimals: number };

// Gnosis mainnet defaults
const DEFAULTS: Record<TokenSymbol, TokenMeta> = {
  WXDAI: {
    symbol: "WXDAI",
    name: "Wrapped xDAI",
    address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d" as Address,
    decimals: 18,
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83" as Address,
    decimals: 6,
  },
  GNO: {
    symbol: "GNO",
    name: "Gnosis Token",
    address: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb" as Address,
    decimals: 18,
  },
};

function envAddr(sym: TokenSymbol): Address | null {
  const v = process.env[`NEXT_PUBLIC_TOKEN_${sym}`] as string | undefined;
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;
}

export const TOKENS: Record<TokenSymbol, TokenMeta> = {
  WXDAI: { ...DEFAULTS.WXDAI, address: envAddr("WXDAI") ?? DEFAULTS.WXDAI.address },
  USDC:  { ...DEFAULTS.USDC,  address: envAddr("USDC")  ?? DEFAULTS.USDC.address  },
  GNO:   { ...DEFAULTS.GNO,   address: envAddr("GNO")   ?? DEFAULTS.GNO.address   },
};

export const ALL_TOKENS: TokenMeta[] = [TOKENS.WXDAI, TOKENS.USDC, TOKENS.GNO];
export const QUOTE_TOKENS: TokenMeta[] = ALL_TOKENS; // taker choices in CreateLimitOrder

export const UNDERLYING_DEFAULT_SYMBOL: TokenSymbol =
  (process.env.NEXT_PUBLIC_UNDERLYING_SYMBOL as TokenSymbol) ?? "GNO";

export function getTokenBySymbol(sym: TokenSymbol): TokenMeta {
  return TOKENS[sym];
}