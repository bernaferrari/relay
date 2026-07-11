import { defineConfig } from "vite-plus";

/**
 * Root Vite+ config (format/lint/pack for CLI entry).
 * Package-level apps (app, desktop) use their own vite configs.
 */
export default defineConfig({
  test: {
    include: ["tests/vp/**/*.test.ts"],
    exclude: ["vendor/**", "**/node_modules/**"],
    testTimeout: 30_000,
  },
  pack: {
    entry: "packages/cli/src/index.ts",
    format: ["esm"],
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    deps: {
      neverBundle: ["agent-device", "@relay/core", "@relay/server", "@relay/tui"],
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "dist/**",
      "node_modules/**",
      "pnpm-lock.yaml",
      "vendor/**",
      "packages/*/dist/**",
    ],
  },
  lint: {
    options: {
      typeAware: false,
      typeCheck: false,
    },
    ignorePatterns: ["dist/**", "node_modules/**", "vendor/**", "packages/*/dist/**"],
  },
});
