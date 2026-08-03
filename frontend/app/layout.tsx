import "./globals.css";

export const metadata = {
  title: "Lever — long/short memecoins",
  description: "Hyperliquid-powered long/short platform for memecoins.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
