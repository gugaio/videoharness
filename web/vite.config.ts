import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const playbackObserver = (subpath: string) => fileURLToPath(new URL(`packages/playback-observer/src/${subpath}`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@streammock/playback-observer/hls": playbackObserver("hls/index.ts"),
      "@streammock/playback-observer": playbackObserver("index.ts"),
    },
  },
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
