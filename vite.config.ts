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
      "packages/*/out/**",
      "packages/*/release/**",
      // Relay owns the canonical, Git-stable serializer for executable tests.
      // A general source formatter must not rewrite that domain format.
      "tests/**/*.relay.yaml",
    ],
  },
  lint: {
    jsPlugins: ["@shadcn/lint"],
    settings: {
      shadcn: {
        // Product code imports primitives from the workspace package, not a
        // local `@/components/ui` path. Keep this scoped to that prefix so
        // each app still discovers its own theme via components.json.
        ui: "@relay/ui-react/components",
        note: "See DESIGN_SYSTEM.md and packages/app-v2/DESIGN.md.",
      },
    },
    rules: {
      "shadcn/no-inline-styles": "error",
      "shadcn/require-static-classes": "error",
      "shadcn/no-restyle": [
        "error",
        {
          // Default: any recognized component may take any class.
          // Button is the only primitive that owns its appearance.
          deny: ["__relay-no-restyle-placeholder__"],
          contracts: [
            {
              pattern: "^Button$",
              allow: ["layout", "relay-*", "[-webkit-app-region:*]"],
            },
          ],
        },
      ],
    },
    overrides: [
      {
        files: ["packages/ui-react/src/components/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/require-static-classes": "off",
        },
      },
    ],
    options: {
      typeAware: false,
      typeCheck: false,
    },
    ignorePatterns: [
      "dist/**",
      "node_modules/**",
      "vendor/**",
      "packages/*/dist/**",
      "packages/*/out/**",
      "packages/*/release/**",
    ],
  },
});
