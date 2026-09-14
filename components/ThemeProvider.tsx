"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import React from "react";

/**
 * ThemeProvider wrapper for next-themes
 * Provides theme context to the entire application
 * Supports light, dark, and system preference modes
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
