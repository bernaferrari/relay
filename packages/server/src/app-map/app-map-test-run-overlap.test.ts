import assert from "node:assert/strict";
import test from "node:test";
import { browserTestRunOverlapAdmission } from "./app-map-test-run-overlap.js";

const local = (key: string) => ({
  key,
  source: "local" as const,
  reference: `signin:00000000-0000-4000-8000-000000000000:1`,
});

test("local saved sign-in keys earn account overlap only when sharing permits it", () => {
  assert.deepEqual(
    browserTestRunOverlapAdmission({
      targetKind: "browser",
      signIns: [local("admin"), local("member")],
      sharing: "safe-shared-read",
    }),
    {
      browserAccountOverlap: {
        accountKeys: ["admin", "member"],
        sharing: "safe-shared-read",
      },
    },
  );
  assert.deepEqual(
    browserTestRunOverlapAdmission({
      targetKind: "browser",
      signIns: [local("member")],
      sharing: "isolated-account",
    }).browserAccountOverlap?.sharing,
    "isolated-account",
  );
  assert.equal(
    browserTestRunOverlapAdmission({
      targetKind: "browser",
      signIns: [local("member")],
      sharing: "fail-closed",
    }).browserAccountOverlap,
    undefined,
  );
});

test("ambient environment credentials never prove account separability", () => {
  assert.deepEqual(
    browserTestRunOverlapAdmission({
      targetKind: "browser",
      signIns: [{ key: "member", source: "environment" }],
      sharing: "safe-shared-read",
    }),
    {},
  );
});

test("signed-in tests never join unsigned isolation; unsigned safe tests keep it", () => {
  assert.deepEqual(
    browserTestRunOverlapAdmission({
      targetKind: "browser",
      signIns: [],
      sharing: "safe-shared-read",
    }),
    { browserIsolation: "independent" },
  );
  assert.equal(
    browserTestRunOverlapAdmission({
      targetKind: "browser",
      signIns: [local("member")],
      sharing: "safe-shared-read",
    }).browserIsolation,
    undefined,
  );
});

test("lane, fixture, batch-external device, and non-browser work keep existing serialization", () => {
  for (const override of [
    { laneId: "nightly" },
    { authenticationFixtureId: "authfx:member:1" },
    { targetKind: "device" as const },
  ]) {
    assert.deepEqual(
      browserTestRunOverlapAdmission({
        targetKind: "browser",
        signIns: [local("member")],
        sharing: "safe-shared-read",
        ...override,
      }),
      {},
    );
  }
});
