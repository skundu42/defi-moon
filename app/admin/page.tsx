// app/admin/series/page.tsx
"use client";

import React from "react";
import { useAccount, useReadContract } from "wagmi";
import { Card } from "@heroui/card";

import DefineSeriesForm from "@/components/DefineSeriesForm";
import { VAULT_ADDRESS, vaultAbi } from "@/lib/contracts";

// keccak256("SERIES_ADMIN_ROLE")
const SERIES_ADMIN_ROLE =
  "0x31614bb72d45cac63afb2594a1e18378fbabc0e1821b20fb54a1e918334a268a" as const;

export default function AdminDefineSeriesPage() {
  const { address, isConnected } = useAccount();

  // Check role (non-blocking; we still render the form if connected)
  const { data: isAdmin, isLoading } = useReadContract({
    address: VAULT_ADDRESS,
    abi: vaultAbi,
    functionName: "hasRole",
    args: [
      SERIES_ADMIN_ROLE,
      (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
    ],
    query: { enabled: Boolean(address) },
  });

  return (
    <section className="mx-auto max-w-5xl py-8 md:py-12 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin — Define Option Series</h1>
        <p className="text-default-500">
          Create new option series for the vault. (Requires on-chain{" "}
          <span className="font-mono">SERIES_ADMIN_ROLE</span>.)
        </p>
      </div>

      {/* Not connected → ask to connect */}
      {!isConnected && (
        <Card className="p-5">
          <p>Please connect your wallet to continue.</p>
        </Card>
      )}

      {/* Connected → always show the form */}
      {isConnected && (
        <>
          {/* Optional notice about role status (non-blocking) */}
          {!isLoading && isAdmin === false && (
            <Card className="p-4 border-warning text-warning">
              <p>
                You’re connected as{" "}
                <span className="font-mono">{address}</span>, but this address
                does not have <span className="font-mono">SERIES_ADMIN_ROLE</span>.
                You can still fill the form; transactions will revert on-chain if
                the role is missing.
              </p>
            </Card>
          )}

          <DefineSeriesForm />
        </>
      )}
    </section>
  );
}