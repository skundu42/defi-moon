"use client";

import { Link } from "@heroui/link";
import { Button } from "@heroui/button";
import { Card } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Divider } from "@heroui/divider";
import { Accordion, AccordionItem } from "@heroui/accordion";

export default function MainPage() {
  const features = [
    {
      icon: "🔐",
      title: "Connect Wallet",
      description: "Use RainbowKit to connect a Gnosis Chain wallet. You'll see your address in the navbar and can switch networks if needed.",
      color: "primary",
      tags: ["RainbowKit", "Gnosis Chain", "Multi-Wallet"]
    },
    {
      icon: "🧱",
      title: "Define Series",
      description: "Choose underlying, strike, expiry, and type. Series appear in a table so you can track and act on them later.",
      color: "secondary",
      tags: ["Custom Series", "Strike Price", "Expiry Date"]
    },
    {
      icon: "🪙",
      title: "Collateral & Mint",
      description: "Deposit collateral, then mint options from a defined series. You control quantities and can mint multiple series.",
      color: "success",
      tags: ["Collateral Management", "Option Minting", "Risk Control"]
    }
  ];

  const steps = [
    {
      step: 1,
      title: "Connect Your Wallet",
      description: "Press the Connect button (top-right). RainbowKit handles providers and accounts seamlessly.",
      details: "Supports MetaMask, WalletConnect, Coinbase Wallet, and more. Automatically detects Gnosis Chain.",
      icon: "🔗",
      color: "primary"
    },
    {
      step: 2,
      title: "Define Option Series",
      description: "On the Vault page, configure the options series (strike, expiry, etc.). The series table shows what you've created.",
      details: "Set strike price in WXDAI, choose expiry date, specify collateral per option, and select oracle for settlement.",
      icon: "⚙️",
      color: "secondary"
    },
    {
      step: 3,
      title: "Deposit Collateral",
      description: "Add collateral to back minted options. You'll see updated balances and allowances in real-time.",
      details: "Supports GNO as collateral. Track free vs locked amounts. Approve once, mint multiple times.",
      icon: "💰",
      color: "warning"
    },
    {
      step: 4,
      title: "Mint Call Options",
      description: "Mint options tokens for a chosen series. Transactions run via your connected wallet with gas estimation.",
      details: "Each minted option locks the required collateral. Options are ERC-1155 tokens that can be traded.",
      icon: "🏭",
      color: "success"
    },
    {
      step: 5,
      title: "Create Limit Orders",
      description: "Use the 1inch integration to list option tokens. Orders are created client-side and posted to the orderbook.",
      details: "Set your price, choose payment token (WXDAI, USDC, etc.), enable partial fills, and sign the order.",
      icon: "📋",
      color: "danger"
    },
    {
      step: 6,
      title: "Settle & Exercise",
      description: "At or post expiry, settle positions and exercise profitable options. Reclaim unused collateral.",
      details: "Oracle-based settlement ensures fair pricing. Exercise ITM options for profit. Reclaim collateral from unexercised positions.",
      icon: "🎯",
      color: "default"
    }
  ];

  const faqs = [
    {
      question: "What are covered call options?",
      answer: "Covered calls are options where you own the underlying asset (collateral) and sell call options against it. If the option is exercised, you deliver the collateral at the strike price. If not, you keep the premium."
    },
    {
      question: "How does the 1inch integration work?",
      answer: "We use 1inch Limit Order Protocol v4 to create a decentralized orderbook. Your ERC-1155 option tokens are listed as limit orders that other users can discover and fill."
    },
    {
      question: "What happens at expiry?",
      answer: "At expiry, the series must be settled using oracle price data. If options are in-the-money, holders can exercise them. Option writers can then reclaim any unused collateral."
    },
    {
      question: "Can I close positions early?",
      answer: "Yes! Since options are ERC-1155 tokens, you can trade them on the orderbook anytime before expiry. Buy back your sold options or sell your purchased options."
    }
  ];

  return (
    <section className="mx-auto max-w-6xl py-10 md:py-14 space-y-16">
      {/* Hero Section */}
      <header className="text-center space-y-6">
        <div className="space-y-4">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            Covered Call{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary-500 to-secondary-500">
              Options Trading
            </span>
          </h1>
        </div>

        <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4">
          <Button
            as={Link}
            href="/maker"
            color="primary"
            size="lg"
            className="font-semibold"
          >
            Trade Options
          </Button>
          <Button
            as={Link}
            href="/portfolio"
            variant="bordered"
            size="lg"
            className="font-semibold"
          >
            View Portfolio
          </Button>
        </div>
      </header>





      <section className="py-8">
        <Card className="bg-gradient-to-r from-default-100 to-default-50 border-default-200">
          <div className="p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-primary-100 rounded-xl flex items-center justify-center shadow-lg border border-primary-200">
<div className="w-16 h-16 bg-primary-100 rounded-xl flex items-center justify-center shadow-lg border border-primary-200">
  <img
    src="/1inch.svg"
    alt="1inch logo"
    className="w-full h-full object-contain"
    aria-label="1inch logo"
  />
</div>                </div>
                <div className="text-left">
                  <h3 className="text-xl md:text-2xl font-bold text-foreground">
                    Powered by 1inch Protocol
                  </h3>
                  <p className="text-default-600 text-sm md:text-base">
                    Decentralized limit orders with superior liquidity and execution
                  </p>
                </div>
              </div>
              
              <div className="flex flex-col md:flex-row items-center gap-4 text-center md:text-right">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="space-y-1">
                    <div className="font-semibold text-primary-600">v4</div>
                    <div className="text-xs text-default-500">Protocol</div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-semibold text-success-600">ERC-1155</div>
                    <div className="text-xs text-default-500">Support</div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-semibold text-secondary-600">0% Fees</div>
                    <div className="text-xs text-default-500">Protocol</div>
                  </div>
                  <div className="space-y-1">
                    <div className="font-semibold text-warning-600">On-Chain</div>
                    <div className="text-xs text-default-500">Orders</div>
                  </div>
                </div>
                
                <Button
                  as={Link}
                  href="https://1inch.io/limit-order-protocol/"
                  size="sm"
                  variant="bordered"
                  className="border-primary-300 text-primary-600 hover:bg-primary-50"
                  isExternal
                >
                  Learn More
                </Button>
              </div>
            </div>
            
            <Divider className="my-4" />
            
            <div className="flex flex-wrap justify-center gap-6 text-xs text-default-500">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-success-400 rounded-full"></div>
                <span>Limit Order Protocol v4</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary-400 rounded-full"></div>
                <span>Decentralized Orderbook</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-secondary-400 rounded-full"></div>
                <span>ERC-1155 Integration</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-warning-400 rounded-full"></div>
                <span>Gas Optimized</span>
              </div>
            </div>
          </div>
        </Card>
      </section>


      {/* Key Features Grid */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Core Features</h2>
          <p className="text-default-600 text-lg">
            Everything you need for professional options trading
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="h-full hover:scale-105 transition-transform duration-200 p-6">
              <div className="flex-col items-start space-y-4">
                <div className="flex items-center justify-between w-full">
                  <div className="text-4xl">{feature.icon}</div>
                  <Chip color={feature.color as any} variant="flat" size="sm">
                    Step {index + 1}
                  </Chip>
                </div>
                <h3 className="text-xl font-semibold">{feature.title}</h3>
                <p className="text-default-600">{feature.description}</p>
                <div className="flex flex-wrap gap-1">
                  {feature.tags.map((tag, tagIndex) => (
                    <Chip
                      key={tagIndex}
                      size="sm"
                      variant="flat"
                      color="default"
                      className="text-xs"
                    >
                      {tag}
                    </Chip>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Detailed Workflow */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Step-by-Step Workflow</h2>
          <p className="text-default-600 text-lg">
            Follow this complete guide to start trading covered call options
          </p>
        </div>

        <Card className="p-6 md:p-8">
          <div className="space-y-8">
            {steps.map((step, index) => (
              <div key={index} className="relative">
                {/* Progress Line */}
                {index < steps.length - 1 && (
                  <div className="absolute left-6 top-16 w-0.5 h-20 bg-default-200" />
                )}
                
                <div className="flex gap-6">
                  {/* Step Icon */}
                  <div className="flex-shrink-0">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-full bg-default-100 flex items-center justify-center text-2xl">
                        {step.icon}
                      </div>
                      <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">
                        {step.step}
                      </div>
                    </div>
                  </div>

                  {/* Step Content */}
                  <div className="flex-1 space-y-3">
                    <div className="space-y-1">
                      <h4 className="text-xl font-semibold flex items-center gap-2">
                        {step.title}
                        <Chip color={step.color as any} variant="dot" size="sm">
                          {step.step === 1 ? "Start Here" : 
                           step.step === 6 ? "Final Step" : "Required"}
                        </Chip>
                      </h4>
                      <p className="text-default-600 text-lg">{step.description}</p>
                    </div>
                    
                    <Card className="bg-default-50 p-3">
                      <p className="text-sm text-default-700">{step.details}</p>
                    </Card>
                  </div>
                </div>
                
                {/* Divider */}
                {index < steps.length - 1 && (
                  <Divider className="mt-8" />
                )}
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* FAQ Section */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Frequently Asked Questions</h2>
          <p className="text-default-600 text-lg">
            Get answers to common questions about covered call options
          </p>
        </div>

        <Accordion variant="splitted" selectionMode="multiple">
          {faqs.map((faq, index) => (
            <AccordionItem
              key={index}
              aria-label={faq.question}
              title={faq.question}
              className="text-left"
            >
              <div className="text-default-600 pb-4">
                {faq.answer}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </section>
  );
}