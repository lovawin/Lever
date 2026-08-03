import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        panel: "#141414",
        bull: "#00d68f",
        bear: "#ff3b5c",
        muted: "#6b6b6b",
        border: "#1f2937",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
        mono: ["ui-monospace", "JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
