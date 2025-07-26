// components/navbar.tsx
"use client";

import {
  Navbar as HeroUINavbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  NavbarMenu,
  NavbarMenuItem,
  NavbarMenuToggle,
} from "@heroui/navbar";
import { Link } from "@heroui/link";
import NextLink from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { GithubIcon } from "@/components/icons";
import { siteConfig } from "@/config/site";

export const Navbar = () => {
  const appName = siteConfig?.name ?? "YourApp";

  return (
    <HeroUINavbar maxWidth="xl" position="sticky">
      {/* Left: Brand / App name */}
      <NavbarContent justify="start">
        <NavbarBrand as="li" className="max-w-fit">
          <NextLink href="/" className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">{appName}</span>
          </NextLink>
        </NavbarBrand>
      </NavbarContent>

      {/* Right: Desktop nav and actions */}
      <NavbarContent justify="end" className="hidden sm:flex items-center gap-4">
        <NavbarItem>
          <NextLink
            href="/how-it-works"
            className="text-default-600 hover:text-foreground transition"
          >
            How it works
          </NextLink>
        </NavbarItem>

        {/* Always-visible admin link */}
        <NavbarItem>
          <NextLink
            href="/admin/"
            className="text-default-600 hover:text-foreground transition"
          >
            Admin: Define Series
          </NextLink>
        </NavbarItem>

        <NavbarItem>
          <Link
            isExternal
            aria-label="GitHub repository"
            href={siteConfig.links.github}
            className="flex items-center"
          >
            <GithubIcon className="text-default-500" />
          </Link>
        </NavbarItem>

        <NavbarItem>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        </NavbarItem>
      </NavbarContent>

      {/* Mobile: right side icons */}
      <NavbarContent className="sm:hidden" justify="end">
        <Link
          isExternal
          aria-label="GitHub repository"
          href={siteConfig.links.github}
          className="flex items-center"
        >
          <GithubIcon className="text-default-500" />
        </Link>
        <NavbarMenuToggle />
      </NavbarContent>

      {/* Mobile menu */}
      <NavbarMenu>
        <div className="mx-4 my-4 space-y-3">
          <NavbarMenuItem>
            <Link as={NextLink} href="/how-it-works" size="lg">
              How it works
            </Link>
          </NavbarMenuItem>

          {/* Always-visible admin link */}
          <NavbarMenuItem>
            <Link as={NextLink} href="/admin" size="lg">
              Admin
            </Link>
          </NavbarMenuItem>

          <NavbarMenuItem>
            <Link isExternal href={siteConfig.links.github} size="lg">
              Open GitHub
            </Link>
          </NavbarMenuItem>
        </div>

        <div className="mx-4 my-2">
          <ConnectButton showBalance={false} accountStatus="avatar" chainStatus="icon" />
        </div>
      </NavbarMenu>
    </HeroUINavbar>
  );
};