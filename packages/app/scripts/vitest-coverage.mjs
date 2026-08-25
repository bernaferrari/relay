import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const require = createRequire(import.meta.url);

function coverageV8Resolvable() {
  for (const base of [repoRoot, packageRoot]) {
    try {
      require.resolve("@vitest/coverage-v8/package.json", { paths: [base] });
      return true;
    } catch {}
  }
  return false;
}

async function coverageConfigPresent() {
  const configPath = resolve(packageRoot, "vitest.coverage.config.ts");
  try {
    await access(configPath);
    return true;
  } catch {
    return false;
  }
}

// The vitest (browser component) lane mirrors vendor/agent-device's coverage
// shape via vitest.coverage.config.ts, but the workspace intentionally installs
// no coverage provider. Skip with a precise reason instead of failing.
if (!coverageV8Resolvable()) {
  console.warn(
    "[@relay/app] skipping vitest coverage lane: @vitest/coverage-v8 is not installed " +
      "(zero-new-deps policy). node:test coverage above covers src/**/*.test.ts; install " +
      "@vitest/coverage-v8 to enable component (.browser.test.tsx) coverage.",
  );
  process.exit(0);
}

if (!(await coverageConfigPresent())) {
  console.warn("[@relay/app] skipping vitest coverage lane: vitest.coverage.config.ts not found.");
  process.exit(0);
}

const args = ["run", "--config", "vitest.coverage.config.ts", "--coverage"];
execFileSync(resolve(repoRoot, "node_modules/.bin/vitest"), args, {
  cwd: packageRoot,
  stdio: "inherit",
});
