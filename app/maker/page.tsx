"use client";

import DepositWithdraw from "@/components/DepositWithdraw";
import CreateLimitOrder from "@/components/CreateLimitOrder";
import SettleExerciseReclaim from "@/components/SettleExerciseReclaim";
import SeriesTable from "@/components/SeriesTable";

export default function VaultPage() {
  return (
    <section className="mx-auto max-w-6xl py-10 md:py-14 space-y-10">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Options Maker
        </h1>
        <p className="text-default-500 max-w-2xl">
          Manage collateral, mint options, create 1inch limit orders, and handle
          settlement workflows — all in one place.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center rounded-full border border-default-200/60 bg-content2 px-2.5 py-1 text-xs text-default-600">
            Network: Gnosis Chain
          </span>
          <span className="inline-flex items-center rounded-full border border-default-200/60 bg-content2 px-2.5 py-1 text-xs text-default-600">
            Underlying: GNO
          </span>
        </div>
      </header>

      {/* Series Table */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Series</h2>
        <SeriesTable />
      </div>

      {/* Collateral */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Collateral</h2>
        <DepositWithdraw />
      </div>

      {/* Create 1inch Order */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Create 1inch Order</h2>
        <CreateLimitOrder />
      </div>


      {/* Post-expiry lifecycle */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Settle / Exercise / Reclaim</h2>
        <SettleExerciseReclaim />
      </div>
    </section>
  );
}