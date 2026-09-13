import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  publicDir: resolve(import.meta.dirname, "public"),
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin API for Vite tabs (including the Cursor browser). Direct
      // :8787 stays origin-locked; do not widen server CORS for localhost UI.
      "/relay": {
        target: (process.env.RELAY_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, ""),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/relay/, "") || "/",
        ws: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            proxyReq.removeHeader("referer");
          });
        },
      },
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    // Route tests eagerly resolve the production lazy-route graph. Keep the
    // per-test budget aligned with the repository gate so cold parallel
    // transforms cannot fail a correct interaction after Vitest's 5s default.
    testTimeout: 30_000,
  },
});
