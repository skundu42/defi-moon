"use client";

import Orderbook from "@/components/Orderbook";
import TakerPortfolio from "@/components/TakerPortfolio";
import SettleExerciseReclaim from "@/components/SettleExerciseReclaim";
import SeriesTable from "@/components/SeriesTable";

export default function TakerPage() {
  return (
    <section className="mx-auto max-w-6xl py-10 md:py-14 space-y-10">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Options Taker
        </h1>
        <p className="text-default-500 max-w-2xl">
          Browse available call options, fill limit orders, manage your portfolio, and exercise 
          your options when profitable.
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

      {/* Series Overview */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Available Series</h2>
        <SeriesTable />
      </div>

      {/* Browse & Fill Orders */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Orderbook</h2>
        <Orderbook />
      </div>

      {/* Portfolio Management */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Your Portfolio</h2>
        <TakerPortfolio />
      </div>

      {/* Exercise & Settlement */}
      <div className="space-y-3" data-section="exercise">
        <h2 className="text-lg font-medium">Exercise / Settlement</h2>
        <SettleExerciseReclaim />
      </div>
    </section>
  );
}