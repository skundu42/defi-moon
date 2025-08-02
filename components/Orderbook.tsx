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
  if (extension.length < 66) {
    return { seriesId: 0n, hasExtension: false, isValid: false };
  }

  try {
    // Parse the 1inch extension structure
    const offsetTableHex = extension.slice(2, 66);
    const makerAssetSuffixOffset = parseInt(offsetTableHex.slice(0, 8), 16);
    
    if (makerAssetSuffixOffset === 0) {
      return { seriesId: 0n, hasExtension: false, isValid: false };
    }

    const suffixStart = 2 + (makerAssetSuffixOffset * 2);
    const suffixData = extension.slice(suffixStart);
    
    if (suffixData.length < 128) {
      return { seriesId: 0n, hasExtension: false, isValid: false };
    }

    const tokenHex = suffixData.slice(24, 64);
    const tokenIdHex = suffixData.slice(64, 128);
    
    const tokenAddress = "0x" + tokenHex;
    const seriesId = BigInt("0x" + tokenIdHex);
    
    return { 
      seriesId, 
      hasExtension: true, 
      isValid: tokenAddress.toLowerCase() === CALLTOKEN_ADDRESS.toLowerCase() 
    };
  } catch (error) {
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
    () => parseERC1155Extension(order.extension || "0x"),
    [order.extension]
  );

  // Safe access to order properties with fallbacks
  const takerAssetAddress = useMemo(() => {
    return (order.order?.takerAsset || order.takerAsset) as ViemAddress;
  }, [order]);

  const { data: allowance = 0n, refetch: refetchAllowance } = useReadContract({
    address: takerAssetAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address as ViemAddress, LOP_V4_ADDRESS as ViemAddress],
    query: { enabled: Boolean(address && takerAssetAddress) },
  });

  const orderInfo = useMemo(() => {
    const takerToken = getTokenSymbol(takerAssetAddress);
    const decimals = DECIMALS[takerToken as keyof typeof DECIMALS] ?? 18;

    // Safe BigInt parsing with fallbacks
    const making = (() => {
      try {
        return BigInt(order.makingAmount || order.order?.makingAmount || "0");
      } catch {
        return 0n;
      }
    })();

    const taking = (() => {
      try {
        return BigInt(order.takingAmount || order.order?.takingAmount || "0");
      } catch {
        return 0n;
      }
    })();

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
    
    // Safe makerTraits parsing
    const makerTraits = (() => {
      try {
        return BigInt(order.order?.makerTraits || "0");
      } catch {
        return 0n;
      }
    })();

    const expiryTs = Number(getExpiration(makerTraits)) * 1000;

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
      allowsPartial: allowsPartialFill(makerTraits),
      isActive: isOrderActive(makerTraits),
      hasExtension: hasExtension(makerTraits),
      seriesId: seriesId.toString(),
      shortSeriesId,
      making,
      taking,
      makerTraits,
    };
  }, [order, seriesId, takerAssetAddress]);

  const needsApproval = useMemo(() => {
    try {
      return allowance < orderInfo.taking;
    } catch {
      return true;
    }
  }, [allowance, orderInfo.taking]);

  const parsedFillPercent = useMemo(() => {
    const n = parseInt(fillPercent, 10);
    if (isNaN(n) || n <= 0) return 100;
    if (n > 100) return 100;
    return n;
  }, [fillPercent]);

  const handleApproval = useCallback(async () => {
    if (!address || !writeContractAsync || !takerAssetAddress) return;
    try {
      addNotice(`⏳ Approving ${orderInfo.takerToken}...`);
      const approvalTx = await writeContractAsync({
        address: takerAssetAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [LOP_V4_ADDRESS as ViemAddress, 2n ** 256n - 1n],
      });
      
      // Wait for approval transaction to be mined
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: approvalTx });
      }
      
      // Refetch allowance
      await refetchAllowance();
      addNotice(`✅ ${orderInfo.takerToken} approved`);
    } catch (error: any) {
      addNotice(`❌ Approval failed: ${error?.shortMessage || error?.message || "Unknown error"}`);
    }
  }, [address, takerAssetAddress, orderInfo.takerToken, writeContractAsync, addNotice, publicClient, refetchAllowance]);

  const fillOrder = useCallback(async (percent: number) => {
    if (!address || !publicClient || !writeContractAsync) return;
    
    addNotice(`⏳ Processing order ${order.orderHash.slice(0, 10)}...`);

    try {
      // Validate basic order data first
      if (!order.order || !order.signature) {
        addNotice("❌ Invalid order data - missing order or signature");
        return;
      }

      // Ensure all required fields exist and are valid
      const requiredFields = {
        salt: order.order.salt,
        maker: order.order.maker,
        receiver: order.order.receiver,
        makerAsset: order.order.makerAsset,
        takerAsset: order.order.takerAsset,
        makerTraits: order.order.makerTraits,
        makingAmount: order.makingAmount || order.order.makingAmount,
        takingAmount: order.takingAmount || order.order.takingAmount,
      };

      const missingFields = Object.entries(requiredFields)
        .filter(([_, value]) => !value)
        .map(([key, _]) => key);

      if (missingFields.length > 0) {
        addNotice(`❌ Missing required order fields: ${missingFields.join(", ")}`);
        console.error("Missing fields in order:", requiredFields);
        return;
      }

      // Ensure signature is a string
      const signature = String(order.signature || "");
      if (!signature.startsWith("0x") || signature.length < 130) {
        addNotice("❌ Invalid signature format");
        return;
      }

      // Ensure extension is a string
      const extension = String(order.extension || "0x");

      // Construct order struct with proper validation
      const orderStruct = {
        salt: BigInt(order.order.salt),
        maker: order.order.maker as ViemAddress,
        receiver: order.order.receiver as ViemAddress,
        makerAsset: order.order.makerAsset as ViemAddress,
        takerAsset: order.order.takerAsset as ViemAddress,
        makingAmount: BigInt(order.makingAmount || order.order.makingAmount),
        takingAmount: BigInt(order.takingAmount || order.order.takingAmount),
        makerTraits: BigInt(order.order.makerTraits),
      };

      // Validate that all addresses are valid
      const addressFields = [orderStruct.maker, orderStruct.receiver, orderStruct.makerAsset, orderStruct.takerAsset];
      for (const addr of addressFields) {
        if (!addr || typeof addr !== 'string' || !addr.match(/^0x[a-fA-F0-9]{40}$/)) {
          addNotice("❌ Invalid address in order");
          console.error("Invalid address:", addr);
          return;
        }
      }

      console.log("🔍 Order struct for filling:", {
        orderHash: order.orderHash,
        orderStruct: {
          ...orderStruct,
          salt: orderStruct.salt.toString(),
          makingAmount: orderStruct.makingAmount.toString(),
          takingAmount: orderStruct.takingAmount.toString(),
          makerTraits: orderStruct.makerTraits.toString(),
        },
        signature,
        extension,
        signatureLength: signature.length,
        extensionLength: extension.length,
      });

      // Check if order is expired
      const expiration = getExpiration(orderStruct.makerTraits);
      if (expiration > 0n) {
        const now = BigInt(Math.floor(Date.now() / 1000));
        if (expiration <= now) {
          addNotice("❌ Order has expired");
          return;
        }
      }

      // Calculate fill amounts based on the original order amounts
      const maxMakingAmount = orderStruct.makingAmount;
      const maxTakingAmount = orderStruct.takingAmount;

      const makingAmount = percent < 100
        ? (maxMakingAmount * BigInt(percent)) / 100n
        : maxMakingAmount;
      const takingAmount = percent < 100
        ? (maxTakingAmount * BigInt(percent)) / 100n
        : maxTakingAmount;

      console.log("🔍 Fill amounts calculated:", {
        percent,
        maxMakingAmount: maxMakingAmount.toString(),
        maxTakingAmount: maxTakingAmount.toString(),
        makingAmount: makingAmount.toString(),
        takingAmount: takingAmount.toString(),
      });

      // Validate fill amounts
      if (makingAmount <= 0n || takingAmount <= 0n) {
        addNotice("❌ Invalid fill amounts");
        return;
      }

      // Check partial fill allowance
      if (percent < 100 && !allowsPartialFill(orderStruct.makerTraits)) {
        addNotice("❌ This order does not allow partial fills");
        return;
      }

      // Handle approval if needed
      if (needsApproval) {
        addNotice(`⏳ Approving ${orderInfo.takerToken}...`);
        try {
          const approvalTx = await writeContractAsync({
            address: orderStruct.takerAsset,
            abi: erc20Abi,
            functionName: "approve",
            args: [LOP_V4_ADDRESS as ViemAddress, takingAmount * 2n],
          });
          
          await publicClient.waitForTransactionReceipt({ hash: approvalTx });
          await refetchAllowance();
          addNotice(`✅ ${orderInfo.takerToken} approved`);
          
          // Small delay to ensure approval is registered
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (approvalError: any) {
          console.error("Approval failed:", approvalError);
          addNotice(`❌ Approval failed: ${approvalError?.shortMessage || "Unknown error"}`);
          return;
        }
      }

      addNotice(`📋 Filling order for ${formatUnits(makingAmount, 0)} tokens...`);

      // Try different fill methods with proper error handling
      let fillTxHash: string | undefined;
      let fillSuccess = false;

      // Method 1: Try fillOrder with r/vs signature split (most common for 1inch)
      if (signature.length === 132 && !fillSuccess) { // 0x + 130 hex chars
        try {
          const sigWithoutPrefix = signature.slice(2); // Remove 0x
          const r = "0x" + sigWithoutPrefix.slice(0, 64); // First 32 bytes
          const vs = "0x" + sigWithoutPrefix.slice(64, 128); // Next 32 bytes
          
          // Validate r and vs
          if (r.length !== 66 || vs.length !== 66) {
            throw new Error("Invalid r/vs signature components");
          }
          
          console.log("🔍 Method 1: fillOrder with r/vs signature", { r, vs });
          
          // Prepare args with validation
          const fillOrderArgs = [
            orderStruct,
            r as `0x${string}`,
            vs as `0x${string}`,
            makingAmount,
            0n, // takerTraits
          ] as const;

          console.log("🔍 fillOrder args:", {
            orderStruct: {
              ...orderStruct,
              salt: orderStruct.salt.toString(),
              makingAmount: orderStruct.makingAmount.toString(),
              takingAmount: orderStruct.takingAmount.toString(),
              makerTraits: orderStruct.makerTraits.toString(),
            },
            r,
            vs,
            makingAmount: makingAmount.toString(),
            takerTraits: "0",
          });
          
          fillTxHash = await writeContractAsync({
            address: LOP_V4_ADDRESS,
            abi: lopV4Abi,
            functionName: "fillOrder",
            args: fillOrderArgs,
          });
          
          fillSuccess = true;
          addNotice(`🎉 Order filled with fillOrder! TX: ${fillTxHash.slice(0, 10)}...`);
        } catch (error1: any) {
          console.log("🔍 Method 1 failed:", {
            message: error1.message,
            shortMessage: error1.shortMessage,
            cause: error1.cause,
          });
        }
      }

      // Method 2: Try fillOrderArgs with extension if available
      if (!fillSuccess && extension !== "0x" && signature.length === 132) {
        try {
          const sigWithoutPrefix = signature.slice(2);
          const r = "0x" + sigWithoutPrefix.slice(0, 64);
          const vs = "0x" + sigWithoutPrefix.slice(64, 128);
          
          // Validate components
          if (r.length !== 66 || vs.length !== 66) {
            throw new Error("Invalid r/vs signature components");
          }
          
          console.log("🔍 Method 2: fillOrderArgs with extension");
          
          const fillOrderArgsArgs = [
            orderStruct,
            r as `0x${string}`,
            vs as `0x${string}`,
            makingAmount,
            0n, // takerTraits
            extension as `0x${string}`,
          ] as const;
          
          fillTxHash = await writeContractAsync({
            address: LOP_V4_ADDRESS,
            abi: lopV4Abi,
            functionName: "fillOrderArgs",
            args: fillOrderArgsArgs,
          });
          
          fillSuccess = true;
          addNotice(`🎉 Order filled with fillOrderArgs! TX: ${fillTxHash.slice(0, 10)}...`);
        } catch (error2: any) {
          console.log("🔍 Method 2 failed:", {
            message: error2.message,
            shortMessage: error2.shortMessage,
          });
        }
      }

      // Method 3: Try fillContractOrder with full signature
      if (!fillSuccess) {
        try {
          console.log("🔍 Method 3: fillContractOrder with full signature");
          
          const fillContractOrderArgs = [
            orderStruct,
            signature as `0x${string}`,
            makingAmount,
            0n, // takerTraits
          ] as const;
          
          fillTxHash = await writeContractAsync({
            address: LOP_V4_ADDRESS,
            abi: lopV4Abi,
            functionName: "fillContractOrder",
            args: fillContractOrderArgs,
          });
          
          fillSuccess = true;
          addNotice(`🎉 Order filled with fillContractOrder! TX: ${fillTxHash.slice(0, 10)}...`);
        } catch (error3: any) {
          console.log("🔍 Method 3 failed:", {
            message: error3.message,
            shortMessage: error3.shortMessage,
          });
        }
      }

      // Method 4: Try fillContractOrderArgs with extension
      if (!fillSuccess && extension !== "0x") {
        try {
          console.log("🔍 Method 4: fillContractOrderArgs with extension");
          
          const fillContractOrderArgsArgs = [
            orderStruct,
            signature as `0x${string}`,
            makingAmount,
            0n, // takerTraits
            extension as `0x${string}`,
          ] as const;
          
          fillTxHash = await writeContractAsync({
            address: LOP_V4_ADDRESS,
            abi: lopV4Abi,
            functionName: "fillContractOrderArgs",
            args: fillContractOrderArgsArgs,
          });
          
          fillSuccess = true;
          addNotice(`🎉 Order filled with fillContractOrderArgs! TX: ${fillTxHash.slice(0, 10)}...`);
        } catch (error4: any) {
          console.log("🔍 Method 4 failed:", {
            message: error4.message,
            shortMessage: error4.shortMessage,
          });
          throw error4; // Re-throw the last error if all methods fail
        }
      }

      if (!fillSuccess) {
        throw new Error("All fill methods failed - order may be invalid or already filled");
      }

      // Mark order as filled in API
      if (fillTxHash) {
        try {
          await markOrderFilled(order.orderHash, fillTxHash);
        } catch (apiError) {
          console.warn("Failed to mark order as filled in API:", apiError);
        }
      }
      
      onFilled();

    } catch (error: any) {
      console.error("Fill error details:", {
        error,
        message: error?.message,
        shortMessage: error?.shortMessage,
        cause: error?.cause,
      });
      
      let errorMessage = "Unknown error";
      if (error?.shortMessage) {
        errorMessage = error.shortMessage;
      } else if (error?.message) {
        if (error.message.includes("Cannot read properties of undefined")) {
          errorMessage = "Order data is incomplete or invalid";
        } else if (error.message.includes("insufficient funds") || error.message.includes("insufficient balance")) {
          errorMessage = "Insufficient balance for this transaction";
        } else if (error.message.includes("allowance") || error.message.includes("transfer amount exceeds allowance")) {
          errorMessage = "Insufficient token allowance - please approve more tokens";
        } else if (error.message.includes("expired")) {
          errorMessage = "Order has expired";
        } else if (error.message.includes("signature") || error.message.includes("ECDSA")) {
          errorMessage = "Invalid order signature";
        } else if (error.message.includes("cancelled")) {
          errorMessage = "Order has been cancelled";
        } else if (error.message.includes("filled")) {
          errorMessage = "Order is already fully filled";
        } else if (error.message.includes("user rejected")) {
          errorMessage = "Transaction rejected by user";
        } else if (error.message.includes("BadSignature")) {
          errorMessage = "Invalid signature format for this order";
        } else if (error.message.includes("InvalidatedOrder")) {
          errorMessage = "Order has been invalidated or cancelled";
        } else if (error.message.includes("RemainingInvalidatedOrder")) {
          errorMessage = "Order has no remaining amount to fill";
        } else if (error.message.includes("hex_.replace")) {
          errorMessage = "Data format error - please try again";
        } else {
          errorMessage = error.message;
        }
      }
      
      addNotice(`❌ Fill failed: ${errorMessage}`);
    }
  }, [
    address,
    publicClient,
    orderInfo.takerToken,
    order,
    needsApproval,
    writeContractAsync,
    addNotice,
    onFilled,
    refetchAllowance,
  ]);

  // Validate that order has required data before rendering
  if (!order.order || !order.orderHash) {
    return (
      <div className="p-4 border rounded-lg bg-red-50 border-red-200">
        <div className="text-red-600 text-sm">
          ❌ Invalid order data - missing required fields
        </div>
      </div>
    );
  }

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
                Has Extension
              </Chip>
            )}
          </div>
          <div className="text-xs text-default-500">
            Maker: {order.order.maker.slice(0, 6)}...{order.order.maker.slice(-4)}
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-sm font-medium">
            {orderInfo.optionsAmountDisplay} tokens
          </div>
          <div className="text-xs text-default-500">
            for {orderInfo.totalPrice} {orderInfo.takerToken}
          </div>
        </div>
      </div>

      {/* Order Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-default-500">Price per Token</div>
          <div className="font-medium">{orderInfo.pricePerOption} {orderInfo.takerToken}</div>
        </div>
        <div>
          <div className="text-default-500">Total Amount</div>
          <div className="font-medium">{orderInfo.optionsAmountDisplay} tokens</div>
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

      {/* ERC-1155 Info */}
      {seriesId > 0n && (
        <div className="text-xs text-default-500 bg-blue-50 dark:bg-blue-900/20 p-2 rounded border">
          🔢 ERC-1155 Series: {orderInfo.shortSeriesId} {isValid ? "✅" : "⚠️"}
        </div>
      )}

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
      // Build filters based on UI selection
      const params: OrderFilters = {
        ...filters,
        takerAsset:
          selectedToken === "all"
            ? undefined
            : TOKEN_ADDRESSES[selectedToken as keyof typeof TOKEN_ADDRESSES],
      };

      console.log("🔍 Loading orders with filters:", params);
      
      const { orders: fetchedOrders } = await fetchOrders(params);

      console.log("🔍 Fetched orders:", {
        count: fetchedOrders.length,
        orders: fetchedOrders.map(o => ({
          hash: o.orderHash.slice(0, 8),
          makerAsset: o.order?.makerAsset || o.makerAsset,
          takerAsset: o.takerAsset,
          makingAmount: o.makingAmount,
          takingAmount: o.takingAmount,
          hasOrder: !!o.order,
          hasSignature: !!o.signature,
        }))
      });

      // Filter out orders with missing essential data
      const validOrders = fetchedOrders.filter(order => {
        return order.order && 
               order.signature && 
               order.orderHash && 
               order.makingAmount && 
               order.takingAmount;
      });

      if (validOrders.length !== fetchedOrders.length) {
        const invalidCount = fetchedOrders.length - validOrders.length;
        addNotice(`⚠️ Filtered out ${invalidCount} invalid orders`);
      }

      setOrders(validOrders);

    } catch (error: any) {
      console.error("Failed to load orders:", error);
      addNotice(`❌ Failed to load orders: ${error?.message || "Unknown error"}`);
      setOrders([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  }, [filters, selectedToken, addNotice]);

  // reload on creation event
  useEffect(() => {
    loadOrders();
    const id = setInterval(loadOrders, 30000);
    const handler = () => {
      setTimeout(loadOrders, 1000); // Small delay to ensure API is updated
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
    // Refresh orders after a successful fill
    setTimeout(loadOrders, 2000); // Small delay to ensure blockchain state is updated
    addNotice("📈 Order filled successfully! Refreshing orderbook...");
  }, [loadOrders, addNotice]);

  const toggleActiveFilter = useCallback(() => {
    setFilters((f) => ({ ...f, active: !f.active }));
  }, []);

  const handleTokenSelection = useCallback((keys: any) => {
    const selectedKeys = Array.from(keys);
    if (selectedKeys.length > 0) {
      setSelectedToken(selectedKeys[0] as string);
    }
  }, []);

  const displayNotices = useMemo(
    () => notices.map((notice) => notice.split(":").slice(1).join(":")),
    [notices]
  );

  // Enhanced order filtering and sorting
  const filteredOrders = useMemo(() => {
    return orders
      .filter(order => {
        // Basic validation - ensure order has required data
        if (!order.order || !order.signature || !order.orderHash) {
          return false;
        }

        // Filter by active status if enabled
        if (filters.active) {
          try {
            const makerTraits = BigInt(order.order.makerTraits || "0");
            if (!isOrderActive(makerTraits)) {
              return false;
            }
          } catch {
            return false; // Invalid makerTraits
          }
        }

        return true;
      })
      .sort((a, b) => {
        // Sort by creation time (newest first) if available
        if (a.createdAt && b.createdAt) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        // Fallback to orderHash comparison
        return a.orderHash.localeCompare(b.orderHash);
      });
  }, [orders, filters.active]);

  return (
    <Card className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Options Orderbook
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Browse and fill limit orders from all makers on the network
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
            <SelectItem key="all" value="all" textValue="All Payment Tokens">
              All Payment Tokens
            </SelectItem>
            {Object.keys(DECIMALS).map((sym) => (
              <SelectItem key={sym} value={sym} textValue={sym}>
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
            {filteredOrders.length} orders
          </Chip>
          <span>limit orders available</span>
          {filteredOrders.length !== orders.length && (
            <Chip size="sm" variant="flat" color="warning">
              {orders.length - filteredOrders.length} filtered
            </Chip>
          )}
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="text-sm text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded border border-yellow-200 dark:border-yellow-800">
          💡 Connect your wallet to fill orders
        </div>
      )}

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Spinner size="lg" />
          <span className="ml-2 text-gray-700 dark:text-gray-300">
            Loading orders...
          </span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center p-8 text-gray-600 dark:text-gray-400">
          <div className="mb-2">No orders found</div>
          <div className="text-sm">
            {selectedToken === "all"
              ? orders.length > 0 
                ? "All orders are filtered out. Try adjusting your filters."
                : "Create a limit order or check back later"
              : `No orders found for ${selectedToken}. Try selecting "All Payment Tokens"`}
          </div>
          {orders.length > 0 && orders.length !== filteredOrders.length && (
            <div className="text-xs mt-2 text-gray-500">
              ({orders.length} total orders loaded, {orders.length - filteredOrders.length} filtered out)
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="font-medium text-gray-900 dark:text-gray-100">
              Available Orders
            </h4>
            <Chip size="sm" color="secondary" variant="flat">
              {filteredOrders.length} {filteredOrders.length === 1 ? "order" : "orders"}
            </Chip>
            {selectedToken !== "all" && (
              <Chip size="sm" color="primary" variant="flat">
                {selectedToken} only
              </Chip>
            )}
            {filters.active && (
              <Chip size="sm" color="success" variant="flat">
                Active only
              </Chip>
            )}
          </div>

          <div className="text-xs text-gray-600 dark:text-gray-400 mb-4 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500"></span>
            <span>
              These are open orders from all users. Connect your wallet to fill any available orders.
            </span>
          </div>

          {filteredOrders.map((order) => (
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

      {/* Debug Information */}
      {process.env.NODE_ENV === 'development' && (
        <details className="cursor-pointer">
          <summary className="text-sm text-default-500 hover:text-default-700">
            Debug Information (Development Only)
          </summary>
          <div className="mt-3 p-3 bg-default-100 rounded text-xs space-y-2">
            <div><strong>Total Orders Loaded:</strong> {orders.length}</div>
            <div><strong>Filtered Orders:</strong> {filteredOrders.length}</div>
            <div><strong>Active Filter:</strong> {filters.active ? "On" : "Off"}</div>
            <div><strong>Selected Token:</strong> {selectedToken}</div>
            <div><strong>Wallet Connected:</strong> {isConnected ? "Yes" : "No"}</div>
            <div><strong>Loading:</strong> {loading ? "Yes" : "No"}</div>
          </div>
        </details>
      )}
    </Card>
  );
}