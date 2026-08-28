import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0E11",       // near-black, matches Hyperliquid/TradingView dark theme
        panel: "#14171B",
        border: "#23262B",
        text: "#E8E9EB",
        muted: "#6B7280",
        accent: "#3B82F6",   // single neutral UI accent — buttons, links, focus
        bull: "#26A69A",     // long/buy — TradingView's own teal-green convention
        bear: "#EF5350",     // short/sell — TradingView's own red convention
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
};
export default config;
