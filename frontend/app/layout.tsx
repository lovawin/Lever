import "./globals.css";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
