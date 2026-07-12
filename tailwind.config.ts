import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      colors: {
        "bg-page": "#f3f4f6",
        "bg-card": "#ffffff",
        "border-default": "#e5e7eb",
        "border-subtle": "#eef0f2",
        "border-subtle-2": "#f3f4f6",
        "text-primary": "#1a1d29",
        "text-secondary": "#6b7280",
        "text-tertiary": "#9aa0ab",
        "accent-blue": "#2f6fed",
        "accent-blue-bg": "#eef2ff",
      },
    },
  },
  plugins: [],
};

export default config;
