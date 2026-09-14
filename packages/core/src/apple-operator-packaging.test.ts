import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findDeveloperIdApplicationIdentities,
  inspectOperatorDesktopPackaging,
  requireDeveloperIdApplicationIdentity,
} from "./apple-operator-packaging.js";

const developmentOnly =
  '  1) 8562AF4B1AC3B85D40AC21B17B4C6CC79E71FED1 "Apple Development: Bernardo Ferrari (DESXYH8838)"\n     1 valid identities found';

const developerId =
  '  1) DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF "Developer ID Application: Relay QA (ABCD123456)"\n     1 valid identities found';

const mixed = `${developmentOnly}\n  2) DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF "Developer ID Application: Relay QA (ABCD123456)"\n     2 valid identities found`;

test("Apple Development is not a Developer ID Application identity", () => {
  assert.deepEqual(findDeveloperIdApplicationIdentities(developmentOnly), []);
  assert.deepEqual(findDeveloperIdApplicationIdentities("0 valid identities found"), []);
  assert.deepEqual(findDeveloperIdApplicationIdentities(null), []);
});

test("parses Developer ID Application even when Apple Development is also present", () => {
  assert.deepEqual(findDeveloperIdApplicationIdentities(developerId), [
    { name: "Developer ID Application: Relay QA", teamId: "ABCD123456" },
  ]);
  assert.deepEqual(findDeveloperIdApplicationIdentities(mixed), [
    { name: "Developer ID Application: Relay QA", teamId: "ABCD123456" },
  ]);
});

test("operator packaging fails closed on Apple Development only", () => {
  const status = inspectOperatorDesktopPackaging(developmentOnly);
  assert.equal(status.status, "needs-attention");
  assert.match(status.detail, /Developer ID Application/u);
  assert.match(status.detail, /Apple Development is not enough/u);
  assert.equal(status.identityName, undefined);
  assert.throws(
    () => requireDeveloperIdApplicationIdentity(developmentOnly),
    /Apple Development is not enough/u,
  );
});

test("operator packaging is ready only with Developer ID Application", () => {
  const status = inspectOperatorDesktopPackaging(mixed);
  assert.equal(status.status, "ready");
  assert.equal(status.identityName, "Developer ID Application: Relay QA");
  assert.equal(requireDeveloperIdApplicationIdentity(mixed), "Developer ID Application: Relay QA");
});
