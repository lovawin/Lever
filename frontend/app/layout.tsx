import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata = {
  title: "Lever — long/short memecoins",
  description: "Long & short memecoins with leverage. Order books, funding rates, spot leverage.",
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
