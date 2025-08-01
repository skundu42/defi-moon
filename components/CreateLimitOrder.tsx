"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  isOrderActive,
} from "@/lib/oneInch";
import {
  VAULT_ADDRESS,
  CALLTOKEN_ADDRESS,
  TOKEN_ADDRESSES,
  vaultAbi,
  erc1155Abi,
} from "@/lib/contracts";
import { submitOrder, cancelOrderInApi } from "@/lib/orderApi";

// --- Contract Addresses ---
const ERC1155_TRANSFER_PROXY_ADDRESS = "0x639e4E6cFF7d9a9bcFCa09ac8282CF037D40f9Fd" as ViemAddress;


// --- Event ABI for SeriesDefined ---
const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

// --- Tooltip helper ---
function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

// --- Format expiry ---
function formatDateUTC(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

// --- Decimals map ---
const DECIMALS = {
  WXDAI: 18,
  USDC: 6,
  WETH: 18,
  GNO: 18,
} as const;

type TokenSymbol = keyof typeof DECIMALS;

type SeriesData = {
  id: bigint;
  strike: bigint;
  expiry: bigint;
};

type CreatedOrder = {
  hash: string;
  order: any;
  signature: string;
  timestamp: number;
  seriesId: bigint;
  amount: bigint;
  takerToken: string;
  takerAmount: bigint;
};

export default function CreateLimitOrder() {
  // Wallet / signer
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Series state
  const [allSeries, setAllSeries] = useState<SeriesData[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(true);
  const bootRef = useRef(false);

  const loadSeries = useCallback(async () => {
    if (!publicClient) return;
    
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
          event: SERIES_DEFINED,
          fromBlock: b,
          toBlock: to,
        });
        
        for (const l of logs) {
          if (l.args.id && l.args.strike && l.args.expiry) {
            acc.push({
              id: l.args.id as bigint,
              strike: l.args.strike as bigint,
              expiry: l.args.expiry as bigint,
            });
          }
        }
      }
      
      const dedup = new Map<string, SeriesData>();
      acc.forEach((r) => dedup.set(r.id.toString(), r));
      setAllSeries(
        Array.from(dedup.values()).sort((a, b) =>
          Number(a.expiry - b.expiry)
        )
      );
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setLoadingSeries(false);
    }
  }, [publicClient]);

  useEffect(() => {
    if (!publicClient || bootRef.current) return;
    bootRef.current = true;
    loadSeries();
  }, [publicClient, loadSeries]);

  // Listen for new series additions live
  useWatchContractEvent({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    eventName: "SeriesDefined",
    onLogs(logs) {
      setAllSeries((prev) => {
        const m = new Map(prev.map((r) => [r.id.toString(), r]));
        for (const l of logs) {
          if (l.args.id && l.args.strike && l.args.expiry) {
            m.set((l.args.id as bigint).toString(), {
              id: l.args.id as bigint,
              strike: l.args.strike as bigint,
              expiry: l.args.expiry as bigint,
            });
          }
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

  // Check ERC1155TransferProxy contract availability by checking if it has bytecode
  const [proxyExists, setProxyExists] = useState<boolean | null>(null);
  const [proxyCheckError, setProxyCheckError] = useState<string | null>(null);

  useEffect(() => {
    const checkProxy = async () => {
      if (!publicClient) return;
      
      try {
        const code = await publicClient.getBytecode({ address: ERC1155_TRANSFER_PROXY_ADDRESS });
        if (code && code !== "0x") {
          setProxyExists(true);
          setProxyCheckError(null);
        } else {
          setProxyExists(false);
          setProxyCheckError("Contract not deployed at this address");
        }
      } catch (error: any) {
        setProxyExists(false);
        setProxyCheckError(error.message || "Failed to check contract");
      }
    };

    checkProxy();
  }, [publicClient]);

  // ERC1155 approval for transfer proxy
  const { data: isApprovedForProxy = false, refetch: refetchApproval } = useReadContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "isApprovedForAll",
    args: [address as ViemAddress, ERC1155_TRANSFER_PROXY_ADDRESS as ViemAddress],
    query: { enabled: Boolean(address) },
  });

  // Form state
  const [selectedSeriesId, setSelectedSeriesId] = useState<bigint | null>(null);
  const [qtyStr, setQtyStr] = useState("");
  const [takerSym, setTakerSym] = useState<TokenSymbol>("WXDAI");
  const [takerAmountStr, setTakerAmountStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderHash, setOrderHash] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [createdOrders, setCreatedOrders] = useState<CreatedOrder[]>([]);

  const addNotice = useCallback((msg: string) => {
    setNotices((n) => {
      const newNotices = [msg, ...n.slice(0, 4)]; // Keep only last 5 notices
      return Array.from(new Set(newNotices)); // Remove duplicates
    });
  }, []);

  // Clear old notices automatically
  useEffect(() => {
    if (notices.length === 0) return;
    const timer = setTimeout(() => {
      setNotices(prev => prev.slice(1)); // Remove oldest notice
    }, 8000);
    return () => clearTimeout(timer);
  }, [notices]);

  // Check user's option balance for selected series
  const { data: optionBalance = 0n } = useReadContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "balanceOf",
    args: [address as ViemAddress, selectedSeriesId || 0n],
    query: { enabled: Boolean(address && selectedSeriesId) },
  });

  // Watch for order fills
  useWatchContractEvent({
    address: LOP_V4_ADDRESS,
    abi: lopV4Abi,
    eventName: "OrderFilled",
    onLogs(logs) {
      logs.forEach((log) => {
        const filledHash = log.args.orderHash;
        if (filledHash && createdOrders.some((o) => o.hash === filledHash)) {
          addNotice(`🎉 Order ${filledHash.slice(0, 10)}... has been filled!`);
          // Remove filled order from the list
          setCreatedOrders(prev => prev.filter(o => o.hash !== filledHash));
        }
      });
    },
  });

  // Approve proxy handler
  const onApproveProxy = useCallback(async () => {
    if (!address) return;
    try {
      addNotice("📝 Approving ERC1155TransferProxy...");
      await writeContractAsync({
        address: CALLTOKEN_ADDRESS,
        abi: erc1155Abi,
        functionName: "setApprovalForAll",
        args: [ERC1155_TRANSFER_PROXY_ADDRESS as ViemAddress, true],
      });
      await refetchApproval();
      addNotice("✅ ERC1155TransferProxy approved successfully!");
    } catch (error: any) {
      addNotice(`❌ Approval failed: ${error?.message || String(error)}`);
    }
  }, [address, writeContractAsync, addNotice, refetchApproval]);

  // Create limit order
  const onCreate = useCallback(async () => {
    if (!address) return addNotice("🔌 Please connect your wallet");
    if (!selectedSeriesId) return addNotice("📑 Please select an option series");
    if (!isApprovedForProxy) return addNotice("⚠️ Please approve the transfer proxy first");

    // Validate quantity
    let qty: bigint;
    try {
      qty = BigInt(qtyStr);
    } catch {
      return addNotice("⚠️ Invalid quantity format");
    }
    if (qty <= 0n) return addNotice("⚠️ Quantity must be greater than 0");
    if (qty > optionBalance) return addNotice("⚠️ Insufficient option balance");

    // Validate taker amount
    const decimals = DECIMALS[takerSym];
    let takerAmt: bigint;
    try {
      takerAmt = parseUnits(takerAmountStr, decimals);
    } catch {
      return addNotice("⚠️ Invalid receive amount format");
    }
    if (takerAmt <= 0n) return addNotice("⚠️ Receive amount must be greater than 0");

    const takerAsset = TOKEN_ADDRESSES[takerSym];
    if (!takerAsset) return addNotice(`⚠️ Token ${takerSym} not supported`);

    setSubmitting(true);
    try {
      addNotice("🔄 Creating and signing order...");
      
      // Create order using your buildLimitOrder1155 function
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

      // Sign the order
      const signature = await signTypedDataAsync({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      // Submit to orderbook using your API
      await submitOrder(order, signature, orderHash);

      // Store created order
      const createdOrder: CreatedOrder = {
        hash: orderHash,
        order,
        signature,
        timestamp: Date.now(),
        seriesId: selectedSeriesId,
        amount: qty,
        takerToken: takerSym,
        takerAmount: takerAmt,
      };

      setOrderHash(orderHash);
      setCreatedOrders((prev) => [createdOrder, ...prev]);
      
      addNotice(`🎉 Order created successfully!`);
      addNotice(`📋 Order hash: ${orderHash.slice(0, 16)}...`);
      addNotice(`📈 Selling ${qty.toString()} options for ${formatUnits(takerAmt, decimals)} ${takerSym}`);
      
      // Clear form
      setQtyStr("");
      setTakerAmountStr("");
      
    } catch (error: any) {
      console.error("Order creation error:", error);
      addNotice(`❌ Order creation failed: ${error?.message || String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }, [
    address,
    selectedSeriesId,
    isApprovedForProxy,
    qtyStr,
    optionBalance,
    takerSym,
    takerAmountStr,
    signTypedDataAsync,
    addNotice,
  ]);

  // Cancel order
  const onCancelOrder = useCallback(async (createdOrder: CreatedOrder) => {
    if (!address) return;
    try {
      addNotice(`🔄 Cancelling order ${createdOrder.hash.slice(0, 10)}...`);
      
      // On-chain cancel using your LOP v4 ABI
      await writeContractAsync({
        address: LOP_V4_ADDRESS,
        abi: lopV4Abi,
        functionName: "cancelOrder",
        args: [BigInt(createdOrder.order.makerTraits), createdOrder.hash as `0x${string}`],
      });

      // Cancel in API
      await cancelOrderInApi(createdOrder.hash);
      
      addNotice(`✅ Order ${createdOrder.hash.slice(0, 10)}... cancelled successfully`);
      setCreatedOrders((prev) =>
        prev.filter((o) => o.hash.toLowerCase() !== createdOrder.hash.toLowerCase())
      );
    } catch (error: any) {
      addNotice(`❌ Cancel failed: ${error?.message || String(error)}`);
    }
  }, [address, writeContractAsync, addNotice]);

  // Event handlers
  const handleSeriesSelection = useCallback((keys: any) => {
    const arr = Array.from(keys);
    if (arr[0] && typeof arr[0] === 'string') {
      try {
        setSelectedSeriesId(BigInt(arr[0]));
      } catch {
        setSelectedSeriesId(null);
      }
    } else {
      setSelectedSeriesId(null);
    }
  }, []);

  const handleTakerSymChange = useCallback((keys: any) => {
    const selectedKey = [...keys][0] as TokenSymbol;
    setTakerSym(selectedKey);
  }, []);

  const selectedSeries = useMemo(() => 
    activeSeries.find(s => s.id === selectedSeriesId),
    [activeSeries, selectedSeriesId]
  );

  return (
    <Card className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="text-center">
        <h3 className="text-xl font-semibold mb-2">
          ERC-1155 Options Limit Orders
        </h3>
        <p className="text-sm text-default-600">
          Create limit orders to sell your option tokens using 1inch Protocol
        </p>
      </div>

      {/* Proxy status */}
      <div className="text-center">
        {proxyExists === null ? (
          <div className="text-sm text-default-500 bg-default-100 p-3 rounded-lg">
            🔍 Checking ERC1155TransferProxy availability...
          </div>
        ) : proxyExists === false ? (
          <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
            ⚠️ ERC1155TransferProxy not available. Please check contract deployment.
            <div className="text-xs mt-1 opacity-75">
              Error: {proxyCheckError}
            </div>
            <div className="text-xs mt-1 font-mono">
              Address: {ERC1155_TRANSFER_PROXY_ADDRESS}
            </div>
          </div>
        ) : (
          <div className="text-sm text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
            ✅ ERC1155TransferProxy is available and ready
            <div className="text-xs mt-1 opacity-75">
              Your ERC1155 tokens can be traded directly through 1inch using the transfer proxy
            </div>
            <div className="text-xs mt-1 font-mono">
              Address: {ERC1155_TRANSFER_PROXY_ADDRESS}
            </div>
          </div>
        )}
      </div>

      {/* Notices */}
      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((notice, i) => (
            <div
              key={`${i}-${notice.slice(0, 20)}`}
              className="text-sm p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800"
            >
              {notice}
            </div>
          ))}
        </div>
      )}

      {/* Series selector */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          Option Series <Info tip="Select an option series to create a sell order" />
        </label>
        {loadingSeries ? (
          <div className="flex items-center justify-center gap-2 p-8">
            <Spinner size="sm" />
            <span className="text-sm text-default-500">Loading option series...</span>
          </div>
        ) : activeSeries.length === 0 ? (
          <div className="text-center p-8 text-default-500">
            <div className="text-sm">No active option series found</div>
            <div className="text-xs mt-1">Create some options first or check if they haven't expired</div>
          </div>
        ) : (
          <Select
            selectionMode="single"
            placeholder="Select an option series"
            selectedKeys={
              selectedSeriesId ? new Set([selectedSeriesId.toString()]) : new Set()
            }
            onSelectionChange={handleSeriesSelection}
            classNames={{ trigger: "h-14 bg-default-100", value: "text-sm" }}
          >
            {activeSeries.map((s) => (
              <SelectItem
                key={s.id.toString()}
                textValue={`Series ${s.id.toString()} • Strike ${formatUnits(s.strike, 18)} • Expires ${formatDateUTC(s.expiry)}`}
              >
                <div className="flex flex-col py-1">
                  <div className="font-medium text-sm">Series {s.id.toString()}</div>
                  <div className="text-xs text-default-500">
                    Strike: {formatUnits(s.strike, 18)} WXDAI • Expires: {formatDateUTC(s.expiry)}
                  </div>
                </div>
              </SelectItem>
            ))}
          </Select>
        )}
      </div>

      {/* Balance and series info */}
      {selectedSeries && (
        <div className="bg-default-50 p-4 rounded-lg space-y-2">
          <h4 className="font-medium text-sm">Selected Series Information</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-default-600">Your Balance:</span>
              <span className="font-mono font-medium">{optionBalance.toString()} options</span>
            </div>
            <div className="flex justify-between">
              <span className="text-default-600">Strike Price:</span>
              <span className="font-medium">{formatUnits(selectedSeries.strike, 18)} WXDAI</span>
            </div>
            <div className="flex justify-between">
              <span className="text-default-600">Expires:</span>
              <span className="font-medium">{formatDateUTC(selectedSeries.expiry)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Approval section */}
      <div className="space-y-3">
        <h4 className="font-medium text-sm">Step 1: Approve Transfer Proxy</h4>
        <Button
          onPress={onApproveProxy}
          isDisabled={!isConnected || isApprovedForProxy || !proxyExists}
          className="w-full h-12"
          color={isApprovedForProxy ? "success" : "primary"}
          variant={isApprovedForProxy ? "flat" : "solid"}
        >
          {isApprovedForProxy ? "✅ Transfer Proxy Approved" : "Approve ERC1155TransferProxy"}
        </Button>
        <div className="text-xs text-default-600">
          This allows the transfer proxy to move your ERC1155 option tokens when orders are filled.
        </div>
      </div>

      {/* Order creation form */}
      <div className="space-y-4">
        <h4 className="font-medium text-sm">Step 2: Create Limit Order</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Quantity to Sell</label>
            <Input
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
              placeholder={`Max: ${optionBalance.toString()}`}
              type="number"
              min="1"
              max={optionBalance.toString()}
              classNames={{
                inputWrapper: "h-12 bg-default-100",
                input: "text-sm",
              }}
            />
            <div className="text-xs text-default-500">
              How many option tokens you want to sell
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Receive Token</label>
            <Select
              selectionMode="single"
              selectedKeys={new Set([takerSym])}
              onSelectionChange={handleTakerSymChange}
              classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
            >
              {Object.keys(DECIMALS).map((sym) => (
                <SelectItem key={sym} textValue={sym}>
                  {sym}
                </SelectItem>
              ))}
            </Select>
            <div className="text-xs text-default-500">
              Token you want to receive in exchange
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Total Receive Amount</label>
          <Input
            value={takerAmountStr}
            onChange={(e) => setTakerAmountStr(e.target.value)}
            placeholder={`Amount in ${takerSym}`}
            type="number"
            step="0.01"
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
          <div className="text-xs text-default-500">
            Total amount of {takerSym} you want to receive for all {qtyStr || "0"} options
            {qtyStr && takerAmountStr && (
              <span className="ml-2 font-medium">
                (≈ {(parseFloat(takerAmountStr) / parseFloat(qtyStr || "1")).toFixed(4)} {takerSym} per option)
              </span>
            )}
          </div>
        </div>

        <Button
          color="primary"
          size="lg"
          onPress={onCreate}
          isLoading={submitting}
          isDisabled={
            !isConnected ||
            !isApprovedForProxy ||
            !selectedSeriesId ||
            submitting ||
            !address ||
            !qtyStr ||
            !takerAmountStr ||
            BigInt(qtyStr || "0") > optionBalance ||
            BigInt(qtyStr || "0") <= 0n ||
            !proxyExists
          }
          className="w-full h-14"
        >
          {submitting ? "Creating Order..." : "Create & Sign Limit Order"}
        </Button>
      </div>

      {/* Created Orders */}
      {createdOrders.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-medium">Your Active Orders ({createdOrders.length})</h4>
          <div className="space-y-3">
            {createdOrders.map((orderData) => (
              <div
                key={orderData.hash}
                className="border border-default-200 rounded-lg p-4 space-y-3"
              >
                <div className="flex justify-between items-start">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Order #{orderData.hash.slice(0, 8)}...</span>
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                        Active
                      </span>
                    </div>
                    <div className="text-xs text-default-500">
                      Created: {new Date(orderData.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => onCancelOrder(orderData)}
                  >
                    Cancel
                  </Button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-default-500">Selling</div>
                    <div className="font-medium">{orderData.amount.toString()} options</div>
                  </div>
                  <div>
                    <div className="text-xs text-default-500">Series ID</div>
                    <div className="font-mono text-xs">{orderData.seriesId.toString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-default-500">For</div>
                    <div className="font-medium">
                      {formatUnits(orderData.takerAmount, DECIMALS[orderData.takerToken as TokenSymbol])} {orderData.takerToken}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-default-500">Price per Option</div>
                    <div className="font-medium">
                      {(
                        parseFloat(formatUnits(orderData.takerAmount, DECIMALS[orderData.takerToken as TokenSymbol])) / 
                        parseFloat(orderData.amount.toString())
                      ).toFixed(4)} {orderData.takerToken}
                    </div>
                  </div>
                </div>

                <details className="cursor-pointer">
                  <summary className="text-sm font-medium hover:text-primary">
                    View Technical Details
                  </summary>
                  <div className="mt-3 p-3 bg-default-100 rounded text-xs space-y-2 font-mono">
                    <div className="grid grid-cols-1 gap-1">
                      <div><span className="text-default-600">Order Hash:</span> {orderData.hash}</div>
                      <div><span className="text-default-600">Maker Asset:</span> {orderData.order.makerAsset}</div>
                      <div><span className="text-default-600">Taker Asset:</span> {orderData.order.takerAsset}</div>
                      <div><span className="text-default-600">Making Amount:</span> {orderData.order.makingAmount.toString()}</div>
                      <div><span className="text-default-600">Taking Amount:</span> {orderData.order.takingAmount.toString()}</div>
                      <div><span className="text-default-600">Salt:</span> {orderData.order.salt.toString()}</div>
                    </div>
                    <div className="text-xs text-default-600 bg-default-50 p-2 rounded mt-2 font-sans">
                      💡 This order is live on 1inch Protocol and can be filled by any taker. 
                      The ERC1155TransferProxy handles the conversion between ERC20-style transfers and ERC1155 token movements.
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}