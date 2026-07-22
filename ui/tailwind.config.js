export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                harness: {
                    bg: "#080a10",
                    panel: "#10131c",
                    border: "#272c39",
                    text: "#f4f5f7",
                    muted: "#9298a8",
                    accent: "#dbe3ff",
                    success: "#43d18b"
                }
            },
            boxShadow: {
                panel: "0 32px 90px rgba(0, 0, 0, 0.42)",
                glow: "0 0 80px rgba(127, 157, 255, 0.12)"
            },
            fontFamily: {
                sans: ["Inter", "SF Pro Display", "Segoe UI", "sans-serif"],
                mono: ["IBM Plex Mono", "SFMono-Regular", "Menlo", "monospace"]
            }
        }
    },
    plugins: []
};
