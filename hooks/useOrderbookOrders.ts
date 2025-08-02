import { useState, useEffect, useCallback } from "react";
import { fetchOrders, type ApiOrder, type OrderFilters } from "@/lib/orderApi";

export function useOrderbookOrders(
  maker?: `0x${string}`,
  filters?: Partial<OrderFilters>
) {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const queryFilters: OrderFilters = {
        ...filters,
        ...(maker && { maker }),
      };
      
      console.log("🔍 useOrderbookOrders: Loading with filters:", queryFilters);
      
      const { orders: fetchedOrders } = await fetchOrders(queryFilters);
      
      console.log("🔍 useOrderbookOrders: Fetched orders:", {
        count: fetchedOrders.length,
        ordersWithExtensions: fetchedOrders.filter(o => o.extension && o.extension !== "0x").length,
        firstOrderExtensionLength: fetchedOrders[0]?.extension?.length || 0,
      });
      
      // Additional validation for extension data
      const validOrders = fetchedOrders.filter(order => {
        const hasValidExtension = order.extension && order.extension !== "0x" && order.extension.length >= 130;
        if (!hasValidExtension) {
          console.warn(`Order ${order.orderHash.slice(0, 8)} has invalid extension:`, {
            extension: order.extension,
            length: order.extension?.length || 0,
          });
        }
        return hasValidExtension;
      });
      
      console.log(`🔍 useOrderbookOrders: ${validOrders.length}/${fetchedOrders.length} orders have valid extensions`);
      
      setOrders(validOrders);
    } catch (err: any) {
      console.error("useOrderbookOrders: Failed to load orders:", err);
      setError(err.message || "Failed to load orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [maker, filters]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(loadOrders, 30000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // Listen for new order events
  useEffect(() => {
    const handleNewOrder = () => {
      console.log("🔍 useOrderbookOrders: New order event detected, refreshing...");
      loadOrders();
    };

    window.addEventListener("limit-order-created", handleNewOrder);
    return () => window.removeEventListener("limit-order-created", handleNewOrder);
  }, [loadOrders]);

  return {
    orders,
    loading,
    error,
    refetch: loadOrders,
  };
}