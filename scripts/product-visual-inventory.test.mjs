import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { visualFixtures, visualViewports } from "./product-visual-fixture-inventory.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_ROOT = resolve(ROOT, "packages/app/visual-fixtures");
const FIXTURE_ROUTES = resolve(ROOT, "packages/app/src/visual-fixtures/fixture-routes.ts");

function expectedBaselines() {
  const names = [];
  for (const fixture of visualFixtures) {
    for (const viewport of visualViewports) {
      names.push(`${fixture.id}-${viewport.id}.png`);
    }
  }
  return names.sort();
}

async function baselineFiles(dir) {
  return (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
}

test("visual fixture ids are unique and every viewport id is unique", () => {
  assert.equal(new Set(visualFixtures.map((fixture) => fixture.id)).size, visualFixtures.length);
  assert.equal(
    new Set(visualViewports.map((viewport) => viewport.id)).size,
    visualViewports.length,
  );
});

test("checked-in baselines exactly match the fixture matrix on every platform", async () => {
  const expected = expectedBaselines();
  for (const dir of [BASELINE_ROOT, resolve(BASELINE_ROOT, "linux")]) {
    const actual = await baselineFiles(dir);
    const missing = expected.filter((name) => !actual.includes(name));
    const orphaned = actual.filter((name) => !expected.includes(name));
    assert.deepEqual(
      { missing, orphaned },
      { missing: [], orphaned: [] },
      `${dir} drifted from the visual fixture matrix`,
    );
  }
});

test("every visual regression fixture has a fixture-route definition", async () => {
  const source = await readFile(FIXTURE_ROUTES, "utf8");
  const defined = new Set(
    [...source.matchAll(/^\s+"?([\w-]+)"?:\s*\{\s*path:/gmu)].map((match) => match[1]),
  );
  const missing = visualFixtures.filter((fixture) => !defined.has(fixture.id));
  assert.deepEqual(
    missing.map((fixture) => fixture.id),
    [],
  );
});
