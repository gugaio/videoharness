import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/s/": "http://localhost:8080",
      "/ws/": "http://localhost:8080",
	  "/i/": "http://localhost:8080",
    },
  },
});
