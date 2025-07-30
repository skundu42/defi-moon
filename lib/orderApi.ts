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

// Mock API base URL - replace with your actual API endpoint
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api/orders";

/**
 * Submit a new order to the orderbook API
 */
export async function submitOrder(
  order: any,
  signature: string,
  orderHash: string
): Promise<void> {
  const orderData = {
    order: {
      salt: order.salt.toString(),
      maker: order.maker,
      receiver: order.receiver,
      makerAsset: order.makerAsset,
      takerAsset: order.takerAsset,
      makingAmount: order.makingAmount.toString(),
      takingAmount: order.takingAmount.toString(),
      makerTraits: order.makerTraits.toString(),
    },
    signature,
    extension: order.extension || "0x",
    orderHash,
  };

  try {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderData),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    console.log("Order submitted successfully:", orderHash);
  } catch (error) {
    console.error("Failed to submit order:", error);
    
    // For development: store in localStorage as fallback
    if (typeof window !== "undefined") {
      const stored = JSON.parse(localStorage.getItem("orderbook") || "[]");
      stored.push({
        hash: orderHash,
        order: {
          salt: order.salt.toString(),
          maker: order.maker,
          receiver: order.receiver,
          makerAsset: order.makerAsset,
          takerAsset: order.takerAsset,
          makingAmount: order.makingAmount.toString(),
          takingAmount: order.takingAmount.toString(),
          makerTraits: order.makerTraits.toString(),
          extension: order.extension || "0x",
        },
        signature,
        createdAt: Date.now(),
        status: "active",
      });
      localStorage.setItem("orderbook", JSON.stringify(stored));
      console.log("Order stored locally as fallback");
    }
    
    throw error;
  }
}

/**
 * Fetch orders with filters (for Orderbook component)
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
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // Convert API response to ApiOrder format expected by Orderbook
    // Your API returns orders in the 'orders' array
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
      makingAmount: orderData.order.makingAmount,
      takingAmount: orderData.order.takingAmount,
      maker: orderData.order.maker,
      takerAsset: orderData.order.takerAsset,
      createdAt: orderData.timestamp,
      filled: orderData.filled,
      cancelled: orderData.cancelled,
      txHash: orderData.fillTx,
    }));

    return { orders };
  } catch (error) {
    console.error("Failed to fetch orders from API:", error);
    
    // Fallback to localStorage for development
    if (typeof window !== "undefined") {
      const stored = JSON.parse(localStorage.getItem("orderbook") || "[]");
      const orders: ApiOrder[] = stored
        .filter((orderData: OrderData) => {
          if (filters.active && orderData.status !== "active") return false;
          if (filters.maker && orderData.order.maker.toLowerCase() !== filters.maker.toLowerCase()) return false;
          if (filters.takerAsset && orderData.order.takerAsset.toLowerCase() !== filters.takerAsset.toLowerCase()) return false;
          if (filters.makerAsset && orderData.order.makerAsset.toLowerCase() !== filters.makerAsset.toLowerCase()) return false;
          return true;
        })
        .map((orderData: OrderData) => ({
          orderHash: orderData.hash,
          order: {
            salt: orderData.order.salt,
            maker: orderData.order.maker,
            receiver: orderData.order.receiver,
            makerAsset: orderData.order.makerAsset,
            takerAsset: orderData.order.takerAsset,
            makerTraits: orderData.order.makerTraits,
          },
          signature: orderData.signature,
          extension: orderData.order.extension,
          makingAmount: orderData.order.makingAmount,
          takingAmount: orderData.order.takingAmount,
          maker: orderData.order.maker,
          takerAsset: orderData.order.takerAsset,
          createdAt: orderData.createdAt,
          filled: orderData.status === "filled",
          cancelled: orderData.status === "cancelled",
        }));
      
      return { orders };
    }
    
    return { orders: [] };
  }
}

/**
 * Mark an order as filled in the API (with txHash support for Orderbook component)
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
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    console.log("Order marked as filled:", orderHash);
  } catch (error) {
    console.error("Failed to mark order as filled:", error);
    
    // Fallback: update localStorage
    if (typeof window !== "undefined") {
      const stored = JSON.parse(localStorage.getItem("orderbook") || "[]");
      const updated = stored.map((order: OrderData) =>
        order.hash === orderHash ? { ...order, status: "filled" } : order
      );
      localStorage.setItem("orderbook", JSON.stringify(updated));
    }
  }
}

/**
 * Fetch all active orders from the API (legacy function for compatibility)
 */
export async function fetchActiveOrders(): Promise<OrderData[]> {
  const { orders } = await fetchOrders({ active: true });
  
  // Convert ApiOrder back to OrderData format
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
  }));
}

/**
 * Cancel an order in the API
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
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    console.log("Order cancelled in API:", orderHash);
  } catch (error) {
    console.error("Failed to cancel order in API:", error);
    
    // Fallback: update localStorage
    if (typeof window !== "undefined") {
      const stored = JSON.parse(localStorage.getItem("orderbook") || "[]");
      const updated = stored.map((order: OrderData) =>
        order.hash === orderHash ? { ...order, status: "cancelled" } : order
      );
      localStorage.setItem("orderbook", JSON.stringify(updated));
    }
    
    throw error;
  }
}

/**
 * Get orders by maker address
 */
export async function fetchOrdersByMaker(makerAddress: string): Promise<OrderData[]> {
  const { orders } = await fetchOrders({ maker: makerAddress });
  
  // Convert ApiOrder back to OrderData format
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
  }));
}

/**
 * Get order by hash
 */
export async function fetchOrderByHash(orderHash: string): Promise<OrderData | null> {
  try {
    const response = await fetch(`${API_BASE}/order/${orderHash}`);
    
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch order:", error);
    
    // Fallback to localStorage
    if (typeof window !== "undefined") {
      const stored = JSON.parse(localStorage.getItem("orderbook") || "[]");
      return stored.find((order: OrderData) => order.hash === orderHash) || null;
    }
    
    return null;
  }
}

/**
 * Clean up expired orders (utility function)
 */
export async function cleanupExpiredOrders(): Promise<void> {
  try {
    await fetch(`${API_BASE}/cleanup`, { method: "POST" });
  } catch (error) {
    console.error("Failed to cleanup expired orders:", error);
  }
}