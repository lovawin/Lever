import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "Lever — long/short memecoins",
  description: "Hyperliquid-powered long/short platform for memecoins.",
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
