"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
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
  getExpiration,
  allowsPartialFill,
  isOrderActive,
  lopV4Abi,
} from "@/lib/oneInch";
import {
  TOKEN_ADDRESSES,
  erc20Abi,
  CALLTOKEN_ADDRESS,
  ERC1155_PROXY_ADDRESS,
  erc1155Abi,
} from "@/lib/contracts";
import { fetchOrders, markOrderFilled, ApiOrder, OrderFilters } from "@/lib/orderApi";

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

  const { seriesId, hasExtension } = useMemo(
    () => parseERC1155Extension(order.extension),
    [order.extension]
  );

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

    const making = BigInt(order.makingAmount);
    const taking = BigInt(order.takingAmount);
    const pricePerOptionStr =
      making === 0n
        ? "0"
        : (() => {
            try {
              const priceWei = (taking * 10n ** 18n) / making;
              const priceFormatted = formatUnits(priceWei, 18);
              const priceNum = parseFloat(priceFormatted);
              if (priceNum >= 1000) return priceNum.toFixed(0);
              if (priceNum >= 1) return priceNum.toFixed(2);
              if (priceNum >= 0.01) return priceNum.toFixed(4);
              return priceNum.toFixed(6);
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

    const optionsAmountDisplay = formatUnits(making, 0);
    const expiryTrait = BigInt(order.order.makerTraits);
    const expiryTs = Number(getExpiration(expiryTrait)) * 1000;

    const shortSeriesId =
      seriesId.toString().length > 20
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
    if (!address || !writeContractAsync) return;
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
    if (!address || !publicClient || !writeContractAsync) return;
    if (!orderInfo.isActive) {
      addNotice("❌ Order is not active");
      return;
    }

    addNotice(`⏳ Filling ${percent}% of ERC-1155 order ${order.orderHash.slice(0, 10)}...`);

    try {
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

      // Parse extension data for ERC-1155
      let extensionArgs = "0x";
      if (order.extension && order.extension !== "0x") {
        try {
          // The extension contains: abi.encode(token, tokenId, data)
          // For fillOrderArgs, we need to provide these as separate arguments
          // The args parameter should contain the parsed extension data
          extensionArgs = order.extension;
        } catch (error) {
          console.error("Failed to parse extension:", error);
          addNotice("❌ Invalid extension data");
          return;
        }
      }

      // Debug: Log order data for signature verification
      console.log("🔍 Order debug info:", {
        orderHash: order.orderHash,
        orderStruct,
        signature: order.signature,
        extension: order.extension,
        extensionArgs,
        originalOrder: order.order,
        makerAssetIsProxy: orderStruct.makerAsset.toLowerCase() === ERC1155_PROXY_ADDRESS.toLowerCase(),
      });

      // Validate that the order is properly set up for ERC-1155
      if (orderStruct.makerAsset.toLowerCase() !== ERC1155_PROXY_ADDRESS.toLowerCase()) {
        addNotice("❌ Order is not configured for ERC-1155 trading");
        return;
      }

      // Validate extension data format
      if (!order.extension || order.extension === "0x" || order.extension.length < 130) {
        addNotice("❌ Invalid or missing ERC-1155 extension data");
        return;
      }

      // Check if order is still valid before trying to fill
      let remaining: bigint;
      try {
        remaining = await publicClient.readContract({
          address: LOP_V4_ADDRESS,
          abi: lopV4Abi,
          functionName: "remainingWithOrder",
          args: [orderStruct, order.signature as `0x${string}`, order.extension as `0x${string}`],
        });
      } catch (remainingError: any) {
        console.error("remainingWithOrder failed:", remainingError);
        console.log("🔍 Detailed error info:", {
          error: remainingError,
          orderStruct,
          signature: order.signature,
          extension: order.extension,
        });
        
        // Common reasons for remainingWithOrder to fail
        if (remainingError?.message?.includes("expired")) {
          addNotice("❌ Order has expired");
          return;
        }
        if (remainingError?.message?.includes("signature") || remainingError?.message?.includes("ECDSA")) {
          addNotice("❌ Invalid order signature - order may have been created incorrectly");
          console.log("🔍 Signature verification failed. Check order creation process.");
          return;
        }
        if (remainingError?.message?.includes("cancelled")) {
          addNotice("❌ Order has been cancelled");
          return;
        }
        
        // For other errors, provide more info
        addNotice(`❌ Order validation failed: ${remainingError?.shortMessage || "Unknown error"}`);
        return;
      }

      if (remaining === 0n) {
        addNotice("❌ No remaining amount for this order");
        return;
      }

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

      // Handle approval if needed
      if (needsApproval) {
        addNotice(`⏳ Approving ${orderInfo.takerToken}...`);
        try {
          await writeContractAsync({
            address: order.takerAsset as ViemAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [LOP_V4_ADDRESS as ViemAddress, takingAmount * 2n],
          });
          addNotice(`✅ ${orderInfo.takerToken} approved`);
        } catch (approvalError: any) {
          addNotice(`❌ Approval failed: ${approvalError?.shortMessage || "Unknown error"}`);
          return;
        }
      }

      addNotice(`📋 Filling ERC-1155 order for Series ${seriesId.toString()}`);

      // Use fillOrderArgs for ERC-1155 orders with extensions
      const txHash = await writeContractAsync({
        address: LOP_V4_ADDRESS,
        abi: lopV4Abi,
        functionName: "fillOrderArgs",
        args: [
          orderStruct,
          order.signature as `0x${string}`,
          makingAmount,
          takingAmount,
          order.extension as `0x${string}`,
          extensionArgs as `0x${string}`, // Additional args for extension handling
        ],
      });

      addNotice(`🎉 ERC-1155 options purchased! TX: ${txHash.slice(0, 10)}...`);
      await markOrderFilled(order.orderHash, txHash);
      onFilled();
    } catch (error: any) {
      console.error("Fill error:", error);
      
      // Provide more specific error messages
      let errorMessage = "Unknown error";
      if (error?.shortMessage) {
        errorMessage = error.shortMessage;
      } else if (error?.message) {
        if (error.message.includes("insufficient")) {
          errorMessage = "Insufficient balance or allowance";
        } else if (error.message.includes("expired")) {
          errorMessage = "Order has expired";
        } else if (error.message.includes("signature") || error.message.includes("ECDSA")) {
          errorMessage = "Invalid signature - order creation issue";
        } else if (error.message.includes("cancelled")) {
          errorMessage = "Order has been cancelled";
        } else if (error.message.includes("filled")) {
          errorMessage = "Order already filled";
        } else {
          errorMessage = error.message;
        }
      }
      
      addNotice(`❌ Fill failed: ${errorMessage}`);
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
    <div className="p-4 border rounded-lg space-y-3 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 border-gray-200 dark:border-gray-700">
      {/* Order Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">
              Order {order.orderHash.slice(0, 8)}...
            </span>
            <Chip size="sm" color={orderInfo.isActive ? "success" : "warning"} variant="flat">
              {orderInfo.isActive ? "Active" : "Inactive"}
            </Chip>
            {orderInfo.allowsPartial && (
              <Chip size="sm" color="primary" variant="flat">
                Partial Fill
              </Chip>
            )}
          </div>
          <div className="text-xs text-default-500">
            Series: {orderInfo.shortSeriesId} • Maker: {order.order.maker.slice(0, 6)}...{order.order.maker.slice(-4)}
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-sm font-medium">
            {orderInfo.optionsAmountDisplay} options
          </div>
          <div className="text-xs text-default-500">
            for {orderInfo.totalPrice} {orderInfo.takerToken}
          </div>
        </div>
      </div>

      {/* Order Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-default-500">Price per Option</div>
          <div className="font-medium">{orderInfo.pricePerOption} {orderInfo.takerToken}</div>
        </div>
        <div>
          <div className="text-default-500">Total Amount</div>
          <div className="font-medium">{orderInfo.optionsAmountDisplay} options</div>
        </div>
        <div>
          <div className="text-default-500">Total Cost</div>
          <div className="font-medium">{orderInfo.totalPrice} {orderInfo.takerToken}</div>
        </div>
        <div>
          <div className="text-default-500">Expires</div>
          <div className="font-medium">
            {orderInfo.expiry.getTime() > 0 
              ? orderInfo.expiry.toLocaleDateString()
              : "Never"
            }
          </div>
        </div>
      </div>

      {/* Fill Controls */}
      {isConnected && orderInfo.isActive && (
        <div className="flex items-end gap-3 pt-3 border-t border-default-200">
          <div className="flex-1">
            <label className="text-xs text-default-500 mb-1 block">
              Fill Percentage
            </label>
            <Input
              size="sm"
              type="number"
              min="1"
              max="100"
              value={fillPercent}
              onChange={(e) => onChangeFill(order.orderHash, e.target.value)}
              placeholder="100"
              endContent={<span className="text-xs text-default-500">%</span>}
              classNames={{
                inputWrapper: "h-8 min-h-8",
                input: "text-xs"
              }}
            />
          </div>

          {needsApproval && (
            <Button
              size="sm"
              color="warning"
              variant="flat"
              onPress={handleApproval}
              isLoading={isPending}
            >
              Approve {orderInfo.takerToken}
            </Button>
          )}

          <Button
            size="sm"
            color="primary"
            onPress={() => fillOrder(parsedFillPercent)}
            isDisabled={needsApproval || isPending}
            isLoading={isPending}
          >
            Fill Order
          </Button>
        </div>
      )}

      {/* Connection prompt */}
      {!isConnected && (
        <div className="text-xs text-default-500 text-center py-2 border-t border-default-200">
          Connect your wallet to fill this order
        </div>
      )}
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
    setTimeout(() => {
      setNotices((prev) => prev.filter((notice) => !notice.startsWith(`${id}:`)));
    }, 10000);
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { orders: allOrders } = await fetchOrders({ active: false });

      console.log("🔍 All orders from API:", allOrders.length, allOrders);

      const params: OrderFilters = {
        ...filters,
        makerAsset: ERC1155_PROXY_ADDRESS,
        takerAsset:
          selectedToken === "all"
            ? undefined
            : TOKEN_ADDRESSES[selectedToken as keyof typeof TOKEN_ADDRESSES],
      };

      const { orders: fetched } = await fetchOrders(params);

      console.log("🔍 Fetched orders after filter:", fetched.length, fetched);

      const filtered = fetched.filter((o) => {
        const { hasExtension } = parseERC1155Extension(o.extension);
        const makerAssetRaw = o.order?.makerAsset || o.makerAsset || "";
        const isProxyOrder =
          makerAssetRaw.toLowerCase() === ERC1155_PROXY_ADDRESS.toLowerCase();
        
        console.log("🔍 Order filtering debug:", {
          orderHash: o.orderHash,
          extension: o.extension,
          hasExtension,
          makerAssetRaw,
          ERC1155_PROXY_ADDRESS,
          isProxyOrder,
          passesFilter: hasExtension && isProxyOrder,
        });
        
        return hasExtension && isProxyOrder;
      });

      console.log("🔍 Final filtered orders:", filtered.length, filtered);

      setOrders(filtered);

      if (fetched.length > 0 && filtered.length === 0) {
        addNotice("⚠️ Found orders but none match the ERC-1155 proxy filter");
      }
    } catch (error: any) {
      console.error("Failed to load orders:", error);
      addNotice(`❌ Failed to load orders: ${error?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [filters, selectedToken, addNotice]);

  // reload on creation event
  useEffect(() => {
    loadOrders();
    const id = setInterval(loadOrders, 30000);
    const handler = () => {
      loadOrders();
    };
    window.addEventListener("limit-order-created", handler);
    return () => {
      clearInterval(id);
      window.removeEventListener("limit-order-created", handler);
    };
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

  const displayNotices = useMemo(
    () => notices.map((notice) => notice.split(":").slice(1).join(":")),
    [notices]
  );

  return (
    <Card className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Global Options Orderbook
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Browse and buy ERC-1155 call options from all makers on the network
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onPress={loadOrders} isLoading={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Notices */}
      {displayNotices.length > 0 && (
        <div className="space-y-2">
          {displayNotices.map((notice, i) => (
            <div
              key={`${i}-${notice.slice(0, 20)}`}
              className="p-3 text-sm border rounded-lg bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
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

        <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
          <Chip size="sm" variant="flat">
            {orders.length} orders
          </Chip>
          <span>call option orders available</span>
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-sm text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded border border-yellow-200 dark:border-yellow-800">
          💡 Connect your wallet to buy options
        </div>
      )}

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
          <span className="ml-2 text-gray-700 dark:text-gray-300">
            Loading call option orders...
          </span>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center p-8 text-gray-600 dark:text-gray-400">
          <div className="mb-2">No call option orders found</div>
          <div className="text-sm">
            {selectedToken === "all"
              ? "Be the first to create an order or check back later"
              : `No orders found for ${selectedToken}. Try selecting "All Payment Tokens"`}
          </div>
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-left">
            <h5 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
              How the Orderbook Works:
            </h5>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
              <li>Anyone can create limit orders to sell their call options</li>
              <li>All orders from all users appear in this orderbook</li>
              <li>Any connected wallet can buy options from any maker</li>
              <li>Orders remain active until filled, cancelled, or expired</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">
              Available Call Options from All Makers
            </h4>
            <Chip size="sm" color="secondary" variant="flat">
              {orders.length} {orders.length === 1 ? "order" : "orders"}
            </Chip>
            {selectedToken !== "all" && (
              <Chip size="sm" color="primary" variant="flat">
                {selectedToken} only
              </Chip>
            )}
          </div>

          <div className="text-xs text-gray-600 dark:text-gray-400 mb-4 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500"></span>
            <span>
              These are open orders from all users. Connect your wallet to buy any
              available options.
            </span>
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