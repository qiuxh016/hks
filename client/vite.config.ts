import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
    fs: {
      allow: [".."]
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      },
      "/socket.io": {
        target: "http://localhost:8787",
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
