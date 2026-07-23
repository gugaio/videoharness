import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        harness: {
          bg: "#070810",
          panel: "#0d101b",
          border: "#1e2333",
          text: "#f4f5f7",
          muted: "#9aa1b5",
          accent: "#dbe3ff",
          success: "#43d18b",
        },
      },
      boxShadow: {
        panel: "0 32px 90px rgba(0, 0, 0, 0.42)",
        glow: "0 0 80px rgba(127, 157, 255, 0.12)",
        card: "0 18px 50px rgba(0, 0, 0, 0.35)",
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(0.82)" },
        },
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(250%)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.35" },
          "30%": { transform: "translateY(-4px)", opacity: "1" },
        },
        "aurora-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(4%, -3%, 0) scale(1.08)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        shimmer: "shimmer 1.8s ease-in-out infinite",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
        "aurora-drift": "aurora-drift 16s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
