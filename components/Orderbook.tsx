"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { Address as ViemAddress, formatUnits } from "viem";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { Input } from "@heroui/input";
import { Spinner } from "@heroui/spinner";
import { Chip } from "@heroui/chip";
import { Tooltip } from "@heroui/tooltip";

import {
  LOP_V4_ADDRESS,
  lopV4Abi,
  getExpiration,
  allowsPartialFill,
  isOrderActive,
} from "@/lib/oneInch";
import {
  TOKEN_ADDRESSES,
  erc20Abi,
  CALLTOKEN_ADDRESS,
  ERC1155_PROXY_ADDRESS,
  erc1155Abi,
} from "@/lib/contracts";
import { fetchOrders, markOrderFilled, ApiOrder, OrderFilters } from "@/lib/orderApi";

// minimal safe decimal fallback map for display purposes
const DECIMALS: Record<string, number> = {
  WXDAI: 18,
  USDC: 6,
  WETH: 18,
  GNO: 18,
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

function getTokenSymbol(address: string): string {
  const entry = Object.entries(TOKEN_ADDRESSES).find(
    ([_, addr]) => addr.toLowerCase() === address.toLowerCase()
  );
  return entry?.[0] || "Unknown";
}

// Parse ERC-1155 extension data to extract series ID
function parseERC1155Extension(extension: string): {
  seriesId: bigint;
  hasExtension: boolean;
} {
  if (!extension || extension === "0x" || extension.length < 66) {
    return { seriesId: 0n, hasExtension: false };
  }
  try {
    const seriesId = BigInt("0x" + extension.slice(2, 66));
    return { seriesId, hasExtension: true };
  } catch {
    return { seriesId: 0n, hasExtension: false };
  }
}

type OrderRowProps = {
  order: ApiOrder;
  fillPercent: string;
  onChangeFill: (hash: string, val: string) => void;
  onFilled: () => void;
  addNotice: (msg: string) => void;
};

function OrderRow({ order, fillPercent, onChangeFill, onFilled, addNotice }: OrderRowProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();

  const { seriesId, hasExtension } = useMemo(() => 
    parseERC1155Extension(order.extension), 
    [order.extension]
  );

  // Payment token allowance check
  const { data: allowance = 0n } = useReadContract({
    address: order.takerAsset as ViemAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address as ViemAddress, LOP_V4_ADDRESS as ViemAddress],
    query: { enabled: Boolean(address) },
  });

  const orderInfo = useMemo(() => {
    const takerToken = getTokenSymbol(order.takerAsset);
    const decimals = DECIMALS[takerToken as keyof typeof DECIMALS] ?? 18;
    
    // safer price representation: avoid Number conversion
    const making = BigInt(order.makingAmount);
    const taking = BigInt(order.takingAmount);
    
    // Better price calculation - handle decimals properly
    const pricePerOptionStr = making === 0n ? "0" : (() => {
      try {
        // Convert to proper decimal representation
        const priceWei = (taking * 10n ** 18n) / making; // Scale up to avoid precision loss
        const priceFormatted = formatUnits(priceWei, 18);
        const priceNum = parseFloat(priceFormatted);
        
        if (priceNum >= 1000) {
          return priceNum.toFixed(0);
        } else if (priceNum >= 1) {
          return priceNum.toFixed(2);
        } else if (priceNum >= 0.01) {
          return priceNum.toFixed(4);
        } else {
          return priceNum.toFixed(6);
        }
      } catch {
        return "0";
      }
    })();

    const totalPrice = (() => {
      try {
        const formatted = formatUnits(taking, decimals);
        const num = parseFloat(formatted);
        if (num >= 1000) return num.toFixed(0);
        if (num >= 1) return num.toFixed(2);
        if (num >= 0.001) return num.toFixed(4);
        return num.toFixed(6);
      } catch {
        return "0";
      }
    })();

    const optionsAmountDisplay = formatUnits(making, 0); // assuming options are integer counts
    const expiryTs = Number(getExpiration(BigInt(order.order.makerTraits))) * 1000;
    
    // Format series ID for better display
    const shortSeriesId = seriesId.toString().length > 20 
      ? `${seriesId.toString().slice(0, 8)}...${seriesId.toString().slice(-8)}`
      : seriesId.toString();
    
    return {
      takerToken,
      decimals,
      pricePerOption: pricePerOptionStr,
      totalPrice,
      optionsAmountDisplay,
      expiry: new Date(expiryTs),
      allowsPartial: allowsPartialFill(BigInt(order.order.makerTraits)),
      isActive: isOrderActive(BigInt(order.order.makerTraits)),
      seriesId: seriesId.toString(),
      shortSeriesId,
      making,
      taking,
    };
  }, [order, seriesId]);

  const needsApproval = allowance < BigInt(order.takingAmount);
  
  const parsedFillPercent = useMemo(() => {
    const n = parseInt(fillPercent, 10);
    if (isNaN(n) || n <= 0) return 100;
    if (n > 100) return 100;
    return n;
  }, [fillPercent]);

  const handleApproval = useCallback(async () => {
    if (!address) return;
    
    try {
      addNotice(`⏳ Approving ${orderInfo.takerToken}...`);
      await writeContractAsync({
        address: order.takerAsset as ViemAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [LOP_V4_ADDRESS as ViemAddress, 2n ** 256n - 1n],
      });
      addNotice(`✅ ${orderInfo.takerToken} approved`);
    } catch (error: any) {
      addNotice(`❌ Approval failed: ${error?.shortMessage || error?.message || "Unknown error"}`);
    }
  }, [address, order.takerAsset, orderInfo.takerToken, writeContractAsync, addNotice]);

  const fillOrder = useCallback(async (percent: number) => {
    if (!address || !publicClient) return;
    if (!orderInfo.isActive) {
      addNotice("❌ Order is not active");
      return;
    }

    addNotice(`⏳ Filling ${percent}% of ERC-1155 order ${order.orderHash.slice(0, 10)}...`);

    try {
      // Build the full order struct for 1inch
      const orderStruct = {
        salt: BigInt(order.order.salt),
        maker: order.order.maker as ViemAddress,
        receiver: order.order.receiver as ViemAddress,
        makerAsset: order.order.makerAsset as ViemAddress,
        takerAsset: order.takerAsset as ViemAddress,
        makingAmount: BigInt(order.makingAmount),
        takingAmount: BigInt(order.takingAmount),
        makerTraits: BigInt(order.order.makerTraits),
      };

      // Check remaining fillable amount
      const remaining = await publicClient.readContract({
        address: LOP_V4_ADDRESS,
        abi: lopV4Abi,
        functionName: "remainingWithOrder",
        args: [orderStruct, order.signature as `0x${string}`, order.extension as `0x${string}`],
      });

      if (remaining === 0n) {
        addNotice("❌ No remaining amount for this order");
        return;
      }

      // Calculate fill amounts based on remaining
      const maxMakingAmount = remaining;
      const maxTakingAmount = (BigInt(order.takingAmount) * remaining) / BigInt(order.makingAmount);

      const makingAmount =
        percent < 100
          ? (maxMakingAmount * BigInt(percent)) / 100n
          : maxMakingAmount;
      const takingAmount =
        percent < 100
          ? (maxTakingAmount * BigInt(percent)) / 100n
          : maxTakingAmount;

      // Approve payment token if needed
      if (needsApproval) {
        addNotice(`⏳ Approving ${orderInfo.takerToken}...`);
        await writeContractAsync({
          address: order.takerAsset as ViemAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [LOP_V4_ADDRESS as ViemAddress, takingAmount * 2n],
        });
        addNotice(`✅ ${orderInfo.takerToken} approved`);
      }

      addNotice(`📋 Filling ERC-1155 order for Series ${seriesId.toString()}`);

      const txHash = await writeContractAsync({
        address: LOP_V4_ADDRESS,
        abi: lopV4Abi,
        functionName: "fillOrder",
        args: [
          orderStruct,
          order.signature as `0x${string}`,
          makingAmount,
          takingAmount,
          order.extension as `0x${string}`,
        ],
      });

      addNotice(`🎉 ERC-1155 options purchased! TX: ${txHash.slice(0, 10)}...`);
      await markOrderFilled(order.orderHash, txHash);
      onFilled();
    } catch (error: any) {
      console.error("Fill error:", error);
      addNotice(`❌ Fill failed: ${error?.shortMessage || error?.message || "Unknown error"}`);
    }
  }, [
    address,
    publicClient,
    orderInfo.isActive,
    orderInfo.takerToken,
    order,
    needsApproval,
    seriesId,
    writeContractAsync,
    addNotice,
    onFilled,
  ]);

  return (
    <div className="p-4 border rounded-lg space-y-3 bg-gradient-to-r from-secondary-50 to-primary-50">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-lg">{orderInfo.optionsAmountDisplay} Call Options</span>
            <Chip size="sm" color="secondary" variant="flat">
              Series {orderInfo.shortSeriesId}
            </Chip>
            <Chip size="sm" color="primary" variant="flat">
              {orderInfo.takerToken}
            </Chip>
            {order.cancelled && (
              <Chip size="sm" color="danger" variant="flat">
                Cancelled
              </Chip>
            )}
            {order.filled && (
              <Chip size="sm" color="success" variant="flat">
                Filled
              </Chip>
            )}
            {!orderInfo.isActive && (
              <Chip size="sm" color="warning" variant="flat">
                Inactive
              </Chip>
            )}
          </div>

          <div className="text-sm text-default-600 space-y-1">
            <div className="font-medium">
              Price: {orderInfo.pricePerOption} {orderInfo.takerToken} per option
            </div>
            <div>
              Total Cost: {orderInfo.totalPrice} {orderInfo.takerToken}
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Info tip="These are ERC-1155 call option tokens that can be exercised if profitable" />
              <span>ERC-1155 Call Options</span>
            </div>
          </div>
        </div>

        <div className="text-right text-xs text-default-500 space-y-1">
          <div>Expires: {orderInfo.expiry.toLocaleString()}</div>
          <div>Maker: {order.maker.slice(0, 8)}…</div>
          {orderInfo.allowsPartial && <div className="text-success">Partial fills allowed</div>}
          <div className="text-secondary font-medium">
            <Tooltip content={`Full Series ID: ${orderInfo.seriesId}`} placement="left">
              <span className="cursor-help">Series: {orderInfo.shortSeriesId}</span>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Fill Controls */}
      {!order.filled && !order.cancelled && orderInfo.isActive && isConnected && (
        <div className="flex gap-2 items-end flex-wrap">
          {orderInfo.allowsPartial && (
            <Input
              type="number"
              label="Fill %"
              value={fillPercent}
              onChange={(e) => onChangeFill(order.orderHash, e.target.value)}
              endContent="%"
              className="w-32"
              min="1"
              max="100"
              size="sm"
            />
          )}

          <div className="flex gap-2">
            <Button 
              size="sm" 
              color="primary" 
              onPress={() => fillOrder(parsedFillPercent)}
              isLoading={isPending}
              isDisabled={isPending}
            >
              {isPending ? "Processing..." : "Buy Options"}
            </Button>

            {needsApproval && (
              <Button
                size="sm"
                variant="flat"
                onPress={handleApproval}
                isLoading={isPending}
                isDisabled={isPending}
              >
                Approve {orderInfo.takerToken}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Order Technical Details */}
      <details className="cursor-pointer">
        <summary className="text-xs text-default-500 hover:text-default-700">
          Technical Details
        </summary>
        <div className="mt-2 p-3 bg-default-100 rounded text-xs font-mono space-y-1">
          <div>
            <strong>Order Hash:</strong> {order.orderHash}
          </div>
          <div>
            <strong>ERC-1155 Contract:</strong> {order.order.makerAsset}
          </div>
          <div>
            <strong>Payment Token:</strong> {order.takerAsset}
          </div>
          <div>
            <strong>Options Amount:</strong> {orderInfo.optionsAmountDisplay}
          </div>
          <div>
            <strong>Payment Required:</strong> {orderInfo.totalPrice} {orderInfo.takerToken}
          </div>
          <div>
            <strong>Series ID:</strong> {orderInfo.seriesId}
          </div>
          <div>
            <strong>Maker Traits:</strong> {order.order.makerTraits}
          </div>
          {hasExtension && (
            <div>
              <strong>Extension:</strong> {order.extension.slice(0, 20)}...
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export default function Orderbook() {
  const { isConnected } = useAccount();

  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<string[]>([]);
  const [filters, setFilters] = useState<OrderFilters>({ active: true });
  const [selectedToken, setSelectedToken] = useState<string>("all");
  const [fillPercents, setFillPercents] = useState<Record<string, string>>({});

  const addNotice = useCallback((msg: string) => {
    const id = Date.now().toString();
    setNotices((n) => [...n, `${id}:${msg}`]);
    
    // Auto-clear after 10 seconds
    setTimeout(() => {
      setNotices((prev) => prev.filter((notice) => !notice.startsWith(`${id}:`)));
    }, 10000);
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: OrderFilters = {
        ...filters,
        makerAsset: ERC1155_PROXY_ADDRESS, // Use the transfer proxy address
        takerAsset:
          selectedToken === "all"
            ? undefined
            : TOKEN_ADDRESSES[selectedToken as keyof typeof TOKEN_ADDRESSES],
      };
      const { orders: fetched } = await fetchOrders(params);
      
      // only keep orders with valid extension (i.e., ERC-1155 series)
      const filtered = fetched.filter((o) => {
        const { hasExtension } = parseERC1155Extension(o.extension);
        return hasExtension;
      });
      
      setOrders(filtered);
    } catch (error: any) {
      console.error("Failed to load orders:", error);
      addNotice(`❌ Failed to load orders: ${error?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [filters, selectedToken, addNotice]);

  useEffect(() => {
    loadOrders();
    const id = setInterval(loadOrders, 30000);
    return () => clearInterval(id);
  }, [loadOrders]);

  const handleFillChange = useCallback((hash: string, val: string) => {
    setFillPercents((prev) => ({ ...prev, [hash]: val }));
  }, []);

  const handleOrderFilled = useCallback(() => {
    loadOrders();
    addNotice("📈 Options purchased successfully! Refreshing orderbook...");
  }, [loadOrders, addNotice]);

  const toggleActiveFilter = useCallback(() => {
    setFilters((f) => ({ ...f, active: !f.active }));
  }, []);

  const handleTokenSelection = useCallback((keys: any) => {
    const selectedKey = [...keys][0] as string;
    setSelectedToken(selectedKey);
  }, []);

  const displayNotices = useMemo(() => 
    notices.map(notice => notice.split(':').slice(1).join(':')), 
    [notices]
  );

  return (
    <Card className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold">Call Options Orderbook</h3>
          <p className="text-sm text-default-600">
            Buy ERC-1155 call options with your preferred payment token
          </p>
        </div>
        <Button size="sm" onPress={loadOrders} isLoading={loading}>
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* Notices */}
      {displayNotices.length > 0 && (
        <div className="space-y-2">
          {displayNotices.map((notice, i) => (
            <div
              key={`${i}-${notice.slice(0, 20)}`}
              className="p-3 text-sm border rounded-lg bg-amber-50 border-amber-200 text-amber-800"
            >
              {notice}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="max-w-xs">
          <Select
            label="Payment Token"
            selectedKeys={new Set([selectedToken])}
            onSelectionChange={handleTokenSelection}
            size="sm"
          >
            <SelectItem key="all" textValue="All Payment Tokens">
              All Payment Tokens
            </SelectItem>
            {Object.keys(DECIMALS).map((sym) => (
              <SelectItem key={sym} textValue={sym}>
                {sym}
              </SelectItem>
            ))}
          </Select>
        </div>

        <Button
          size="sm"
          variant={filters.active ? "solid" : "flat"}
          color={filters.active ? "primary" : "default"}
          onPress={toggleActiveFilter}
        >
          {filters.active ? "Active Orders" : "All Orders"}
        </Button>

        <div className="text-xs text-default-500 flex items-center gap-2">
          <Chip size="sm" variant="flat">
            {orders.length} orders
          </Chip>
          <span>call option orders available</span>
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-sm text-yellow-600 bg-yellow-50 p-3 rounded border border-yellow-200">
          💡 Connect your wallet to buy options
        </div>
      )}

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
          <span className="ml-2">Loading call option orders...</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center p-8 text-default-500">
          <div className="mb-2">No call option orders found</div>
          <div className="text-sm">
            {selectedToken === "all" 
              ? "Try adjusting your filters or check back later" 
              : `No orders found for ${selectedToken}. Try selecting "All Payment Tokens"`
            }
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="font-medium">Available Call Options</h4>
            <Chip size="sm" color="secondary" variant="flat">
              {orders.length} orders
            </Chip>
            {selectedToken !== "all" && (
              <Chip size="sm" color="primary" variant="flat">
                {selectedToken} only
              </Chip>
            )}
          </div>

          {orders.map((order) => (
            <OrderRow
              key={order.orderHash}
              order={order}
              fillPercent={fillPercents[order.orderHash] || "100"}
              onChangeFill={handleFillChange}
              onFilled={handleOrderFilled}
              addNotice={addNotice}
            />
          ))}
        </div>
      )}
    </Card>
  );
}