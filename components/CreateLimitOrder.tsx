// components/CreateLimitOrder.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useSignTypedData,
  usePublicClient,
  useReadContract,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import {
  Address as ViemAddress,
  parseAbiItem,
  formatUnits,
  parseUnits,
  encodeAbiParameters,
} from "viem";
import { Select, SelectItem } from "@heroui/select";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { Tooltip } from "@heroui/tooltip";
import { Spinner } from "@heroui/spinner";

import { 
  buildLimitOrder1155, 
  LOP_V4_ADDRESS,
  lopV4Abi,
  getOrderHash,
  isOrderActive 
} from "@/lib/oneInch";
import {
  VAULT_ADDRESS,
  CALLTOKEN_ADDRESS,
  ERC1155_PROXY_ADDRESS,
  TOKEN_ADDRESSES,
  vaultAbi,
  erc1155Abi,
} from "@/lib/contracts";
import { submitOrder, cancelOrderInApi } from "@/lib/orderApi";

// 1) ABI for SeriesDefined event
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

// 2) Simple tooltip "i" helper
function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

// 3) Format expiry timestamps
function formatDateUTC(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

// 4) Decimals for each taker token
const DECIMALS: Record<string, number> = {
  WXDAI: 18,
  USDC: 6,
  WETH: 18,
};

export default function CreateLimitOrder() {
  // --- wallet & signer ---
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();

  // --- load all series onchain ---
  const [allSeries, setAllSeries] = useState<
    { id: bigint; strike: bigint; expiry: bigint }[]
  >([]);
  const [loadingSeries, setLoadingSeries] = useState(true);
  const bootRef = useRef(false);

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
        const acc: typeof allSeries = [];
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
              strike: l.args.strike as bigint,
              expiry: l.args.expiry as bigint,
            });
          }
        }
        const dedup = new Map<string, typeof acc[0]>();
        acc.forEach((r) => dedup.set(r.id.toString(), r));
        setAllSeries(
          Array.from(dedup.values()).sort((a, b) =>
            Number(a.expiry - b.expiry)
          )
        );
      } finally {
        setLoadingSeries(false);
      }
    })();
  }, [publicClient]);

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
            strike: l.args.strike as bigint,
            expiry: l.args.expiry as bigint,
          });
        }
        return Array.from(m.values()).sort((a, b) =>
          Number(a.expiry - b.expiry)
        );
      });
    },
  });

  const now = Math.floor(Date.now() / 1000);
  const activeSeries = useMemo(
    () => allSeries.filter((s) => Number(s.expiry) > now),
    [allSeries, now]
  );

  // --- ERC1155 proxy approval check & write ---
  const { data: isApproved = false } = useReadContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "isApprovedForAll",
    args: [address as ViemAddress, ERC1155_PROXY_ADDRESS as ViemAddress],
    query: { enabled: Boolean(address) },
  });
  const { writeContractAsync: approveProxy } = useWriteContract();

  // --- form state & helpers ---
  const [selectedSeriesId, setSelectedSeriesId] = useState<bigint>();
  const [qtyStr, setQtyStr] = useState("");
  const [takerSym, setTakerSym] = useState<keyof typeof DECIMALS>("WXDAI");
  const [takerAmountStr, setTakerAmountStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderHash, setOrderHash] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [createdOrders, setCreatedOrders] = useState<Array<{
    hash: string;
    order: any;
    signature: string;
    timestamp: number;
  }>>([]);
  
  const addNotice = (msg: string) => setNotices((n) => [...n, msg]);

  // --- Watch for order fills ---
  useWatchContractEvent({
    address: LOP_V4_ADDRESS,
    abi: lopV4Abi,
    eventName: "OrderFilled",
    onLogs(logs) {
      logs.forEach((log) => {
        const filledHash = log.args.orderHash;
        if (createdOrders.some(o => o.hash === filledHash)) {
          addNotice(`✅ Order ${filledHash} has been filled!`);
        }
      });
    },
  });

  // --- approval handler ---
  const onApprove = async () => {
    if (!address) return;
    try {
      await approveProxy({
        address: CALLTOKEN_ADDRESS,
        abi: erc1155Abi,
        functionName: "setApprovalForAll",
        args: [ERC1155_PROXY_ADDRESS as ViemAddress, true],
      });
      addNotice("✅ Proxy approved");
    } catch (e: any) {
      addNotice(`❌ Approve error: ${e.message}`);
    }
  };

  // --- create order (sign and submit to API) ---
  const onCreate = async () => {
    if (!address) return addNotice("🔌 Connect wallet");
    if (!selectedSeriesId) return addNotice("📑 Select series");

    // parse qty
    let qty: bigint;
    try {
      qty = BigInt(qtyStr);
    } catch {
      return addNotice("⚠️ Invalid qty");
    }
    if (qty <= 0n) return addNotice("⚠️ Qty must be > 0");

    // parse taker amount
    const decimals = DECIMALS[takerSym];
    let takerAmt: bigint;
    try {
      takerAmt = parseUnits(takerAmountStr, decimals);
    } catch {
      return addNotice("⚠️ Invalid receive amt");
    }
    if (takerAmt <= 0n) return addNotice("⚠️ Amt must be > 0");

    // lookup taker address
    const takerAsset = TOKEN_ADDRESSES[takerSym];
    if (!takerAsset) return addNotice(`⚠️ Token ${takerSym} unsupported`);

    setSubmitting(true);
    try {
      // build order
      const { order, typedData, orderHash } = buildLimitOrder1155({
        makerAddress: address,
        maker1155: {
          token: CALLTOKEN_ADDRESS as ViemAddress,
          tokenId: selectedSeriesId,
          amount: qty,
          data: "0x",
        },
        takerAsset,
        takerAmount: takerAmt,
        expirationSec: 7 * 24 * 60 * 60, // 7 days
        allowPartialFill: true,
      });

      // sign the typed-data
      const signature = await signTypedDataAsync({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      // Submit to our internal API
      await submitOrder(order, signature, orderHash);
      
      setOrderHash(orderHash);
      
      // Store order details locally too
      const orderData = {
        hash: orderHash,
        order,
        signature,
        timestamp: Date.now(),
      };
      setCreatedOrders(prev => [...prev, orderData]);
      
      addNotice(`🎉 Order created and posted to orderbook!`);
      addNotice(`📋 Order hash: ${orderHash}`);
      
    } catch (e: any) {
      addNotice("❌ Order creation failed: " + (e.message || e.toString()));
    } finally {
      setSubmitting(false);
    }
  };

  // --- Cancel order ---
  const onCancelOrder = async (orderHash: string, makerTraits: bigint) => {
    if (!address) return;
    
    try {
      // Cancel on-chain
      await writeContractAsync({
        address: LOP_V4_ADDRESS,
        abi: lopV4Abi,
        functionName: "cancelOrder",
        args: [makerTraits, orderHash as `0x${string}`],
      });
      
      // Update API status
      await cancelOrderInApi(orderHash);
      
      addNotice(`✅ Order ${orderHash} cancelled`);
      setCreatedOrders(prev => prev.filter(o => o.hash !== orderHash));
    } catch (e: any) {
      addNotice(`❌ Cancel failed: ${e.message}`);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-lg font-medium">ERC-1155 Direct On-chain Limit Order</h3>

      {notices.map((m, i) => (
        <div
          key={i}
          className="p-2 text-sm text-warning border border-warning rounded"
        >
          {m}
        </div>
      ))}

      {/* Series selector */}
      <div>
        <label className="block mb-1 text-sm font-medium">
          Series <Info tip="Only unexpired" />
        </label>
        {loadingSeries ? (
          <div className="flex items-center gap-2">
            <Spinner size="sm" /> Loading…
          </div>
        ) : (
          <Select
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={
              selectedSeriesId
                ? new Set([selectedSeriesId.toString()])
                : new Set()
            }
            onSelectionChange={(keys) =>
              setSelectedSeriesId(BigInt([...keys][0]))
            }
            classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
          >
            {activeSeries.map((s) => (
              <SelectItem
                key={s.id.toString()}
                value={s.id.toString()}
                textValue={`${s.id} • K${formatUnits(
                  s.strike,
                  18
                )} • exp ${formatDateUTC(s.expiry)}`}
              >
                <div>
                  <span className="font-mono">{s.id.toString()}</span>
                  <span className="text-xs text-default-500">
                    K {formatUnits(s.strike, 18)} • exp{" "}
                    {formatDateUTC(s.expiry)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </Select>
        )}
      </div>

      {/* Approve proxy */}
      <Button onPress={onApprove} isDisabled={isApproved || !isConnected} className="h-12">
        {isApproved ? "Proxy Approved" : "Approve Proxy"}
      </Button>

      {/* Order form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-sm">Qty to Sell</label>
          <Input
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            placeholder="e.g. 1"
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        <div>
          <label className="text-sm">Receive Token</label>
          <Select
            selectionMode="single"
            selectedKeys={new Set([takerSym])}
            onSelectionChange={(keys) =>
              setTakerSym([...keys][0] as keyof typeof DECIMALS)
            }
            classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
          >
            {Object.keys(DECIMALS).map((sym) => (
              <SelectItem key={sym} value={sym} textValue={sym}>
                {sym}
              </SelectItem>
            ))}
          </Select>
        </div>

        <div>
          <label className="text-sm">Receive Amount</label>
          <Input
            value={takerAmountStr}
            onChange={(e) => setTakerAmountStr(e.target.value)}
            placeholder="e.g. 10"
            classNames={{ inputWrapper: "h-12 bg-default-100", input: "text-sm" }}
          />
        </div>

        <Button
          color="primary"
          onPress={onCreate}
          isLoading={submitting}
          isDisabled={
            !isConnected || !isApproved || !selectedSeriesId || submitting
          }
          className="h-12 w-full"
        >
          Create & Sign Order
        </Button>
      </div>

      {/* Created Orders */}
      {createdOrders.length > 0 && (
        <div className="mt-6 space-y-4">
          <h4 className="font-medium">Your Created Orders</h4>
          {createdOrders.map((orderData) => (
            <div key={orderData.hash} className="p-4 border rounded-lg space-y-2">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="text-sm text-default-500">Order Hash:</div>
                  <div className="font-mono text-xs break-all">{orderData.hash}</div>
                </div>
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  onPress={() => onCancelOrder(orderData.hash, orderData.order.makerTraits)}
                >
                  Cancel
                </Button>
              </div>
              
              <details className="cursor-pointer">
                <summary className="text-sm font-medium">Order Details</summary>
                <div className="mt-2 p-3 bg-default-100 rounded text-xs font-mono">
                  <div>Series ID: {orderData.order.extension ? 
                    BigInt("0x" + orderData.order.extension.slice(2, 66)).toString() : 
                    "N/A"}</div>
                  <div>Amount: {orderData.order.makingAmount.toString()}</div>
                  <div>Taker Token: {orderData.order.takerAsset}</div>
                  <div>Taker Amount: {orderData.order.takingAmount.toString()}</div>
                  <div>Active: {isOrderActive(orderData.order.makerTraits) ? "Yes" : "No"}</div>
                  <div className="mt-2 text-xs text-default-600">
                    Order is available in the orderbook for takers to discover and fill.
                  </div>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}