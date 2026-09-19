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
      ".worktrees/**",
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
    // Oxlint-native plugins only. Setting `plugins` replaces the default set,
    // which would otherwise include the ESLint-compat and unicorn ports.
    plugins: ["oxc", "typescript"],
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
      // ESLint-compat ports stay off. Lint is Oxlint + @shadcn/lint only.
      "eslint/no-unused-vars": "off",
      "eslint/no-unsafe-optional-chaining": "off",
      "no-unused-vars": "off",
      "no-unsafe-optional-chaining": "off",
      "shadcn/no-inline-styles": ["error", { allow: ["transform"] }],
      "shadcn/require-static-classes": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": [
        "error",
        {
          allow: [
            "grid-cols-*",
            "grid-rows-*",
            "auto-rows-*",
            "auto-cols-*",
            "col-span-*",
            "row-span-*",
            "[-webkit-app-region:*]",
            "[scrollbar-gutter:*]",
            "outline-offset-*",
            "z-*",
            "shadow-[var(--*)]",
            "text-[var(--*)]",
            "bg-[color-mix(*)]",
            "h-(--*)",
            "w-(--*)",
            "min-w-(--*)",
            "min-h-(--*)",
            "max-w-(--*)",
            "max-h-(--*)",
            "left-(--*)",
            "top-(--*)",
            "translate-x-(--*)",
            "translate-y-(--*)",
            "rounded-[min(*)]",
            "rounded-[inherit]",
            "transition-[*]",
            "w-[min(*)]",
            "w-[*%]",
            "min-w-[min(*)]",
            "min-h-[min(*)]",
            "max-w-[min(*)]",
            "max-w-[calc(*)]",
            "max-w-[*ch]",
            "max-h-[min(*)]",
            "max-h-[*dvh]",
            "max-h-[*vh]",
            "h-[min(*)]",
            "px-[clamp(*)]",
            "pt-[clamp(*)]",
            "pb-[max(*)]",
            "data-[*]",
            "left-[*%]",
            "right-[*%]",
            "top-[*%]",
            "inset-x-[*%]",
            "h-[*%]",
            "max-h-[*%]",
            "max-w-[*%]",
            "h-[*dvh]",
            "h-[*vh]",
            "w-[*vw]",
            "max-[*]:h-[*dvh]",
            "max-[*]:min-h-[*px]",
            "max-[*]:col-end-*",
            "h-[calc(*)]",
            "md:h-[calc(*)]",
            "-translate-y-[*%]",
            "aspect-*",
            "min-w-[*ch]",
            "w-[*ch]",
            "[background-size:*]",
            "bg-[radial-gradient(*)]",
            "text-[color-mix(*)]",
            "[&*]",
          ],
        },
      ],
      "shadcn/no-restyle": [
        "error",
        {
          allow: ["*"],
          contracts: [
            { pattern: "^Button$", allow: ["layout", "[-webkit-app-region:*]"] },
            {
              pattern: "^Badge$",
              allow: ["layout", "color", "typography", "spacing"],
            },
            {
              pattern: "^Input$|^Textarea$",
              allow: ["layout", "spacing", "typography", "color"],
            },
            {
              pattern: "^Card(Header|Title|Description|Content|Footer)?$",
              allow: ["layout", "spacing", "typography", "color"],
            },
            {
              pattern: "^Alert$",
              allow: ["layout", "spacing", "typography", "color", "shape"],
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
          "shadcn/no-arbitrary-values": "off",
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
      ".worktrees/**",
      "vendor/**",
      "packages/*/dist/**",
      "packages/*/out/**",
      "packages/*/release/**",
    ],
  },
});
