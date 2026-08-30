import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Relay's local-trust boundary names this exact browser origin. Silently
    // falling forward to 5174/5175 makes a healthy service look offline and
    // trains people to retry the wrong thing.
    strictPort: true,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
