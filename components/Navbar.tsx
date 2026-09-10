"use client";
import { useEffect, useState, type FocusEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeChanger from "./DarkSwitch";
import { BrandLogo } from "./BrandLogo";
import { Disclosure } from "@headlessui/react";
import {
  IconArrowRight,
  IconMenu,
  IconChevronDown,
  IconX,
} from "@tabler/icons-react";
import { navigation } from "./navigation";
import { signInUrl, signUpUrl } from "@/lib/app-links";

const linkClasses =
  "relative rounded-sm text-[0.9375rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent";
const inactiveLinkClasses =
  "text-brand-blue-900/70 hover:text-brand-blue-900 dark:text-gray-300 dark:hover:text-white";
const activeLinkClasses = "text-brand-blue-900 dark:text-white";

export const Navbar = () => {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;

  // Which desktop dropdown (keyed by its item.href) is open. Hover/focus
  // open and close it directly; this state is what lets a click on one of
  // its links close it immediately too, and the effect below is a safety
  // net for navigations that don't change `pathname` at all — e.g. a child
  // link that's just a hash on the page you're already on, or the browser
  // back/forward buttons — since the pointer/focus staying put would
  // otherwise leave a CSS-only dropdown looking stuck open over the new
  // page.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-brand-blue-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:bg-trueGray-800 dark:focus:text-white">
        Skip to content
      </a>

      <header className="fixed inset-x-0 top-0 z-50 border-b border-brand-blue-900/10 bg-paper/90 backdrop-blur-md transition-colors duration-300 supports-[backdrop-filter]:bg-paper/75 dark:border-white/10 dark:bg-trueGray-900/90 dark:supports-[backdrop-filter]:bg-trueGray-900/75">
        <div className="mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10">
          <div className="flex h-16 items-center justify-between gap-6 lg:h-20">
            {/* Logo */}
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
              aria-label="Kitabu Yetu — home">
              <BrandLogo size={34} priority />
              <span className="font-display text-[1.35rem] font-normal tracking-tight text-brand-blue-900 transition-colors dark:text-white">
                Kitabu Yetu
              </span>
            </Link>

            {/* Desktop menu */}
            <nav aria-label="Primary" className="hidden lg:block">
              <ul className="flex items-center gap-8">
                {navigation.map((item) => {
                  const active = isActive(item.href);
                  const children = item.children;
                  const isOpen = openMenu === item.href;
                  return (
                    <li
                      key={item.href}
                      className={children ? "relative" : undefined}
                      {...(children && {
                        onMouseEnter: () => setOpenMenu(item.href),
                        onMouseLeave: () => setOpenMenu(null),
                        onBlur: (e: FocusEvent<HTMLLIElement>) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            setOpenMenu(null);
                          }
                        },
                      })}>
                      {children ? (
                        <>
                          <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={isOpen}
                            onFocus={() => setOpenMenu(item.href)}
                            className={`flex items-center gap-1.5 ${linkClasses} ${
                              active ? activeLinkClasses : inactiveLinkClasses
                            }`}>
                            {item.name}
                            <IconChevronDown
                              size={14}
                              className={`transition-transform duration-200 ${
                                isOpen ? "rotate-180" : ""
                              }`}
                              aria-hidden="true"
                            />
                            {active && (
                              <span
                                aria-hidden="true"
                                className="absolute -bottom-1.5 left-0 h-px w-full bg-brand-500"
                              />
                            )}
                          </button>
                          {/* Padding (not margin) bridges the gap up to the
                              button, so the pointer never leaves this list
                              item while crossing it — a margin gap here
                              would close the menu before the pointer
                              reaches it. */}
                          <div
                            className={`absolute right-0 top-full z-20 w-64 pt-2 ${
                              isOpen ? "block" : "hidden"
                            }`}>
                            <div className="rounded-md border border-brand-blue-900/10 bg-paper py-2 text-left shadow-lg dark:border-white/10 dark:bg-trueGray-800">
                              {children.map((child) => (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  onClick={() => setOpenMenu(null)}
                                  className="block rounded-md px-4 py-2 text-sm text-brand-blue-900/80 hover:bg-brand-blue-900/[0.05] hover:text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white">
                                  {child.name}
                                </Link>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`${linkClasses} ${
                            active ? activeLinkClasses : inactiveLinkClasses
                          }`}>
                          {item.name}
                          {active && (
                            <span
                              aria-hidden="true"
                              className="absolute -bottom-1.5 left-0 h-px w-full bg-brand-500"
                            />
                          )}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Desktop right-hand actions */}
            <div className="hidden shrink-0 items-center gap-1 lg:flex">
              <ThemeChanger />
              <a
                href={signInUrl()}
                className="rounded-md px-4 py-2 text-[0.9375rem] font-medium text-brand-blue-900/80 transition-colors hover:bg-brand-blue-900/[0.05] hover:text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white">
                Sign in
              </a>
              <a
                href={signUpUrl()}
                className="group inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
                Get started
                <IconArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
            </div>

            {/* Mobile toggle */}
            <Disclosure>
              {({ open }) => (
                <>
                  <div className="flex shrink-0 items-center gap-1 lg:hidden">
                    <ThemeChanger />
                    <Disclosure.Button
                      aria-label={open ? "Close menu" : "Open menu"}
                      className="-mr-2 rounded-md p-2.5 text-brand-blue-900 transition-colors hover:bg-brand-blue-900/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white dark:hover:bg-white/10">
                      <span className="sr-only">
                        {open ? "Close menu" : "Open menu"}
                      </span>
                      {open ? (
                        <IconX size={24} aria-hidden="true" />
                      ) : (
                        <IconMenu size={24} aria-hidden="true" />
                      )}
                    </Disclosure.Button>
                  </div>

                  <Disclosure.Panel
                    id="site-menu"
                    className="fixed inset-x-0 top-16 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-brand-blue-900/10 bg-paper lg:hidden dark:border-white/10 dark:bg-trueGray-900">
                    <nav aria-label="Primary" className="px-5 py-4 sm:px-8">
                      <ul className="divide-y divide-brand-blue-900/[0.07] dark:divide-white/10">
                        {navigation.map((item) => {
                          const active = isActive(item.href);
                          const children = item.children;
                          return (
                            <li key={item.href}>
                              {children ? (
                                <Disclosure>
                                  {({ open: childOpen }) => (
                                    <>
                                      <Disclosure.Button className="flex w-full items-center justify-between py-4 text-lg text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white">
                                        {item.name}
                                        <IconChevronDown
                                          size={20}
                                          className={`text-brand-blue-900/40 transition-transform duration-200 dark:text-white/40 ${
                                            childOpen ? "rotate-180" : ""
                                          }`}
                                          aria-hidden="true"
                                        />
                                      </Disclosure.Button>
                                      <Disclosure.Panel className="pb-4 pl-4">
                                        <ul className="space-y-1">
                                          {children.map((child) => (
                                            <li key={child.href}>
                                              <Link
                                                href={child.href}
                                                className="block rounded-md px-3 py-2 text-base text-brand-blue-900/70 hover:bg-brand-blue-900/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-gray-300 dark:hover:bg-white/5">
                                                {child.name}
                                              </Link>
                                            </li>
                                          ))}
                                        </ul>
                                      </Disclosure.Panel>
                                    </>
                                  )}
                                </Disclosure>
                              ) : (
                                <Link
                                  href={item.href}
                                  aria-current={active ? "page" : undefined}
                                  className="flex items-center justify-between py-4 text-lg text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white">
                                  {item.name}
                                  <IconArrowRight
                                    size={16}
                                    className="text-brand-blue-900/40 dark:text-white/40"
                                    aria-hidden="true"
                                  />
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ul>

                      <div className="mt-6 flex flex-col gap-3 pb-8">
                        <a
                          href={signUpUrl()}
                          className="inline-flex items-center justify-center rounded-md bg-brand-600 px-5 py-3.5 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
                          Get started
                        </a>
                        <a
                          href={signInUrl()}
                          className="inline-flex items-center justify-center rounded-md border border-brand-blue-900/15 px-5 py-3.5 text-base font-medium text-brand-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:border-white/20 dark:text-white">
                          Sign in
                        </a>
                      </div>
                    </nav>
                  </Disclosure.Panel>
                </>
              )}
            </Disclosure>
          </div>
        </div>
      </header>
    </>
  );
};
