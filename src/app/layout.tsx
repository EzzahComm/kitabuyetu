import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PopupWidget }  from "@/components/PopupWidget";
import { BackToTop } from "@/components/BackToTop";
import { officialAppUrl } from "@/lib/app-links";


const displayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL(officialAppUrl),
  title: "Kitabu Yetu — Bookkeeping for CHAMAs and SACCOs",
  description:
    "Kitabu Yetu keeps members, contributions, loans, welfare and M-Pesa on one double-entry ledger for savings groups across East Africa.",
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${displayFont.variable} font-display`}>
        <ThemeProvider attribute="class">
          <Navbar />
          {/* Navbar is now `fixed`, not `sticky` — this padding is what
              keeps page content from starting underneath it. Matches the
              header's own h-16 lg:h-20. */}
          <main id="main" className="pt-16 lg:pt-20">
            {children}
          </main>
          <Footer />
          <PopupWidget />
          <BackToTop />
        </ThemeProvider>
      </body>
    </html>
  );
}
