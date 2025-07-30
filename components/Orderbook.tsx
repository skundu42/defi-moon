// components/Orderbook.tsx
"use client";

import React, { useState, useEffect } from "react";
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

const DECIMALS: Record<string, number> = {
  WXDAI: 18,
  USDC: 6,
  WETH: 18,
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
    // Extract series ID from extension (first 32 bytes after 0x)
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
  const { writeContractAsync } = useWriteContract();

  const { seriesId, hasExtension } = parseERC1155Extension(order.extension);

  // Payment token allowance check
  const { data: allowance = 0n } = useReadContract({
    address: order.takerAsset as ViemAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address as ViemAddress, LOP_V4_ADDRESS as ViemAddress],
    query: { enabled: Boolean(address) },
  });

  const takerToken = getTokenSymbol(order.takerAsset);
  const decimals = DECIMALS[takerToken] || 18;
  const pricePerOption = Number(order.takingAmount) / Number(order.makingAmount);
  const info = {
    takerToken,
    pricePerOption: formatUnits(BigInt(Math.floor(pricePerOption)), decimals),
    totalPrice: formatUnits(BigInt(order.takingAmount), decimals),
    expiry: new Date(Number(getExpiration(BigInt(order.order.makerTraits))) * 1000),
    allowsPartial: allowsPartialFill(BigInt(order.order.makerTraits)),
    isActive: isOrderActive(BigInt(order.order.makerTraits)),
    seriesId: seriesId.toString(),
  };

  const needsApproval = allowance < BigInt(order.takingAmount);

  const fillOrder = async (percent: number) => {
    if (!address || !publicClient) return;
    if (!info.isActive) {
      addNotice("❌ Order is not active");
      return;
    }

    addNotice(`⏳ Filling ${percent}% of ERC-1155 order ${order.orderHash}...`);
    
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
      
      const makingAmount = percent < 100
        ? (maxMakingAmount * BigInt(percent)) / 100n
        : maxMakingAmount;
      const takingAmount = percent < 100
        ? (maxTakingAmount * BigInt(percent)) / 100n
        : maxTakingAmount;

      // Approve payment token if needed
      if (needsApproval) {
        addNotice(`⏳ Approving ${takerToken}...`);
        await writeContractAsync({
          address: order.takerAsset as ViemAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [LOP_V4_ADDRESS as ViemAddress, takingAmount * 2n], // Approve extra for safety
        });
        addNotice(`✅ ${takerToken} approved`);
      }

      addNotice(`📋 Filling ERC-1155 order for Series ${seriesId}`);
      
      // Execute ERC-1155 fill with extension data
      const txHash = await writeContractAsync({
        address: LOP_V4_ADDRESS,
        abi: lopV4Abi,
        functionName: "fillOrder",
        args: [
          orderStruct,
          order.signature as `0x${string}`,
          makingAmount,
          takingAmount,
          order.extension as `0x${string}`, // Extension contains ERC-1155 proxy data
        ],
      });

      addNotice(`🎉 ERC-1155 options purchased! TX: ${txHash}`);
      await markOrderFilled(order.orderHash, txHash);
      onFilled();
    } catch (e: any) {
      addNotice(`❌ Fill failed: ${e.shortMessage || e.message}`);
      console.error("Fill error:", e);
    }
  };

  return (
    <div className="p-4 border rounded-lg space-y-3 bg-gradient-to-r from-secondary-50 to-primary-50">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-lg">{order.makingAmount} Call Options</span>
            <Chip size="sm" color="secondary" variant="flat">
              Series {info.seriesId}
            </Chip>
            <Chip size="sm" color="primary" variant="flat">{info.takerToken}</Chip>
            {order.cancelled && <Chip size="sm" color="danger" variant="flat">Cancelled</Chip>}
            {order.filled && <Chip size="sm" color="success" variant="flat">Filled</Chip>}
            {!info.isActive && <Chip size="sm" color="warning" variant="flat">Inactive</Chip>}
          </div>
          
          <div className="text-sm text-default-600 space-y-1">
            <div className="font-medium">
              Price: {info.pricePerOption} {info.takerToken} per option
            </div>
            <div>
              Total Cost: {info.totalPrice} {info.takerToken}
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Info tip="These are ERC-1155 call option tokens that can be exercised if profitable" />
              <span>ERC-1155 Call Options</span>
            </div>
          </div>
        </div>
        
        <div className="text-right text-xs text-default-500 space-y-1">
          <div>Expires: {info.expiry.toLocaleString()}</div>
          <div>Maker: {order.maker.slice(0, 8)}…</div>
          {info.allowsPartial && <div className="text-success">Partial fills allowed</div>}
          <div className="text-secondary font-medium">Series ID: {info.seriesId}</div>
        </div>
      </div>

      {/* Fill Controls */}
      {!order.filled && !order.cancelled && info.isActive && isConnected && (
        <div className="flex gap-2 items-end">
          {info.allowsPartial && (
            <Input
              type="number"
              label="Fill %"
              value={fillPercent}
              onChange={(e) => onChangeFill(order.orderHash, e.target.value)}
              endContent="%"
              className="w-32"
              min="1"
              max="100"
            />
          )}
          
          <div className="flex gap-2">
            <Button
              size="sm"
              color="primary"
              onPress={() => fillOrder(parseInt(fillPercent))}
            >
              Buy Options
            </Button>
            
            {needsApproval && (
              <Button
                size="sm"
                variant="flat"
                onPress={async () => {
                  try {
                    await writeContractAsync({
                      address: order.takerAsset as ViemAddress,
                      abi: erc20Abi,
                      functionName: "approve",
                      args: [LOP_V4_ADDRESS as ViemAddress, 2n ** 256n - 1n],
                    });
                    addNotice(`✅ ${takerToken} approved`);
                  } catch (e: any) {
                    addNotice(`❌ Approval failed: ${e.message}`);
                  }
                }}
              >
                Approve {takerToken}
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
          <div><strong>Order Hash:</strong> {order.orderHash}</div>
          <div><strong>ERC-1155 Contract:</strong> {order.order.makerAsset}</div>
          <div><strong>Payment Token:</strong> {order.takerAsset}</div>
          <div><strong>Options Amount:</strong> {order.makingAmount}</div>
          <div><strong>Payment Required:</strong> {order.takingAmount}</div>
          <div><strong>Series ID:</strong> {info.seriesId}</div>
          <div><strong>Maker Traits:</strong> {order.order.makerTraits}</div>
          {hasExtension && (
            <div><strong>Extension:</strong> {order.extension.slice(0, 20)}...</div>
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

  const addNotice = (msg: string) => {
    setNotices((n) => [...n, msg]);
    // Auto-remove notices after 10 seconds
    setTimeout(() => {
      setNotices((prev) => prev.filter((notice) => notice !== msg));
    }, 10000);
  };

  const loadOrders = async () => {
    setLoading(true);
    try {
      const params: OrderFilters = {
        ...filters,
        // Filter for ERC-1155 call token orders
        makerAsset: CALLTOKEN_ADDRESS,
        takerAsset:
          selectedToken === "all"
            ? undefined
            : TOKEN_ADDRESSES[selectedToken as keyof typeof TOKEN_ADDRESSES],
      };
      const { orders } = await fetchOrders(params);
      setOrders(orders);
      addNotice(`📊 Loaded ${orders.length} call option orders`);
    } catch (e: any) {
      addNotice(`❌ Failed to load orders: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const id = setInterval(loadOrders, 30000); // Refresh every 30 seconds
    return () => clearInterval(id);
  }, [selectedToken, filters.active]);

  const handleFillChange = (hash: string, val: string) => {
    setFillPercents((prev) => ({ ...prev, [hash]: val }));
  };

  const handleOrderFilled = () => {
    loadOrders();
    addNotice("📈 Options purchased successfully! Refreshing orderbook...");
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Call Options Orderbook</h3>
          <p className="text-sm text-default-500">
            Buy ERC-1155 call options with your preferred payment token
          </p>
        </div>
        <Button size="sm" onPress={loadOrders} isLoading={loading}>
          Refresh
        </Button>
      </div>

      {/* Notices */}
      {notices.map((n, i) => (
        <div key={i} className="p-3 text-sm border rounded-lg bg-warning-50 border-warning-200 text-warning-800">
          {n}
        </div>
      ))}

      {/* Filters */}
      <div className="flex gap-3 items-end">
        <Select
          label="Payment Token"
          selectedKeys={new Set([selectedToken])}
          onSelectionChange={(keys) => setSelectedToken([...keys][0] as string)}
          className="max-w-xs"
        >
          <SelectItem key="all" value="all">All Payment Tokens</SelectItem>
          {Object.keys(DECIMALS).map((sym) => (
            <SelectItem key={sym} value={sym}>{sym}</SelectItem>
          ))}
        </Select>
        
        <Button
          size="sm"
          variant={filters.active ? "solid" : "flat"}
          color={filters.active ? "primary" : "default"}
          onPress={() => setFilters((f) => ({ ...f, active: !f.active }))}
        >
          {filters.active ? "Active Orders" : "All Orders"}
        </Button>

        <div className="text-xs text-default-500">
          {orders.length} call option orders available
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
          <span className="ml-2">Loading call option orders...</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center p-8 text-default-500">
          <div className="mb-2">No call option orders found</div>
          <div className="text-sm">Try adjusting your payment token filter or check back later</div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="font-medium">Available Call Options</h4>
            <Chip size="sm" color="secondary" variant="flat">
              {orders.length} orders
            </Chip>
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

      {/* Instructions */}
      <div className="mt-6 p-4 bg-gradient-to-r from-secondary-50 to-primary-50 rounded-lg space-y-3">
        <h4 className="font-medium">How to buy call options:</h4>
        <ol className="text-sm space-y-2 list-decimal list-inside">
          <li><strong>Browse available orders</strong> - Each order represents call options for a specific series</li>
          <li><strong>Check the series details</strong> - Review the series ID, strike price, and expiry date</li>
          <li><strong>Choose your payment token</strong> - Use the filter to find orders accepting your preferred token</li>
          <li><strong>Approve your payment token</strong> - One-time approval for the 1inch contract</li>
          <li><strong>Buy the options</strong> - Click "Buy Options" to execute the trade</li>
          <li><strong>Exercise when profitable</strong> - Use the settlement section to exercise options after expiry</li>
        </ol>
        
        <div className="pt-3 border-t border-default-200">
          <div className="flex items-center gap-1 text-xs text-default-600">
            <Info tip="All transactions are executed via 1inch Limit Order Protocol v4 with ERC-1155 proxy support" />
            <span>Powered by 1inch Limit Order Protocol v4 • ERC-1155 Compatible • Gas Optimized</span>
          </div>
        </div>
      </div>
    </Card>
  );
}