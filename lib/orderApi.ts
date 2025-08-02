// lib/orderApi.ts

export interface OrderData {
  hash: string;
  order: {
    salt: string;
    maker: string;
    receiver: string;
    makerAsset: string;
    takerAsset: string;
    makingAmount: string;
    takingAmount: string;
    makerTraits: string;
    extension: string;
  };
  signature: string;
  createdAt: number;
  status: "active" | "filled" | "cancelled" | "expired";
  fillTx?: string;
  filledTakingAmount?: string;
}

// Interface expected by Orderbook component
export interface ApiOrder {
  orderHash: string;
  order: {
    salt: string;
    maker: string;
    receiver: string;
    makerAsset: string;
    takerAsset: string;
    makerTraits: string;
  };
  signature: string;
  extension: string;
  makingAmount: string;
  takingAmount: string;
  maker: string;
  takerAsset: string;
  createdAt: number;
  filled: boolean;
  cancelled: boolean;
  txHash?: string;
  fillTx?: string;
  filledTakingAmount?: string;
}

export interface OrderFilters {
  active?: boolean;
  maker?: string;
  takerAsset?: string;
  makerAsset?: string;
  seriesId?: string;
  limit?: number;
  offset?: number;
}

// Use local API routes
const API_BASE = "/api/orders";

/**
 * Submit a new order to the local orderbook API
 */
export async function submitOrder(
  order: any,
  signature: string,
  orderHash: string,
  extension?: string
): Promise<void> {
  // Create clean order object without extension
  const cleanOrder = {
    salt: order.salt.toString(),
    maker: order.maker,
    receiver: order.receiver,
    makerAsset: order.makerAsset,
    takerAsset: order.takerAsset,
    makingAmount: order.makingAmount.toString(),
    takingAmount: order.takingAmount.toString(),
    makerTraits: order.makerTraits.toString(),
  };

  const orderData = {
    order: cleanOrder,
    signature,
    extension: extension || "0x", // Ensure extension is passed
    orderHash,
  };

  try {
    console.log("🔍 Submitting order with data:", {
      ...orderData,
      extensionLength: orderData.extension?.length || 0,
      signatureLength: orderData.signature?.length || 0,
    });
    
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderData),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log("Order submitted successfully:", result);
  } catch (error) {
    console.error("Failed to submit order:", error);
    throw error;
  }
}

/**
 * Fetch orders with filters from local API
 */
export async function fetchOrders(filters: OrderFilters = {}): Promise<{ orders: ApiOrder[] }> {
  try {
    const params = new URLSearchParams();
    if (filters.active !== undefined) params.set("active", filters.active.toString());
    if (filters.maker) params.set("maker", filters.maker);
    if (filters.takerAsset) params.set("takerAsset", filters.takerAsset);
    if (filters.makerAsset) params.set("makerAsset", filters.makerAsset);
    if (filters.limit) params.set("limit", filters.limit.toString());
    if (filters.offset) params.set("offset", filters.offset.toString());

    const url = params.toString() ? `${API_BASE}?${params}` : API_BASE;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Convert API response to ApiOrder format expected by components
    const orders: ApiOrder[] = data.orders.map((orderData: any) => ({
      orderHash: orderData.orderHash,
      order: {
        salt: orderData.order.salt,
        maker: orderData.order.maker,
        receiver: orderData.order.receiver,
        makerAsset: orderData.order.makerAsset,
        takerAsset: orderData.order.takerAsset,
        makerTraits: orderData.order.makerTraits,
      },
      signature: orderData.signature,
      extension: orderData.extension || "0x",
      makingAmount: orderData.makingAmount || orderData.order?.makingAmount || "0",
      takingAmount: orderData.takingAmount || orderData.order?.takingAmount || "0",
      maker: orderData.maker || orderData.order?.maker || "",
      takerAsset: orderData.takerAsset || orderData.order?.takerAsset || "",
      createdAt: orderData.timestamp || orderData.createdAt || Date.now(),
      filled: orderData.filled || false,
      cancelled: orderData.cancelled || false,
      txHash: orderData.fillTx || orderData.txHash,
      fillTx: orderData.fillTx,
      filledTakingAmount: orderData.filledTakingAmount,
    }));

    console.log(`Fetched ${orders.length} orders from local API`);
    
    // Log extension data for debugging
    orders.forEach(order => {
      console.log(`Order ${order.orderHash.slice(0, 8)}: extension length = ${order.extension?.length || 0}`);
    });
    
    return { orders };
  } catch (error) {
    console.error("Failed to fetch orders from local API:", error);
    
    // Return empty array if API fails
    return { orders: [] };
  }
}

/**
 * Mark an order as filled in the local API
 */
export async function markOrderFilled(orderHash: string, txHash: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/fill`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderHash, txHash }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log("Order marked as filled:", result);
  } catch (error) {
    console.error("Failed to mark order as filled:", error);
    throw error;
  }
}

/**
 * Cancel an order in the local API
 */
export async function cancelOrderInApi(orderHash: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderHash }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log("Order cancelled in API:", result);
  } catch (error) {
    console.error("Failed to cancel order in API:", error);
    throw error;
  }
}

/**
 * Clean up expired orders
 */
export async function cleanupExpiredOrders(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/cleanup`, { 
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log("Cleanup result:", result);
    }
  } catch (error) {
    console.error("Failed to cleanup expired orders:", error);
  }
}

// Legacy compatibility functions
export async function fetchActiveOrders(): Promise<OrderData[]> {
  const { orders } = await fetchOrders({ active: true });
  
  return orders.map((apiOrder): OrderData => ({
    hash: apiOrder.orderHash,
    order: {
      salt: apiOrder.order.salt,
      maker: apiOrder.order.maker,
      receiver: apiOrder.order.receiver,
      makerAsset: apiOrder.order.makerAsset,
      takerAsset: apiOrder.order.takerAsset,
      makingAmount: apiOrder.makingAmount,
      takingAmount: apiOrder.takingAmount,
      makerTraits: apiOrder.order.makerTraits,
      extension: apiOrder.extension,
    },
    signature: apiOrder.signature,
    createdAt: apiOrder.createdAt,
    status: apiOrder.filled ? "filled" : apiOrder.cancelled ? "cancelled" : "active",
    fillTx: apiOrder.fillTx,
    filledTakingAmount: apiOrder.filledTakingAmount,
  }));
}

export async function fetchOrdersByMaker(makerAddress: string): Promise<OrderData[]> {
  const { orders } = await fetchOrders({ maker: makerAddress });
  
  return orders.map((apiOrder): OrderData => ({
    hash: apiOrder.orderHash,
    order: {
      salt: apiOrder.order.salt,
      maker: apiOrder.order.maker,
      receiver: apiOrder.order.receiver,
      makerAsset: apiOrder.order.makerAsset,
      takerAsset: apiOrder.order.takerAsset,
      makingAmount: apiOrder.makingAmount,
      takingAmount: apiOrder.takingAmount,
      makerTraits: apiOrder.order.makerTraits,
      extension: apiOrder.extension,
    },
    signature: apiOrder.signature,
    createdAt: apiOrder.createdAt,
    status: apiOrder.filled ? "filled" : apiOrder.cancelled ? "cancelled" : "active",
    fillTx: apiOrder.fillTx,
    filledTakingAmount: apiOrder.filledTakingAmount,
  }));
}

export async function fetchOrderByHash(orderHash: string): Promise<OrderData | null> {
  try {
    // Try to fetch all orders and find the one with matching hash
    const { orders } = await fetchOrders();
    const order = orders.find(o => o.orderHash === orderHash);
    
    if (!order) return null;
    
    return {
      hash: order.orderHash,
      order: {
        salt: order.order.salt,
        maker: order.order.maker,
        receiver: order.order.receiver,
        makerAsset: order.order.makerAsset,
        takerAsset: order.order.takerAsset,
        makingAmount: order.makingAmount,
        takingAmount: order.takingAmount,
        makerTraits: order.order.makerTraits,
        extension: order.extension,
      },
      signature: order.signature,
      createdAt: order.createdAt,
      status: order.filled ? "filled" : order.cancelled ? "cancelled" : "active",
      fillTx: order.fillTx,
      filledTakingAmount: order.filledTakingAmount,
    };
  } catch (error) {
    console.error("Failed to fetch order by hash:", error);
    return null;
  }
}