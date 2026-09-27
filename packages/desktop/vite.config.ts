import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve("src/renderer"),
  base: "./",
  publicDir: resolve("src/renderer/public"),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve("out/renderer"),
    emptyOutDir: true,
    // Playwright's optional BiDi bridge is loaded only by Node-side browser
    // execution. Keep its CJS-only modules out of the renderer bundle; the
    // packaged server bundle applies the same boundary.
    rolldownOptions: {
      external: [
        "chromium-bidi/lib/cjs/bidiMapper/BidiMapper",
        "chromium-bidi/lib/cjs/cdp/CdpConnection",
        "kerberos",
      ],
    },
  },
  optimizeDeps: {
    exclude: ["@relay/app", "@relay/ui-react"],
  },
});
