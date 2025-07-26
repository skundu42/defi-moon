"use client";

import React from "react";
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
  { label: "Vault", href: "/" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Admin", href: "/admin" },
];

export const Navbar = () => {
  const pathname = usePathname();
  const appName = siteConfig?.name ?? "YourApp";
  const githubHref = siteConfig?.links?.github ?? "#";

  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname?.startsWith(href + "/");

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
            <span className="text-base font-semibold tracking-tight">{appName}</span>
          </NextLink>
        </NavbarBrand>
      </NavbarContent>

      {/* Center: Primary nav (desktop) */}
      <NavbarContent
        justify="center"
        className="hidden md:flex gap-6"
      >
        <ul className="flex items-center gap-6">
          {navLinks.map(({ label, href }) => {
            const active = isActive(href);
            return (
              <NavbarItem key={href} isActive={active}>
                <NextLink
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "relative text-sm transition-colors",
                    active
                      ? "text-foreground font-medium"
                      : "text-default-600 hover:text-foreground"
                  )}
                >
                  {label}
                  {/* underline indicator for active */}
                  <span
                    className={clsx(
                      "absolute -bottom-1 left-0 h-[2px] w-full rounded-full transition-opacity",
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
            className="flex items-center"
          >
            <GithubIcon className="text-default-500 hover:text-foreground transition-colors" />
          </Link>
        </NavbarItem>
        <NavbarItem>
          <ConnectButton
            showBalance={false}
            chainStatus="none"
            accountStatus="address"
          />
        </NavbarItem>
      </NavbarContent>

      {/* Right: Mobile (burger + GitHub + Connect) */}
      <NavbarContent className="md:hidden" justify="end">
        <Link
          isExternal
          aria-label="GitHub repository"
          href={githubHref}
          className="flex items-center mr-1"
        >
          <GithubIcon className="text-default-500" />
        </Link>
        <ConnectButton
          showBalance={false}
          chainStatus="icon"
          accountStatus="avatar"
        />
        <NavbarMenuToggle />
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
                    "block py-2",
                    active ? "text-primary font-medium" : "text-foreground"
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