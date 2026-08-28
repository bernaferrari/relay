import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { exportTracePack } from "./trace-pack.js";
import type { PersistedRun } from "./runs.js";
import { VERIFY_CHANGE_POLICY, verifyChangeOffline } from "./verify-change.js";

function frozenRun(): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-verified",
    action: "app-map:map-1:test-1",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    startedAt: 2,
    finishedAt: 3,
    logs: [],
    steps: [],
    frames: [],
    dir: "",
    writtenAt: 4,
    recipeSnapshot: { id: "root", name: "Root", steps: [] } as never,
    recipeGraph: { root: { id: "root", name: "Root", steps: [] } } as never,
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: 1,
        data: {
          schemaVersion: 1,
          appMapId: "map-1",
          appMapRevision: 2,
          test: { id: "test-1", name: "Settings" },
          recipes: {},
        },
      },
      {
        kind: "campaign-transition-proof",
        capturedAt: 2,
        data: { checkId: "open-settings", status: "verified" },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 3,
        data: { id: "open-settings", title: "Open Settings", status: "passed" },
      },
    ],
    inputDigest: "b".repeat(64),
    resolvedInputs: {},
    evidence: {
      schemaVersion: 1,
      runId: "run-verified",
      target: { kind: "device", platform: "android" },
      startedAt: 2,
      finishedAt: 3,
      channels: {},
      events: [],
    } as never,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex")}`;
}

test("verify-change composes frozen risk and evidence into a deterministic read-only decision", async () => {
  const pack = await exportTracePack(frozenRun());
  const first = verifyChangeOffline({ selectionKind: "runs", tracePacks: [pack] });
  const second = verifyChangeOffline({ selectionKind: "runs", tracePacks: [pack] });

  assert.deepEqual(second, first);
  assert.equal(first.policy.id, VERIFY_CHANGE_POLICY.id);
  assert.equal(first.policy.version, VERIFY_CHANGE_POLICY.version);
  assert.equal(first.decision, "approve");
  assert.deepEqual(first.ruleIds, ["verification.proved"]);
  assert.deepEqual(first.evidenceRefs, [pack.digest]);
  assert.deepEqual(first.unresolvedUncertainty, []);
  assert.equal(first.mutation, "none");
  assert.equal(first.checkPosting, "none");
});

test("verify-change fails closed when affected-test selection and evidence are unavailable", () => {
  const result = verifyChangeOffline({
    selectionKind: "source-revision",
    sourceRevision: { vcs: "git", sha: "abcdef0" },
    selectionUncertainty: ["affected-test-selection-unavailable:source-revision:abcdef0"],
  });

  assert.equal(result.decision, "reject");
  assert.deepEqual(result.ruleIds, ["execution.prohibited"]);
  assert.equal(result.affectedTests.length, 0);
  assert.ok(
    result.unresolvedUncertainty.includes(
      "affected-test-selection-unavailable:source-revision:abcdef0",
    ),
  );
});

test("legacy TracePacks without an artifact closure cannot claim complete approval evidence", async () => {
  const current = await exportTracePack(frozenRun());
  const legacy = structuredClone(current);
  delete legacy.completeness.artifacts;
  const { digest: _oldDigest, ...body } = legacy;
  legacy.digest = digest(body);

  const result = verifyChangeOffline({ selectionKind: "trace-packs", tracePacks: [legacy] });

  assert.equal(result.decision, "insufficient-evidence");
  assert.equal(result.evidence[0]?.status, "partial");
  assert.ok(result.reasons.some((reason) => /evidence/iu.test(reason)));
});
