// app/providers.tsx
"use client";

import type { ThemeProviderProps } from "next-themes";
import * as React from "react";
import { HeroUIProvider } from "@heroui/system";
import { useRouter } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";

import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { gnosis /*, mainnet*/ } from "wagmi/chains";
import { http } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { siteConfig } from "@/config/site";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

declare module "@react-types/shared" {
  interface RouterConfig {
    routerOptions: NonNullable<
      Parameters<ReturnType<typeof useRouter>["push"]>[1]
    >;
  }
}

const queryClient = new QueryClient();

/**
 * RainbowKit/Wagmi config
 * - Gnosis-only (adjust chains as needed)
 * - Uses WalletConnect Cloud project id from env
 * - SSR enabled for App Router
 * - Optional custom RPC via NEXT_PUBLIC_GNOSIS_RPC_URL
 */
const wagmiConfig = getDefaultConfig({
  appName: siteConfig?.name ?? "YourApp",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "",
  chains: [gnosis],
  transports: {
    // If you set NEXT_PUBLIC_GNOSIS_RPC_URL, it will use that. Otherwise it falls back to chain defaults.
    [gnosis.id]: process.env.NEXT_PUBLIC_GNOSIS_RPC_URL
      ? http(process.env.NEXT_PUBLIC_GNOSIS_RPC_URL)
      : http(),
  },
  ssr: true,
  // If you later need multiple chains, add them to `chains` and `transports`.
  // chains: [gnosis, mainnet],
  // transports: {
  //   [gnosis.id]: http(),
  //   [mainnet.id]: http(),
  // },
});

export function Providers({ children, themeProps }: ProvidersProps) {
  const router = useRouter();

  return (
    <HeroUIProvider navigate={router.push}>
      <NextThemesProvider {...themeProps}>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider>{children}</RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </NextThemesProvider>
    </HeroUIProvider>
  );
}