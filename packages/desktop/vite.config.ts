import { resolve } from "node:path";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** Renderer-only Vite config (Vite+). Main/preload are built with esbuild. */
export default defineConfig({
  root: resolve("src/renderer"),
  base: "./",
  plugins: [solid()],
  resolve: {
    alias: {
      "@renderer": resolve("src/renderer"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve("out/renderer"),
    emptyOutDir: true,
  },
  // Workspace packages ship TypeScript sources
  optimizeDeps: {
    exclude: ["@grok-device/app", "@grok-device/ui"],
  },
});
