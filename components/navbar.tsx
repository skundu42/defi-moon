"use client";

import React, { useMemo } from "react";
import clsx from "clsx";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

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
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { siteConfig } from "@/config/site";
import { GithubIcon } from "@/components/icons";

const navLinks: Array<{ label: string; href: string }> = [
  { label: "Maker", href: "/maker" },
  { label: "Taker", href: "/taker" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Orderbook", href: "/orderbook" },
  { label: "Admin", href: "/admin" },
];

export const Navbar = () => {
  const pathname = usePathname() ?? "/";
  const appName = siteConfig?.name ?? "YourApp";
  
  // Safe access to github link with fallback
  const githubHref = (() => {
    try {
      return (siteConfig as any)?.links?.github ?? "https://github.com";
    } catch {
      return "https://github.com";
    }
  })();

  const isActive = useMemo(
    () => (href: string) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname?.startsWith(href + "/"),
    [pathname]
  );

  return (
    <HeroUINavbar
      maxWidth="xl"
      position="sticky"
      className={clsx(
        "backdrop-blur supports-[backdrop-filter]:bg-background/70",
        "border-b border-default-200/60"
      )}
    >
      {/* Left: Brand */}
      <NavbarContent justify="start" className="min-w-[140px]">
        <NavbarBrand as="li" className="max-w-fit">
          <NextLink href="/" className="flex items-center gap-2">
            {/* Replace with your logo component if desired */}
            <span className="text-base font-semibold tracking-tight text-foreground">
              {appName}
            </span>
          </NextLink>
        </NavbarBrand>
      </NavbarContent>

      {/* Center: Primary nav (desktop) */}
      <NavbarContent justify="center" className="hidden md:flex gap-6">
        <ul className="flex items-center gap-6">
          {navLinks.map(({ label, href }) => {
            const active = isActive(href);
            return (
              <NavbarItem key={href} isActive={active}>
                <NextLink
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "relative text-sm transition-colors duration-200",
                    active
                      ? "text-foreground font-medium"
                      : "text-default-600 hover:text-foreground"
                  )}
                >
                  {label}
                  {/* underline indicator for active */}
                  <span
                    className={clsx(
                      "absolute -bottom-1 left-0 h-[2px] w-full rounded-full transition-opacity duration-200",
                      active ? "opacity-100 bg-primary" : "opacity-0"
                    )}
                  />
                </NextLink>
              </NavbarItem>
            );
          })}
        </ul>
      </NavbarContent>

      {/* Right: Actions (desktop) */}
      <NavbarContent justify="end" className="hidden md:flex items-center gap-4">
        <NavbarItem>
          <Link
            isExternal
            aria-label="GitHub repository"
            href={githubHref}
            className="flex items-center p-2 rounded-md hover:bg-default-100 transition-colors"
          >
            <GithubIcon className="text-default-500 hover:text-foreground transition-colors w-5 h-5" />
          </Link>
        </NavbarItem>
        <NavbarItem>
          <div className="flex items-center">
            <ConnectButton
              showBalance={false}
              chainStatus="none"
              accountStatus="address"
            />
          </div>
        </NavbarItem>
      </NavbarContent>

      {/* Right: Mobile (burger + GitHub + Connect) */}
      <NavbarContent className="md:hidden" justify="end">
        <NavbarItem>
          <Link
            isExternal
            aria-label="GitHub repository"
            href={githubHref}
            className="flex items-center p-2 rounded-md hover:bg-default-100 transition-colors mr-1"
          >
            <GithubIcon className="text-default-500 w-5 h-5" />
          </Link>
        </NavbarItem>
        <NavbarItem>
          <div className="flex items-center">
            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus="avatar"
            />
          </div>
        </NavbarItem>
        <NavbarMenuToggle 
          aria-label="Toggle navigation menu" 
          className="ml-2"
        />
      </NavbarContent>

      {/* Mobile Menu */}
      <NavbarMenu>
        <div className="mx-4 my-4 space-y-1">
          {navLinks.map(({ label, href }) => {
            const active = isActive(href);
            return (
              <NavbarMenuItem key={href} isActive={active}>
                <Link
                  as={NextLink}
                  href={href}
                  size="lg"
                  className={clsx(
                    "block py-3 px-2 rounded-md transition-colors",
                    active 
                      ? "text-primary font-medium bg-primary/10" 
                      : "text-foreground hover:bg-default-100"
                  )}
                >
                  {label}
                </Link>
              </NavbarMenuItem>
            );
          })}
        </div>
      </NavbarMenu>
    </HeroUINavbar>
  );
};