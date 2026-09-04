import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateProductV2Contract,
  findProductV2AdvancedVocabulary,
  loadProductV2Contract,
  PRODUCT_V2_ADVANCED_TERMS,
  PRODUCT_V2_OVERLAY_PRIORITY,
  PRODUCT_V2_ROUTES,
} from "./product-v2-contract.mjs";

test("PRODUCT_V2.md satisfies the executable route and vocabulary contract", async () => {
  assert.deepEqual(evaluateProductV2Contract({ document: await loadProductV2Contract() }), []);
});

test("route fixture is canonical and overlay priority is deterministic", () => {
  assert.equal(new Set(PRODUCT_V2_ROUTES).size, PRODUCT_V2_ROUTES.length);
  assert.deepEqual(PRODUCT_V2_OVERLAY_PRIORITY, [
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
  const violations = evaluateProductV2Contract({
    document,
    advancedTerms: PRODUCT_V2_ADVANCED_TERMS.slice(0, -1),
  });
  assert.ok(violations.some((violation) => violation.includes("advanced term missing")));
});

test("ordinary UI copy can be checked for advanced engine vocabulary", () => {
  assert.deepEqual(findProductV2AdvancedVocabulary("Run this Test on a Device"), []);
  assert.deepEqual(findProductV2AdvancedVocabulary("Open the Variable Combine Cell details"), [
    "Variable",
    "Combine",
    "Cell",
  ]);
});

test("browser and Electron smoke commands cover Sessions with existing a11y/layout harnesses", async () => {
  const [browser, electron] = await Promise.all([
    readFile(new URL("./product-v2-browser-smoke.mjs", import.meta.url), "utf8"),
    readFile(new URL("./product-v2-electron-smoke.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(browser, /clickNav\(page, "Sessions", "\/sessions"\)/u);
  assert.match(electron, /\["Sessions", "\/sessions"\]/u);
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
    readFile(
      new URL("../packages/app-v2/src/routes/recording-shared.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.equal(JSON.parse(productPackage).exports["./errors"], "./src/errors.ts");
  assert.match(recordingShared, /from "@relay\/product\/errors"/u);
  assert.doesNotMatch(recordingShared, /from "@relay\/product"/u);
});

test("repository verification and CI require Product V2 acceptance gates", async () => {
  const [packageJson, workflow] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);
  const verify = JSON.parse(packageJson).scripts.verify;
  const scripts = JSON.parse(packageJson).scripts;
  for (const command of ["test:visual:v2", "test:browser:v2", "test:electron:v2"]) {
    assert.match(verify, new RegExp(`pnpm run ${command}`, "u"));
    assert.match(workflow, new RegExp(`pnpm run ${command}`, "u"));
  }
  assert.match(scripts["test:browser:v2"], /^pnpm run ensure:acceptance:v2 && /u);
  assert.match(scripts["test:electron:v2"], /^pnpm run ensure:acceptance:v2 && /u);
});
