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
  hasExtension,
} from "@/lib/oneInch";
import {
  TOKEN_ADDRESSES,
  erc20Abi,
  CALLTOKEN_ADDRESS,
  ERC1155_PROXY_ADDRESS,
  lopV4Abi,
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
  isValid: boolean;
} {
  if (!extension || extension === "0x") {
    return { seriesId: 0n, hasExtension: false, isValid: false };
  }

  // Check minimum length for 1inch extension structure
  if (extension.length < 66) { // 0x + 32 bytes (offset table) minimum
    console.log("🔍 Extension too short:", extension.length);
    return { seriesId: 0n, hasExtension: false, isValid: false };
  }

  try {
    // Parse the 1inch extension structure
    // First 32 bytes = offset table, then MakerAssetSuffix
    const offsetTableHex = extension.slice(2, 66); // Remove 0x and get first 32 bytes
    const makerAssetSuffixOffset = parseInt(offsetTableHex.slice(0, 8), 16); // First 4 bytes
    
    console.log("🔍 Extension parsing:", {
      extension: extension.slice(0, 100) + "...",
      extensionLength: extension.length,
      offsetTableHex: offsetTableHex.slice(0, 20) + "...",
      makerAssetSuffixOffset,
    });

    if (makerAssetSuffixOffset === 0) {
      return { seriesId: 0n, hasExtension: false, isValid: false };
    }

    // Extract MakerAssetSuffix data starting at the offset
    const suffixStart = 2 + (makerAssetSuffixOffset * 2); // Convert to hex string position
    const suffixData = extension.slice(suffixStart);
    
    if (suffixData.length < 128) { // Need at least address + uint256 + bytes header
      console.log("🔍 Suffix data too short:", suffixData.length);
      return { seriesId: 0n, hasExtension: false, isValid: false };
    }

    // For our proxy format: abi.encode(address token, uint256 tokenId, bytes data)
    // address = 32 bytes padded, uint256 = 32 bytes, bytes = dynamic
    const tokenHex = suffixData.slice(24, 64); // Skip padding, get address
    const tokenIdHex = suffixData.slice(64, 128); // Get tokenId
    
    const tokenAddress = "0x" + tokenHex;
    const seriesId = BigInt("0x" + tokenIdHex);
    
    console.log("🔍 Parsed extension data:", {
      tokenAddress,
      seriesId: seriesId.toString(),
      expectedTokenAddress: CALLTOKEN_ADDRESS,
      tokenMatches: tokenAddress.toLowerCase() === CALLTOKEN_ADDRESS.toLowerCase(),
    });

    return { 
      seriesId, 
      hasExtension: true, 
      isValid: tokenAddress.toLowerCase() === CALLTOKEN_ADDRESS.toLowerCase() 
    };
  } catch (error) {
    console.error("🔍 Extension parsing error:", error);
    return { seriesId: 0n, hasExtension: false, isValid: false };
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

  const { seriesId, hasExtension: hasExt, isValid } = useMemo(
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
      hasExtension: hasExtension(BigInt(order.order.makerTraits)),
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
    
    addNotice(`⏳ Validating ERC-1155 order ${order.orderHash.slice(0, 10)}...`);

    try {
      // Enhanced validation before processing
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

      // Validate order structure
      if (!orderInfo.isActive) {
        addNotice("❌ Order is not active");
        return;
      }

      if (!orderInfo.hasExtension) {
        addNotice("❌ Order missing HAS_EXTENSION flag");
        return;
      }

      if (!isValid) {
        addNotice("❌ Invalid ERC-1155 extension data");
        return;
      }

      // Check signature format
      if (!order.signature || order.signature.length !== 132) {
        addNotice("❌ Invalid signature format");
        return;
      }

      // Validate extension data format for ERC-1155
      if (!order.extension || order.extension === "0x" || order.extension.length < 130) {
        addNotice("❌ Invalid ERC-1155 extension data");
        return;
      }

      // Validate that the order is properly set up for ERC-1155
      if (orderStruct.makerAsset.toLowerCase() !== ERC1155_PROXY_ADDRESS.toLowerCase()) {
        addNotice("❌ Order is not configured for ERC-1155 trading");
        return;
      }

      console.log("🔍 Pre-fill validation passed:", {
        orderHash: order.orderHash,
        orderStruct,
        signature: order.signature,
        extension: order.extension,
        signatureLength: order.signature.length,
        extensionLength: order.extension.length,
        makerAssetIsProxy: orderStruct.makerAsset.toLowerCase() === ERC1155_PROXY_ADDRESS.toLowerCase(),
        hasValidExtension: isValid,
        seriesId: seriesId.toString(),
        hasExtensionFlag: orderInfo.hasExtension,
      });

      // Check remaining amount with better error handling
      let remaining: bigint;
      try {
        addNotice("🔍 Checking order remaining amount...");
        remaining = await publicClient.readContract({
          address: LOP_V4_ADDRESS,
          abi: lopV4Abi,
          functionName: "remainingWithOrder",
          args: [orderStruct, order.signature as `0x${string}`, order.extension as `0x${string}`],
        });
        
        console.log("🔍 remainingWithOrder success:", {
          remaining: remaining.toString(),
          orderHash: order.orderHash,
        });
        
      } catch (remainingError: any) {
        console.error("remainingWithOrder detailed error:", {
          error: remainingError,
          orderStruct,
          signature: order.signature,
          extension: order.extension,
          rawMessage: remainingError?.message,
          cause: remainingError?.cause,
          shortMessage: remainingError?.shortMessage,
        });
        
        // More specific error messages based on the error type
        if (remainingError?.message?.includes("ECDSA") || remainingError?.message?.includes("signature")) {
          addNotice("❌ Invalid order signature - order was not created properly");
          console.log("🔍 Signature validation failed. Check order creation process.");
        } else if (remainingError?.message?.includes("extension")) {
          addNotice("❌ Invalid extension data for ERC-1155 order");
        } else if (remainingError?.message?.includes("expired")) {
          addNotice("❌ Order has expired");
        } else if (remainingError?.message?.includes("cancelled")) {
          addNotice("❌ Order has been cancelled");
        } else if (remainingError?.shortMessage) {
          addNotice(`❌ Order validation failed: ${remainingError.shortMessage}`);
        } else {
          addNotice(`❌ Order validation failed: ${remainingError?.message || "Unknown error"}`);
        }
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

      // Use fillOrder for ERC-1155 orders
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
        } else if (error.message.includes("extension")) {
          errorMessage = "Invalid ERC-1155 extension data";
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
    orderInfo.hasExtension,
    order,
    needsApproval,
    seriesId,
    isValid,
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
            {!orderInfo.allowsPartial && (
              <Chip size="sm" color="secondary" variant="flat">
                Full Fill Only
              </Chip>
            )}
            {orderInfo.hasExtension && (
              <Chip size="sm" color="success" variant="flat">
                ERC-1155
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
          {orderInfo.allowsPartial ? (
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
          ) : (
            <div className="flex-1 text-xs text-default-500">
              This order must be filled completely (no partial fills allowed)
            </div>
          )}

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
            onPress={() => fillOrder(orderInfo.allowsPartial ? parsedFillPercent : 100)}
            isDisabled={needsApproval || isPending}
            isLoading={isPending}
          >
            Fill Order {!orderInfo.allowsPartial ? "(Full)" : ""}
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
      // First get all orders to see what we have
      const { orders: allOrders } = await fetchOrders({ active: false });

      console.log("🔍 All orders from API:", {
        totalCount: allOrders.length,
        orders: allOrders.map(o => ({
          hash: o.orderHash.slice(0, 8),
          makerAsset: o.order?.makerAsset || o.makerAsset,
          extension: o.extension?.slice(0, 50) + "...",
          extensionLength: o.extension?.length || 0,
        }))
      });

      // Apply filters
      const params: OrderFilters = {
        ...filters,
        makerAsset: ERC1155_PROXY_ADDRESS,
        takerAsset:
          selectedToken === "all"
            ? undefined
            : TOKEN_ADDRESSES[selectedToken as keyof typeof TOKEN_ADDRESSES],
      };

      const { orders: fetched } = await fetchOrders(params);

      console.log("🔍 Fetched orders after makerAsset filter:", {
        count: fetched.length,
        filterMakerAsset: ERC1155_PROXY_ADDRESS,
        orders: fetched.map(o => ({
          hash: o.orderHash.slice(0, 8),
          makerAsset: o.order?.makerAsset || o.makerAsset,
          extension: o.extension?.slice(0, 50) + "...",
          extensionLength: o.extension?.length || 0,
        }))
      });

      // Additional filtering for ERC-1155 validity
      const filtered = fetched.filter((o) => {
        const { hasExtension, isValid } = parseERC1155Extension(o.extension);
        const makerAssetRaw = o.order?.makerAsset || o.makerAsset || "";
        const isProxyOrder = makerAssetRaw.toLowerCase() === ERC1155_PROXY_ADDRESS.toLowerCase();
        const makerTraits = BigInt(o.order?.makerTraits || "0");
        const hasExtensionFlag = (makerTraits & (1n << 255n)) !== 0n;
        
        console.log("🔍 Order detailed filtering:", {
          orderHash: o.orderHash.slice(0, 8),
          extension: o.extension?.slice(0, 50) + "...",
          extensionLength: o.extension?.length || 0,
          hasExtension,
          isValid,
          makerAssetRaw,
          ERC1155_PROXY_ADDRESS,
          isProxyOrder,
          makerTraits: makerTraits.toString(),
          hasExtensionFlag,
          passesAllFilters: hasExtension && isValid && isProxyOrder && hasExtensionFlag,
        });
        
        return hasExtension && isValid && isProxyOrder && hasExtensionFlag;
      });

      console.log("🔍 Final filtered orders:", {
        originalCount: allOrders.length,
        afterMakerAssetFilter: fetched.length,
        afterERC1155Filter: filtered.length,
        filtered: filtered.map(o => ({
          hash: o.orderHash.slice(0, 8),
          extension: o.extension?.slice(0, 50) + "...",
        }))
      });

      setOrders(filtered);

      if (allOrders.length > 0 && filtered.length === 0) {
        if (fetched.length === 0) {
          addNotice(`⚠️ Found ${allOrders.length} orders but none have makerAsset=${ERC1155_PROXY_ADDRESS.slice(0, 8)}...`);
        } else {
          addNotice(`⚠️ Found ${fetched.length} proxy orders but none have valid ERC-1155 extensions with HAS_EXTENSION flag`);
        }
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
          <span>ERC-1155 call option orders available</span>
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-sm text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded border border-yellow-200 dark:border-yellow-800">
          💡 Connect your wallet to buy options
        </div>
      )}

      {/* Debug Information */}
      <details className="cursor-pointer">
        <summary className="text-sm text-default-500 hover:text-default-700">
          🔍 Debug Information (Click to expand)
        </summary>
        <div className="mt-3 p-3 bg-default-100 rounded text-xs space-y-2">
          <div><strong>ERC1155 Proxy Address:</strong> {ERC1155_PROXY_ADDRESS}</div>
          <div><strong>CallToken Address:</strong> {CALLTOKEN_ADDRESS}</div>
          <div><strong>Current Filters:</strong> {JSON.stringify(filters)}</div>
          <div><strong>Selected Token:</strong> {selectedToken}</div>
          <div className="text-default-600 mt-2">
            <strong>Filter Requirements:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>makerAsset must equal {ERC1155_PROXY_ADDRESS.slice(0, 8)}...</li>
              <li>Extension must be valid 1inch format (length ≥66)</li>
              <li>Extension must contain valid token data</li>
              <li>makerTraits must have HAS_EXTENSION flag (bit 255)</li>
              <li>Token in extension must match {CALLTOKEN_ADDRESS.slice(0, 8)}...</li>
            </ul>
          </div>
        </div>
      </details>

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
          <div className="mb-2">No ERC-1155 call option orders found</div>
          <div className="text-sm">
            {selectedToken === "all"
              ? "Create an ERC-1155 order or check back later"
              : `No orders found for ${selectedToken}. Try selecting "All Payment Tokens"`}
          </div>
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-left">
            <h5 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
              How ERC-1155 Orders Work:
            </h5>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
              <li>Orders must use the ERC1155TransferProxy as makerAsset</li>
              <li>Extension data must contain token address, tokenId, and data</li>
              <li>HAS_EXTENSION flag (bit 255) must be set in makerTraits</li>
              <li>Extension hash must be included in the order salt</li>
              <li>Your proxy contract handles the ERC20→ERC1155 conversion</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">
              Available ERC-1155 Call Options
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
              These are valid ERC-1155 orders from all users. Connect your wallet to buy any
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