// lib/oneInch.ts
import {
  Api,
  LimitOrder,
  MakerTraits,
  Address as OneInchAddress,
} from "@1inch/limit-order-sdk";
import { AxiosProviderConnector } from "@1inch/limit-order-sdk/axios";
import { Address as ViemAddress, encodeAbiParameters, Hex } from "viem";
import {
  LOP_V4_GNOSIS,
  ERC1155_PROXY_ADDRESS,
} from "@/lib/contracts";

/* ----------------------------- Constants / API ----------------------------- */

export const NETWORK_ID = 100; // Gnosis Chain Mainnet

export function getOneInchApi() {
  const authKey =
    process.env.ONEINCH_API_KEY || process.env.NEXT_PUBLIC_ONEINCH_AUTH_KEY;
  if (!authKey) {
    throw new Error(
      "Missing ONEINCH_API_KEY (or NEXT_PUBLIC_ONEINCH_AUTH_KEY) in environment"
    );
  }
  return new Api({
    networkId: NETWORK_ID,
    authKey,
    httpConnector: new AxiosProviderConnector(),
  });
}

/* --------------------------------- Types ---------------------------------- */

export type BuildOrderArgs1155 = {
  makerAddress: string;
  maker1155: {
    token: ViemAddress;
    tokenId: bigint;
    amount: bigint;
    data?: Hex;
  };
  takerAsset: ViemAddress;
  takerAmount: bigint;
  expirationSec?: number;
  allowedSender?: ViemAddress;
};

export type BuiltOrder1155 = {
  order: LimitOrder;
  typedData: any;
  extension: {
    makerAssetSuffix: Hex;
    takerAssetSuffix: Hex;
  };
};

/* ---------------------- Build ERC-1155 LimitOrder ------------------------- */

export function buildLimitOrder1155({
  makerAddress,
  maker1155: { token, tokenId, amount, data },
  takerAsset,
  takerAmount,
  expirationSec = 2 * 60 * 60,
  allowedSender,
}: BuildOrderArgs1155): BuiltOrder1155 {
  if (
    !ERC1155_PROXY_ADDRESS ||
    ERC1155_PROXY_ADDRESS ===
      "0x0000000000000000000000000000000000000000"
  ) {
    throw new Error(
      "ERC1155 proxy address is not set. Provide NEXT_PUBLIC_ERC1155_PROXY_ADDRESS in your .env"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expiration = BigInt(now + expirationSec);

  const traits = MakerTraits.default()
    .withExpiration(expiration)
    .withAllowedSender(
      new OneInchAddress(allowedSender ?? LOP_V4_GNOSIS)
    );

  const order = new LimitOrder(
    {
      makerAsset: new OneInchAddress(ERC1155_PROXY_ADDRESS),
      takerAsset: new OneInchAddress(takerAsset),
      makingAmount: amount,      // maps to ERC1155 “value”
      takingAmount: takerAmount, // ERC20 units wanted
      maker: new OneInchAddress(makerAddress),
    },
    traits
  );

  // encode (id, token, data) for the proxy’s suffix calldata
  const makerAssetSuffix = encodeAbiParameters(
    [
      { name: "id", type: "uint256" },
      { name: "token", type: "address" },
      { name: "data", type: "bytes" },
    ],
    [tokenId, token, (data ?? "0x") as Hex]
  );

  const extension = {
    makerAssetSuffix,
    takerAssetSuffix: "0x" as Hex,
  };

  const typedData = order.getTypedData(NETWORK_ID);

  return { order, typedData, extension };
}

/* ----------------------------- Submit / Fetch ----------------------------- */

/**
 * Submit a signed ERC-1155 order (with its extension) to 1inch’s orderbook.
 */
export async function submitSignedOrder(
  built: BuiltOrder1155,
  signature: `0x${string}`
) {
  const api = getOneInchApi();
  try {
    // v4+ SDKs accept the extension option here
    // @ts-expect-error extension requires v4+ support
    await api.submitOrder(built.order, signature, {
      extension: built.extension,
    });
  } catch (e: any) {
    throw new Error(
      `Failed to submit 1155 order with extension: ${e?.message ?? e}`
    );
  }
}

/**
 * Fetch all open orders by a maker.
 */
export async function fetchOrdersByMaker(makerAddress: string) {
  const api = getOneInchApi();
  return api.getOrdersByMaker(new OneInchAddress(makerAddress));
}