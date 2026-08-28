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
  assert.deepEqual(first.summary, {
    verdict: "passed",
    affectedTests: 1,
    passed: 1,
    regressions: 0,
    review: 0,
    insufficient: 0,
  });
  assert.deepEqual(first.confidence, { value: 1, basis: "deterministic-policy" });
  assert.equal(first.evidenceCompleteness.status, "complete");
  assert.equal(first.smallestRequiredLiveVerification.required, false);
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
  assert.equal(result.summary.verdict, "insufficient");
  assert.equal(result.smallestRequiredLiveVerification.action, "select-and-run-one-test");
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
  assert.equal(result.summary.verdict, "insufficient");
  assert.equal(result.smallestRequiredLiveVerification.action, "run-one-affected-test");
  assert.ok(result.reasons.some((reason) => /evidence/iu.test(reason)));
});

test("a known causal failure dominates partial corroborating evidence", async () => {
  const failedRun = frozenRun();
  failedRun.id = "run-failed";
  failedRun.status = "error";
  failedRun.inputDigest = "c".repeat(64);
  failedRun.artifacts = failedRun.artifacts.map((artifact) =>
    artifact.kind === "campaign-check-result"
      ? {
          ...artifact,
          data: {
            ...(artifact.data as Record<string, unknown>),
            status: "failed",
            error: "Settings missing",
          },
        }
      : artifact,
  );
  const failed = await exportTracePack(failedRun);
  const partial = structuredClone(await exportTracePack(frozenRun()));
  delete partial.completeness.artifacts;
  const { digest: _oldDigest, ...body } = partial;
  partial.digest = digest(body);

  const result = verifyChangeOffline({
    selectionKind: "trace-packs",
    tracePacks: [partial, failed],
  });

  assert.equal(result.summary.verdict, "regressions");
  assert.equal(result.decision, "reject");
  assert.equal(result.firstCausalFailure?.runId, "run-failed");
  assert.equal(result.smallestRequiredLiveVerification.required, false);
});

test("reviewed external effects produce an explicit bounded human-review boundary", async () => {
  const run = frozenRun();
  run.recipeSnapshot = {
    id: "root",
    name: "Root",
    steps: [
      {
        id: "open-provider",
        kind: "tap",
        target: { label: "Open provider" },
        reviewedExternalEffects: {
          schemaVersion: 1,
          effects: ["external-app"],
          reviewedBy: "human:reviewer",
          reviewedAt: 10,
          reason: "The provider handoff is an intentional part of this Test.",
        },
      },
    ],
  } as never;
  run.recipeGraph = { root: run.recipeSnapshot } as never;

  const result = verifyChangeOffline({
    selectionKind: "runs",
    tracePacks: [await exportTracePack(run)],
  });

  assert.equal(result.summary.verdict, "review");
  assert.equal(result.execution, "confirmation-required");
  assert.deepEqual(result.ruleIds, ["execution.confirmation-required"]);
  assert.equal(result.smallestRequiredLiveVerification.action, "review-and-confirm");
  assert.equal(result.mutation, "none");
});

test("verify-change uses the worst frozen risk for one Test independent of pack order", async () => {
  const safeRun = frozenRun();
  safeRun.id = "run-safe";
  safeRun.inputDigest = "d".repeat(64);
  const guardedRun = frozenRun();
  guardedRun.id = "run-guarded";
  guardedRun.inputDigest = "e".repeat(64);
  guardedRun.recipeSnapshot = {
    id: "root",
    name: "Root",
    steps: [
      {
        id: "open-provider",
        kind: "tap",
        target: { label: "Open provider" },
        reviewedExternalEffects: {
          schemaVersion: 1,
          effects: ["external-app"],
          reviewedBy: "human:reviewer",
          reviewedAt: 10,
          reason: "This Test intentionally leaves the app.",
        },
      },
    ],
  } as never;
  guardedRun.recipeGraph = { root: guardedRun.recipeSnapshot } as never;
  const safe = await exportTracePack(safeRun);
  const guarded = await exportTracePack(guardedRun);

  const safeFirst = verifyChangeOffline({
    selectionKind: "trace-packs",
    tracePacks: [safe, guarded],
  });
  const guardedFirst = verifyChangeOffline({
    selectionKind: "trace-packs",
    tracePacks: [guarded, safe],
  });

  assert.equal(safeFirst.summary.verdict, "review");
  assert.equal(guardedFirst.summary.verdict, "review");
  assert.equal(safeFirst.affectedTests[0]?.executionRisk.level, "guarded");
  assert.deepEqual(safeFirst.affectedTests, guardedFirst.affectedTests);
  assert.deepEqual(safeFirst.ruleIds, ["execution.confirmation-required"]);
  assert.deepEqual(safeFirst.affectedTests[0]?.evidenceRunIds, ["run-guarded", "run-safe"]);
});

test("source-revision selection trusts only matching frozen TracePack provenance", async () => {
  const run = frozenRun();
  run.sourceRevision = { vcs: "git", sha: "abcdef1" };
  const result = verifyChangeOffline({
    selectionKind: "source-revision",
    sourceRevision: { vcs: "git", sha: "abcdef0" },
    tracePacks: [await exportTracePack(run)],
  });

  assert.equal(result.summary.verdict, "insufficient");
  assert.equal(result.affectedTests.length, 0);
  assert.equal(result.evidence.length, 0);
  assert.ok(
    result.unresolvedUncertainty.includes("source-revision-provenance-unproved:run-verified"),
  );
});

test("verify-change bounds aggregate uncertainty without silently dropping the overflow", () => {
  const result = verifyChangeOffline({
    selectionKind: "source-revision",
    sourceRevision: { vcs: "git", sha: "abcdef0" },
    selectionUncertainty: Array.from({ length: 300 }, (_, index) => `uncertainty:${index}`),
  });

  assert.equal(result.unresolvedUncertainty.length, 128);
  assert.ok(
    result.unresolvedUncertainty.some((item) => item.startsWith("report-items-truncated:")),
  );
  assert.equal(result.summary.verdict, "insufficient");
});
