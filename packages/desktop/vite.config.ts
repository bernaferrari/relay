import { resolve } from "node:path";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

/** Renderer-only Vite config (Vite+). Main/preload are built with esbuild. */
export default defineConfig({
  root: resolve("src/renderer"),
  base: "./",
  // Tailwind must process @relay/app styles (utility classes in app TSX).
  plugins: [solid(), tailwindcss()],
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
    exclude: ["@relay/app", "@relay/ui"],
  },
});
