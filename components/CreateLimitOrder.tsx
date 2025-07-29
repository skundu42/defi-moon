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
} from "viem";
import { Select, SelectItem } from "@heroui/select";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { Tooltip } from "@heroui/tooltip";
import { Spinner } from "@heroui/spinner";

import {
  buildLimitOrder1155,
  submitSignedOrder,
  fetchOrdersByMaker,
} from "@/lib/oneInch";
import {
  VAULT_ADDRESS,
  CALLTOKEN_ADDRESS,
  ERC1155_PROXY_ADDRESS,
  vaultAbi,
  erc1155Abi,
} from "@/lib/contracts";

const SERIES_DEFINED = parseAbiItem(
  "event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry)"
);

// Hard-code network id to avoid missing export
const NETWORK_ID = 100;

function Info({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} placement="top" offset={6}>
      <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border border-default-300 text-default-600 cursor-help">
        i
      </span>
    </Tooltip>
  );
}

function formatDateUTC(ts: bigint) {
  const d = new Date(Number(ts) * 1000);
  return isNaN(d.getTime())
    ? "-"
    : d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function CreateLimitOrder() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();

  // Load all series definitions
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
        // de-dup & sort by expiry ascending
        const map = new Map<string, typeof acc[0]>();
        acc.forEach((r) => map.set(r.id.toString(), r));
        setAllSeries(
          Array.from(map.values()).sort((a, b) =>
            Number(a.expiry - b.expiry)
          )
        );
      } catch (e: any) {
        console.error("Series load error:", e);
      } finally {
        setLoadingSeries(false);
      }
    })();
  }, [publicClient]);

  // Subscribe to new SeriesDefined events
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

  // Selected series
  const [selectedSeriesId, setSelectedSeriesId] = useState<bigint>();
  const now = Math.floor(Date.now() / 1000);
  const activeSeries = useMemo(
    () => allSeries.filter((s) => Number(s.expiry) > now),
    [allSeries, now]
  );

  // ERC-1155 proxy approval
  const { data: isApprovedForAll = false } = useReadContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "isApprovedForAll",
    args: [address as ViemAddress, ERC1155_PROXY_ADDRESS as ViemAddress],
    query: { enabled: Boolean(address) },
  });
  const { writeContractAsync: setApprovalForAll } = useWriteContract({
    address: CALLTOKEN_ADDRESS,
    abi: erc1155Abi,
    functionName: "setApprovalForAll",
  });

  // Form state
  const [qtyStr, setQtyStr] = useState("");
  const [takerSym, setTakerSym] = useState<"USDC" | "WXDAI" | "WETH">(
    "WXDAI"
  );
  const [takerAmountStr, setTakerAmountStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderHash, setOrderHash] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  const addNotice = (msg: string) => setNotices((n) => [...n, msg]);
  const expirationSec = 2 * 60 * 60;

  // Approve proxy
  const onApproveProxy = async () => {
    if (!address) return;
    try {
      await setApprovalForAll({
        args: [ERC1155_PROXY_ADDRESS as ViemAddress, true],
      });
      addNotice("ERC1155 proxy approved ✔️");
    } catch (e: any) {
      addNotice(`Approve failed: ${e?.message ?? e}`);
    }
  };

  // Create order
  const onCreateOrder = async () => {
    if (!address) return addNotice("Connect wallet first");
    if (!selectedSeriesId) return addNotice("Select a series");

    // parse ERC-1155 qty (integer)
    const qty = BigInt(qtyStr || "0");
    if (qty <= 0n) return addNotice("Enter a positive qty");

    // parse taker amount with decimals
    const decimals = takerSym === "USDC" ? 6 : 18;
    let takerAmt: bigint;
    try {
      takerAmt = parseUnits(takerAmountStr || "0", decimals);
    } catch {
      return addNotice("Invalid receive amount format");
    }
    if (takerAmt <= 0n) return addNotice("Enter a positive receive amount");

    setSubmitting(true);
    try {
      const built = buildLimitOrder1155({
        makerAddress: address,
        maker1155: {
          token: CALLTOKEN_ADDRESS as ViemAddress,
          tokenId: selectedSeriesId,
          amount: qty,
          data: "0x",
        },
        takerAsset: (process.env[`NEXT_PUBLIC_TOKEN_${takerSym}`] ??
          "") as ViemAddress,
        takerAmount: takerAmt,
        expirationSec,
      });

      const signature = await signTypedDataAsync({
        domain: built.typedData.domain as any,
        types: built.typedData.types as any,
        primaryType: "Order",
        message: built.typedData.message as any,
      });

      await submitSignedOrder(built, signature);

      const h = built.order.getOrderHash(NETWORK_ID);
      setOrderHash(h);
      addNotice(`Order created: ${h}`);

      // reload on-chain orders
      await loadOrders();
    } catch (e: any) {
      addNotice(`Error: ${e?.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Fetch off-chain orders (1inch orderbook)
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const loadOrders = async () => {
    if (!address) return;
    try {
      const list = await fetchOrdersByMaker(address);
      setOpenOrders(list.items ?? list);
    } catch (e: any) {
      console.error("Orderbook load error:", e);
      addNotice("Could not load open orders");
    }
  };
  useEffect(() => {
    if (address) loadOrders();
  }, [address]);

  return (
    <Card className="p-5 space-y-4">
      <h3 className="text-lg font-medium">
        Create 1inch ERC-1155 Limit Order
      </h3>

      {/* Notices */}
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
        <label className="text-sm font-medium mb-1 block">
          Series <Info tip="Unexpired series only" />
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
            onSelectionChange={(keys) => {
              const v = Array.from(keys as Set<string>)[0];
              setSelectedSeriesId(BigInt(v));
            }}
            classNames={{ trigger: "h-12 bg-default-100", value: "text-sm" }}
          >
            {activeSeries.map((s) => (
              <SelectItem
                key={s.id.toString()}
                value={s.id.toString()}
                textValue={`${s.id} • K ${formatUnits(
                  s.strike,
                  18
                )} • exp ${formatDateUTC(s.expiry)}`}
              >
                <div className="flex flex-col">
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
      <Button
        onPress={onApproveProxy}
        isDisabled={isApprovedForAll || !address}
        className="h-12"
      >
        {isApprovedForAll ? "Proxy Approved" : "Approve ERC1155 Proxy"}
      </Button>

      {/* Order inputs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-1">
          <label className="text-sm">Qty to Sell</label>
          <Input
            placeholder="e.g. 1"
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
        </div>

        <div className="md:col-span-1">
          <label className="text-sm">Receive Token</label>
          <Select
            selectionMode="single"
            selectedKeys={new Set([takerSym])}
            onSelectionChange={(keys) =>
              setTakerSym(Array.from(keys as Set<string>)[0] as any)
            }
            classNames={{
              trigger: "h-12 bg-default-100",
              value: "text-sm",
            }}
          >
            {["USDC", "WXDAI", "WETH"].map((sym) => (
              <SelectItem key={sym} value={sym} textValue={sym}>
                {sym}
              </SelectItem>
            ))}
          </Select>
        </div>

        <div className="md:col-span-1">
          <label className="text-sm">Receive Amount</label>
          <Input
            placeholder="e.g. 10"
            value={takerAmountStr}
            onChange={(e) => setTakerAmountStr(e.target.value)}
            classNames={{
              inputWrapper: "h-12 bg-default-100",
              input: "text-sm",
            }}
          />
        </div>

        <Button
          color="primary"
          onPress={onCreateOrder}
          isLoading={submitting}
          isDisabled={
            submitting || !isConnected || !isApprovedForAll || !selectedSeriesId
          }
          className="h-12 w-full"
        >
          Create Order
        </Button>
      </div>

      {/* Order hash */}
      {orderHash && (
        <div className="mt-4">
          <div className="text-sm text-default-500">Order Hash:</div>
          <div className="font-mono break-all">{orderHash}</div>
        </div>
      )}

      {/* Open orders */}
      {openOrders.length > 0 && (
        <div className="mt-6">
          <h4 className="font-medium mb-2">Your Open Orders</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-default-500">
                <tr>
                  <th className="p-2 text-left">Hash</th>
                  <th className="p-2 text-left">MakerAsset</th>
                  <th className="p-2 text-left">TakerAsset</th>
                  <th className="p-2 text-left">Making</th>
                  <th className="p-2 text-left">Taking</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o) => (
                  <tr key={o.hash} className="border-t">
                    <td className="p-2 font-mono">{o.hash}</td>
                    <td className="p-2">{o.makerAsset}</td>
                    <td className="p-2">{o.takerAsset}</td>
                    <td className="p-2">{o.makingAmount}</td>
                    <td className="p-2">{o.takingAmount}</td>
                    <td className="p-2">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}