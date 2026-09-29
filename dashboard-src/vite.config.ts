import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { assetsInlineLimit: 262144, chunkSizeWarningLimit: 2000 },
  server: { host: true, port: 5173, proxy: { "/api": { target: process.env.OSA_API ?? "http://127.0.0.1:3111", rewrite: (p) => p.replace(/^\/api/, "") } } },
});
