import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "Lever — Memecoin Perps & Flash Loans",
  description: "Trade memecoin perps with leverage. Flash loan arbitrage, self-liquidation, and leverage loops on Arbitrum.",
  other: { "cache-control": "no-cache" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
