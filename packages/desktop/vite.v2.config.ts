import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve("src/renderer-v2"),
  base: "./",
  publicDir: resolve("src/renderer-v2/public"),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve("out/renderer-v2"),
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ["@relay/app-v2", "@relay/ui-react", "@relay/ui"],
  },
});
