import "./globals.css";
import type { Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/Providers";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Lever — Memecoin Perps & Flash Loans",
  description: "Trade memecoin perps with leverage. Flash loan arbitrage, self-liquidation, and leverage loops on Arbitrum.",
  other: { "cache-control": "no-cache" },
};

// viewport-fit=cover is required for env(safe-area-inset-*) to have any
// effect in mobile Safari — without it, floating browser chrome (the
// compact address bar / bottom toolbar) sits on top of page content
// instead of us being able to pad around it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
