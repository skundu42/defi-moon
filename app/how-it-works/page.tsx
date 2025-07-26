"use client";

import { Link } from "@heroui/link";
import { button as buttonStyles } from "@heroui/theme";

export default function HowItWorksPage() {
  return (
    <section className="mx-auto max-w-5xl py-10 md:py-14 space-y-10">
      {/* Hero */}
      <header className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          How the <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">App Works</span>
        </h1>
        <p className="text-default-500 max-w-2xl mx-auto">
          A quick tour of the flow: connect your wallet, define an options series, manage collateral,
          mint options, create on-chain limit orders, and finally settle or exercise.
        </p>

        <div className="flex justify-center gap-3 pt-2">
          <Link
            href="/vault"
            className={buttonStyles({ variant: "solid", radius: "full" })}
          >
            Open the Vault
          </Link>
          <Link
            href="/"
            className={buttonStyles({ variant: "bordered", radius: "full" })}
          >
            Home
          </Link>
        </div>
      </header>

      {/* 3-up Feature Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <div className="text-2xl">🔐</div>
          <h2 className="text-lg font-medium mt-2">Connect Wallet</h2>
          <p className="text-default-500 mt-1">
            Use RainbowKit to connect a Gnosis Chain wallet. You’ll see your address in the navbar
            and can switch networks if needed.
          </p>
        </div>

        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <div className="text-2xl">🧱</div>
          <h2 className="text-lg font-medium mt-2">Define Series</h2>
          <p className="text-default-500 mt-1">
            Choose underlying, strike, expiry, and type. Series appear in a table so you can track
            and act on them later.
          </p>
        </div>

        <div className="rounded-2xl border border-default-200/50 bg-content1 p-5">
          <div className="text-2xl">🪙</div>
          <h2 className="text-lg font-medium mt-2">Collateral & Mint</h2>
          <p className="text-default-500 mt-1">
            Deposit collateral, then mint options from a defined series. You control quantities and
            can mint multiple series.
          </p>
        </div>
      </section>

      {/* Timeline / Steps */}
      <section className="rounded-2xl border border-default-200/50 bg-content1 p-6 md:p-8">
        <h3 className="text-xl font-semibold mb-6">End-to-End Flow</h3>

        <ol className="relative border-s border-default-200/50 space-y-8 ps-6">
          <li>
            <div className="absolute -start-2.5 mt-1.5 size-2.5 rounded-full bg-primary" />
            <h4 className="font-medium">1) Connect</h4>
            <p className="text-default-500">
              Press the <strong>Connect</strong> button (top-right). RainbowKit handles providers
              and accounts.
            </p>
          </li>

          <li>
            <div className="absolute -start-2.5 mt-1.5 size-2.5 rounded-full bg-primary" />
            <h4 className="font-medium">2) Define Series</h4>
            <p className="text-default-500">
              On the <strong>Vault</strong> page, configure the options series (strike, expiry, etc.).
              The series table shows what you’ve created.
            </p>
          </li>

          <li>
            <div className="absolute -start-2.5 mt-1.5 size-2.5 rounded-full bg-primary" />
            <h4 className="font-medium">3) Deposit Collateral</h4>
            <p className="text-default-500">
              Add collateral to back minted options. You’ll see updated balances and allowances.
            </p>
          </li>

          <li>
            <div className="absolute -start-2.5 mt-1.5 size-2.5 rounded-full bg-primary" />
            <h4 className="font-medium">4) Mint Options</h4>
            <p className="text-default-500">
              Mint options tokens for a chosen series. Transactions run via your connected wallet.
            </p>
          </li>

          <li>
            <div className="absolute -start-2.5 mt-1.5 size-2.5 rounded-full bg-primary" />
            <h4 className="font-medium">5) Create 1inch Order</h4>
            <p className="text-default-500">
              Use the limit-order form to list option tokens. The order data is created client-side
              and posted on-chain where applicable.
            </p>
          </li>

          <li>
            <div className="absolute -start-2.5 mt-1.5 size-2.5 rounded-full bg-primary" />
            <h4 className="font-medium">6) Settle / Exercise / Reclaim</h4>
            <p className="text-default-500">
              At or post expiry, settle or exercise positions. Reclaim collateral for unexercised
              positions as rules allow.
            </p>
          </li>
        </ol>
      </section>
    </section>
  );
}