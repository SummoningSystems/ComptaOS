import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const BASE_PATH = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    {
      name: "local-pdfjs-worker",
      buildStart() {
        this.emitFile({
          type: "asset",
          fileName: "assets/pdf.worker.min.js",
          source: fs.readFileSync(path.resolve(__dirname, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs")),
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
