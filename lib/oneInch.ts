import {
  Api,
  LimitOrder,
  MakerTraits,
  Address as OneInchAddress,
  // HttpProviderConnector is a type; we won't rely on it at runtime.
  // If your local SDK exposes it as a type, you can import it and implement it strictly.
  // Otherwise this minimal interface will keep TS happy.
} from "@1inch/limit-order-sdk";

const NETWORK_ID = 100; // Gnosis

// Minimal typing for the connector the Api expects.
// The README states: "use any connector which implements HttpProviderConnector".
type HttpProviderConnectorLike = {
  get<T = unknown>(url: string, config?: { headers?: Record<string, string> }): Promise<T>;
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: { headers?: Record<string, string> },
  ): Promise<T>;
};

/**
 * A tiny fetch-based HTTP connector compatible with the SDK's Api.
 * This avoids the need to import '@1inch/limit-order-sdk/axios'.
 */
class FetchHttpConnector implements HttpProviderConnectorLike {
  async get<T = unknown>(url: string, config?: { headers?: Record<string, string> }): Promise<T> {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(config?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`1inch API GET ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: { headers?: Record<string, string> },
  ): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config?.headers ?? {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`1inch API POST ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }
}

/** Create a configured 1inch Orderbook API client (needs Dev Portal token). */
export function getOneInchApi() {
  const authKey = process.env.NEXT_PUBLIC_1INCH_API_KEY || "";
  if (!authKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_1INCH_API_KEY – create one at https://portal.1inch.dev",
    );
  }
  return new Api({
    networkId: NETWORK_ID,
    authKey,
    httpConnector: new FetchHttpConnector(), // <- no subpath import required
  });
}

/** Arguments for a simple v4 Limit Order */
export type BuildOrderArgs = {
  /** EOA placing the order (maker / seller) */
  makerAddress: string;

  /** Token being sold by maker (option token, ERC-20, etc.) */
  makerAsset: string;

  /** Token wanted by maker (e.g., USDC/xDAI) */
  takerAsset: string;

  /** Amount of makerAsset (base units) */
  makingAmount: bigint;

  /** Amount of takerAsset requested (base units) */
  takingAmount: bigint;

  /** Expiration in seconds from now (default: 2 hours) */
  expirationSec?: number;
};

/**
 * Build a v4 LimitOrder + EIP-712 typed data for signing.
 * Feed `typedData` into wagmi's `signTypedData`.
 */
export function buildLimitOrder({
  makerAddress,
  makerAsset,
  takerAsset,
  makingAmount,
  takingAmount,
  expirationSec = 2 * 60 * 60, // 2h
}: BuildOrderArgs) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = BigInt(now + expirationSec);

  const traits = MakerTraits.default()
    .withAllowPartialFills(true)
    .withExpiration(expiration);

  const order = new LimitOrder(
    {
      makerAsset: new OneInchAddress(makerAsset),
      takerAsset: new OneInchAddress(takerAsset),
      makingAmount,
      takingAmount,
      maker: new OneInchAddress(makerAddress),
    },
    traits,
  );

  const typedData = order.getTypedData(); // { domain, types, message }
  return { order, typedData };
}

/**
 * Submit a signed order to the 1inch Orderbook.
 * Returns the computed order hash.
 */
export async function submitSignedOrder(
  order: LimitOrder,
  signature: `0x${string}`,
) {
  const api = getOneInchApi();
  await api.submitOrder(order, signature);
  const orderHash = order.getOrderHash(NETWORK_ID) as `0x${string}`;
  return orderHash;
}

/** Fetch all orders for a given maker address. */
export async function fetchOrdersByMaker(makerAddress: string) {
  const api = getOneInchApi();
  return api.getOrdersByMaker(new OneInchAddress(makerAddress));
}

/** Fetch one order by its orderHash. */
export async function fetchOrderByHash(orderHash: `0x${string}`) {
  const api = getOneInchApi();
  return api.getOrderByHash(orderHash);
}