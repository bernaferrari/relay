import { defineConfig } from "vite-plus";

/**
 * Vite+ config for the Grok device-actions Node CLI (not a web app).
 *
 *   vp run dev                 interactive menu (package.json script)
 *   vp exec tsx src/cli.ts …   direct action
 *   vp check
 *   vp pack
 */
export default defineConfig({
  pack: {
    entry: "src/cli.ts",
    format: ["esm"],
    platform: "node",
    target: "node22",
    dts: false,
    sourcemap: true,
    deps: {
      neverBundle: ["agent-device"],
    },
  },

  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "node_modules/**", "pnpm-lock.yaml"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ["dist/**", "node_modules/**"],
  },
});
