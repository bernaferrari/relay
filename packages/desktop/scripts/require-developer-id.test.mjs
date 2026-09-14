import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { developerIdApplicationFromKeychain } from "./require-developer-id.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(scripts, "..");

test("mac dist and package refuse to run electron-builder without Developer ID Application", () => {
  const packageJson = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8"));
  assert.match(packageJson.scripts.dist, /sign-mac-dist\.mjs/u);
  assert.match(packageJson.scripts.package, /sign-mac-dist\.mjs/u);
  assert.doesNotMatch(packageJson.scripts.dist, /electron-builder --mac dmg/u);
  assert.doesNotMatch(packageJson.scripts.package, /electron-builder --mac dir/u);
});

test("Apple Development cannot satisfy the mac dist identity preflight", () => {
  const developmentOnly =
    '  1) 8562AF4B1AC3B85D40AC21B17B4C6CC79E71FED1 "Apple Development: Bernardo Ferrari (DESXYH8838)"\n     1 valid identities found';
  assert.throws(
    () => developerIdApplicationFromKeychain(developmentOnly),
    /Apple Development is not enough/u,
  );
});

test("Developer ID Application is the only accepted mac dist identity", () => {
  const mixed =
    '  1) 8562AF4B1AC3B85D40AC21B17B4C6CC79E71FED1 "Apple Development: Bernardo Ferrari (DESXYH8838)"\n  2) DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF "Developer ID Application: Relay QA (ABCD123456)"\n     2 valid identities found';
  assert.equal(developerIdApplicationFromKeychain(mixed), "Developer ID Application: Relay QA");
});

test("mac dist signing never auto-discovers Apple Development", () => {
  const signer = readFileSync(resolve(scripts, "sign-mac-dist.mjs"), "utf8");
  assert.match(signer, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/u);
  assert.match(signer, /config\.mac\.identity=/u);
});
