// app/vault/page.tsx
"use client";

import { Link } from "@heroui/link";
import { button as buttonStyles } from "@heroui/theme";

import DefineSeriesForm from "../components/DefineSeriesForm";
import DepositWithdraw from "../components/DepositWithdraw";
import MintOptionsForm from "../components/MintOptionsForm";
import CreateLimitOrder from "../components/CreateLimitOrder";
import SettleExerciseReclaim from "../components/SettleExerciseReclaim";
import SeriesTable from "../components/SeriesTable";

export default function VaultPage() {
  return (
    <section className="mx-auto max-w-5xl py-8 md:py-12 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Covered Call Vault — Gnosis</h1>
          <p className="text-default-500 mt-1">
            Define series, manage collateral, mint options, create 1inch orders, and settle/exercise.
          </p>
        </div>

        <Link
          href="/"
          className={buttonStyles({ variant: "bordered", radius: "full" })}
        >
          Home
        </Link>
      </div>

      {/* “Cards” using Tailwind containers to avoid installing extra component packages */}
      <div className="grid grid-cols-1 gap-6">
        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <h2 className="text-lg font-medium mb-3">Define Series</h2>
          <DefineSeriesForm />
          <div className="mt-6">
            <SeriesTable />
          </div>
        </div>

        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <h2 className="text-lg font-medium mb-3">Collateral</h2>
          <DepositWithdraw />
        </div>

        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <h2 className="text-lg font-medium mb-3">Mint Options</h2>
          <MintOptionsForm />
        </div>

        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <h2 className="text-lg font-medium mb-3">Create 1inch Order</h2>
          <CreateLimitOrder />
        </div>

        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <h2 className="text-lg font-medium mb-3">Settle / Exercise / Reclaim</h2>
          <SettleExerciseReclaim />
        </div>
      </div>
    </section>
  );
}