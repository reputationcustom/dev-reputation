import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // Sidebar/mobile-topbar switch point — confirmed against the original
      // claude.ai/design prototype (`window.innerWidth < 900`), see CLAUDE.md.
      // Extends (doesn't replace) Tailwind's stock sm/md/lg/xl/2xl scale.
      screens: {
        shell: "900px",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      colors: {
        // Base/neutros — ver .dev/specs/_design-tokens.md
        "bg-page": "#f3f4f6",
        "bg-sidebar": "#12203f",
        "bg-sidebar-active": "#1a2c52",
        "bg-card": "#ffffff",
        "border-default": "#e5e7eb",
        "border-subtle": "#eef0f2",
        "border-subtle-2": "#f3f4f6",
        "text-primary": "#1a1d29",
        "text-secondary": "#6b7280",
        "text-tertiary": "#9aa0ab",
        "text-sidebar-inactive": "#c3cde3",
        "text-sidebar-section-label": "#6b83b3",

        // Acento
        "accent-blue": "#2f6fed",
        "accent-blue-bg": "#eef2ff",

        // Sentimento (net_sentiment, -100 a 100, 7 faixas)
        "sentiment-very-positive": "#0d7a3e",
        "sentiment-very-positive-bg": "#e0f5e9",
        "sentiment-positive": "#1a9d5c",
        "sentiment-positive-bg": "#eafaf1",
        "sentiment-slightly-positive": "#4caf7a",
        "sentiment-slightly-positive-bg": "#eefaf3",
        "sentiment-neutral": "#8a8f98",
        "sentiment-neutral-bg": "#f3f4f6",
        "sentiment-slightly-negative": "#e0a13e",
        "sentiment-slightly-negative-bg": "#fdf3e0",
        "sentiment-negative": "#e0483e",
        "sentiment-negative-bg": "#fdecea",
        "sentiment-very-negative": "#a52820",
        "sentiment-very-negative-bg": "#fbe3e1",

        // Momentum/Velocidade (0-100, 5 faixas, mesma rampa pras duas)
        "intensity-1": "#c9cdd3",
        "intensity-2": "#a8c5f5",
        "intensity-3": "#2f6fed",
        "intensity-4": "#f2811d",
        "intensity-5": "#e0483e",

        // Risco (risk_score, 0-100, 4 faixas)
        "risk-low": "#1a9d5c",
        "risk-low-bg": "#eafaf1",
        "risk-medium": "#e0a13e",
        "risk-medium-bg": "#fdf3e0",
        "risk-high": "#f2811d",
        "risk-high-bg": "#fdf0e4",
        "risk-critical": "#c62828",
        "risk-critical-bg": "#fbe3e1",

        // Ideologia (entities.ideologia, 5 faixas esquerda→direita) — ver
        // .dev/specs/_design-tokens.md. Diverging violeta↔teal com neutro
        // cinza no centro — deliberadamente não reusa vermelho/verde
        // (sentimento) nem laranja/vermelho (risco).
        "ideology-left": "#6d28d9",
        "ideology-left-bg": "#f3ecfd",
        "ideology-center-left": "#a78bda",
        "ideology-center-left-bg": "#f5f1fb",
        "ideology-center": "#8a8f98",
        "ideology-center-bg": "#f3f4f6",
        "ideology-center-right": "#5fb8ba",
        "ideology-center-right-bg": "#eaf7f7",
        "ideology-right": "#0d9488",
        "ideology-right-bg": "#e3f6f4",

        // Plataformas (identificadores visuais, não cor de marca oficial)
        "platform-twitter": "#1a1d29",
        "platform-instagram": "#c2417a",
        "platform-news": "#2f6fed",
        "platform-facebook": "#3b5ba9",
        "platform-video": "#c23b3b",
        "platform-blog": "#8b5cf6",
        "platform-forum": "#6b7280",
        "platform-other": "#9aa0ab",
      },
    },
  },
  plugins: [],
};

export default config;
