import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.SPIKE_APP_PORT ?? 3000);
const strictPort = process.env.SPIKE_APP_STRICT_PORT !== "false";

export default defineConfig({
  root: "apps/spike-app",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port,
    strictPort,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port
  }
});
