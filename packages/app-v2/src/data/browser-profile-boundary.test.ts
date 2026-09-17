// @vitest-environment node
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";

it("bundles browser target profiles without device drivers or Node builtins", async () => {
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "assert-browser-profile-boundary",
        enforce: "pre",
        resolveId(source) {
          if (builtins.has(source.replace(/^node:/u, "")) || source.startsWith("playwright")) {
            throw new Error(`Browser target profile imports server dependency: ${source}`);
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(import.meta.dirname, "../../../core/src/browser-case-profile-target.ts"),
        formats: ["es"],
      },
    },
  });
  expect(result).toBeDefined();
});
