import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Coverage lane for @relay/app's vitest (browser) tests. Mirrors
// vendor/agent-device/vitest.config.ts coverage shape (v8 provider,
// lcov + json-summary reporters) without adding a dependency: the
// workspace does not install @vitest/coverage-v8, but the vendored
// agent-device tree ships one, so it is loaded as a custom provider.
const vendoredCoverageV8 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../vendor/agent-device/node_modules/@vitest/coverage-v8/dist/index.js",
);

export default defineConfig({
  plugins: [solid({ hot: false })],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.browser.test.tsx"],
    coverage: {
      provider: "custom",
      customProviderModule: vendoredCoverageV8,
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.stories.tsx",
        "src/**/types.ts",
        "src/**/*-types.ts",
      ],
    },
  },
});
