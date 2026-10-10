import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateProductContract,
  findProductAdvancedVocabulary,
  loadProductContract,
  PRODUCT_ADVANCED_TERMS,
  PRODUCT_OVERLAY_PRIORITY,
  PRODUCT_ROUTES,
} from "./product-contract.mjs";

test("tracked product contract matches the route registry and vocabulary", async () => {
  const document = await loadProductContract();
  assert.deepEqual(evaluateProductContract({ document }), []);
});

test("a missing product contract fails instead of skipping verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-product-contract-"));
  try {
    await assert.rejects(loadProductContract(root), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a stale route or advanced term fails the contract", async () => {
  const document = await loadProductContract();
  const staleRoute = document.replace("/batches/:batchId\n", "");
  assert.ok(
    evaluateProductContract({ document: staleRoute }).includes(
      "documented route missing: /batches/:batchId",
    ),
  );
  const staleTerm = document.replace("publication receipt, ", "");
  assert.ok(
    evaluateProductContract({ document: staleTerm }).includes(
      "documented advanced term missing: publication receipt",
    ),
  );
});

test("route fixture is canonical and overlay priority is deterministic", () => {
  assert.equal(new Set(PRODUCT_ROUTES).size, PRODUCT_ROUTES.length);
  assert.deepEqual(PRODUCT_OVERLAY_PRIORITY, [
    "menu",
    "popover",
    "inline editor",
    "dialog",
    "sheet",
    "temporary inspector",
    "canvas selection",
  ]);
});

test("advanced engine nouns are explicit and cannot be silently public", () => {
  const document =
    "## Promise and public model\n## Canonical routes\n## Interaction laws\n## Responsive and accessibility contract\n## Public vocabulary boundary\n## One product shell";
  const violations = evaluateProductContract({
    document,
    advancedTerms: PRODUCT_ADVANCED_TERMS.slice(0, -1),
  });
  assert.ok(violations.some((violation) => violation.includes("advanced term missing")));
});

test("ordinary UI copy can be checked for advanced engine vocabulary", () => {
  assert.deepEqual(findProductAdvancedVocabulary("Run this Test on a Device"), []);
  assert.deepEqual(findProductAdvancedVocabulary("Open the Variable Combine Cell details"), [
    "Variable",
    "Combine",
    "Cell",
  ]);
});

test("browser and Electron smoke commands cover Live with existing a11y/layout harnesses", async () => {
  const [browser, electron] = await Promise.all([
    readFile(new URL("./product-browser-smoke.mjs", import.meta.url), "utf8"),
    readFile(new URL("./product-electron-smoke.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(browser, /openRoute\(page, "\/sessions"\)/u);
  assert.match(electron, /openRoute\(page, "\/sessions"\)/u);
  assert.match(browser, /opening \$\{appUrl\}\/tests/u);
  assert.match(electron, /waitForRoute\(page, "\/tests"\)/u);
  assert.match(browser, /clickNav\(page, "Devices", "\/devices"\)/u);
  assert.match(electron, /clickNav\(page, "Devices", "\/devices"\)/u);
  assert.match(electron, /openRoute\(page, "\/changes"\)/u);
  assert.match(electron, /clickNav\(page, "Runs", "\/runs"\)/u);
  for (const source of [browser, electron]) {
    assert.match(source, /AxeBuilder/u);
    assert.match(source, /assertAccessible/u);
    assert.match(source, /assert(?:Minimum)?Layout/u);
  }
  assert.match(browser, /assertKeyboardFocus/u);
});

test("the renderer imports error projection without traversing the Product server barrel", async () => {
  const [productPackage, recordingShared] = await Promise.all([
    readFile(new URL("../packages/product/package.json", import.meta.url), "utf8"),
    readFile(new URL("../packages/app/src/routes/recording-shared.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(productPackage).exports["./errors"], "./src/errors.ts");
  assert.match(recordingShared, /from "@relay\/product\/errors"/u);
  assert.doesNotMatch(recordingShared, /from "@relay\/product"/u);
});

test("repository verification and CI require Product acceptance gates", async () => {
  const [packageJson, workflow] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);
  const verify = JSON.parse(packageJson).scripts.verify;
  const scripts = JSON.parse(packageJson).scripts;
  for (const command of ["test:visual", "test:browser", "test:electron"]) {
    assert.match(verify, new RegExp(`pnpm run ${command}`, "u"));
    assert.match(workflow, new RegExp(`pnpm run ${command}`, "u"));
  }
  assert.match(scripts["test:browser"], /^pnpm run ensure:acceptance && /u);
  assert.match(scripts["test:electron"], /^pnpm run ensure:acceptance && /u);
});

test("local CI executes repository checks on a self-hosted runner", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/local-ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /^    runs-on: \[self-hosted, macOS, relay-local-ci\]$/mu);
  assert.match(workflow, /pnpm run check/u);
  assert.match(workflow, /pnpm run check:architecture/u);
  assert.match(workflow, /pnpm run test:architecture/u);
  assert.doesNotMatch(workflow, /^    runs-on:.*ubuntu-latest/mu);
  assert.doesNotMatch(workflow, /relay-golden-device/u);
  assert.doesNotMatch(workflow, /pnpm dev:app/u);
});
