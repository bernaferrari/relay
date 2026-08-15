import assert from "node:assert/strict";
import test from "node:test";
import type { RecipeStep } from "./recipes.js";
import type { TestJob } from "./session-contract.js";
import {
  findReusableSurfaceComparison,
  surfaceComparisonCacheIdentity,
  surfaceComparisonCacheKey,
} from "./surface-comparison-cache.js";

const step: Extract<RecipeStep, { kind: "capture-surface" }> = {
  kind: "capture-surface",
  screenId: "preferences",
  screenTitle: "Preferences",
  variantId: "preferences-tablet-en",
  surfaceId: "preferences-surface",
  baselineCaptureId: "baseline-1",
  reason: "Stable product-owned surface",
  baseline: { compositeWidth: 100, compositeHeight: 300, semanticNodeCount: 12 },
};

function job(overrides: Partial<TestJob> = {}) {
  return {
    projectId: "project-1",
    serial: "device-1",
    platform: "ios" as const,
    targetProfile: {
      id: "tablet-profile",
      targetId: "device-1",
      source: "device" as const,
      platform: "ios" as const,
      name: "Tablet",
      capabilities: [],
      observedAt: 1,
    },
    resolvedInputs: { locale: "en-US", app_version: "42.7" },
    artifacts: [],
    ...overrides,
  } as Pick<
    TestJob,
    | "projectId"
    | "serial"
    | "browserTargetId"
    | "platform"
    | "targetProfile"
    | "resolvedInputs"
    | "appVersion"
    | "artifacts"
  >;
}

function result(identity: NonNullable<ReturnType<typeof surfaceComparisonCacheIdentity>>) {
  return {
    kind: "logical-scroll-surface-result",
    capturedAt: 100,
    data: {
      schemaVersion: 1,
      screenId: step.screenId,
      screenTitle: step.screenTitle,
      variantId: step.variantId,
      surfaceId: step.surfaceId,
      baselineCaptureId: step.baselineCaptureId,
      capture: {
        captureId: "capture-live-1",
        capturedAt: 90,
        status: "completed",
        viewports: [
          {
            screenshot: { sha256: "shot" },
            accessibilityTree: { sha256: "tree" },
          },
        ],
        composite: { sha256: "composite" },
        mergedTree: { sha256: "merged" },
        manifest: { sha256: "manifest" },
      },
      comparison: {
        policy: "visual-and-semantic",
        matches: true,
        visualMatches: true,
        semanticMatches: true,
      },
      repair: { status: "not-needed" },
      cache: {
        schemaVersion: 1,
        status: "miss",
        evaluatedAt: 80,
        key: surfaceComparisonCacheKey(identity),
        identity,
      },
    },
  };
}

test("reuses a complete comparison only for the exact immutable identity", () => {
  const identity = surfaceComparisonCacheIdentity(job(), step)!;
  const reused = findReusableSurfaceComparison({
    identity,
    runs: [
      {
        id: "run-source",
        status: "ok",
        finishedAt: 110,
        writtenAt: 111,
        artifacts: [result(identity)],
      },
    ],
    at: 200,
  });
  assert.equal(reused?.data.capture.captureId, "capture-live-1");
  assert.deepEqual(reused?.provenance, {
    schemaVersion: 1,
    status: "hit",
    evaluatedAt: 200,
    key: surfaceComparisonCacheKey(identity),
    identity,
    sourceRunId: "run-source",
    sourceArtifactCapturedAt: 100,
    sourceCaptureId: "capture-live-1",
    sourceCapturedAt: 90,
  });
});

test("target, locale, app build, baseline, and logical surface changes all miss", () => {
  const identity = surfaceComparisonCacheIdentity(job(), step)!;
  const source = {
    id: "run-source",
    status: "ok",
    writtenAt: 110,
    artifacts: [result(identity)],
  };
  const changed = [
    surfaceComparisonCacheIdentity(
      job({
        serial: "device-2",
        targetProfile: { ...job().targetProfile!, targetId: "device-2" },
      }),
      step,
    )!,
    surfaceComparisonCacheIdentity(
      job({ resolvedInputs: { locale: "ja", app_version: "42.7" } }),
      step,
    )!,
    surfaceComparisonCacheIdentity(
      job({ resolvedInputs: { locale: "en-US", app_version: "43" } }),
      step,
    )!,
    surfaceComparisonCacheIdentity(job(), { ...step, baselineCaptureId: "baseline-2" })!,
    surfaceComparisonCacheIdentity(job(), { ...step, surfaceId: "account-surface" })!,
  ];
  for (const candidate of changed) {
    assert.equal(
      findReusableSurfaceComparison({ identity: candidate, runs: [source], at: 200 }),
      null,
    );
  }
});

test("unknown locale or app build fails closed", () => {
  assert.equal(
    surfaceComparisonCacheIdentity(job({ resolvedInputs: { app_version: "42.7" } }), step),
    null,
  );
  assert.equal(
    surfaceComparisonCacheIdentity(job({ resolvedInputs: { locale: "en-US" } }), step),
    null,
  );
});

test("incomplete, failed, and legacy-provenance results are never reused", () => {
  const identity = surfaceComparisonCacheIdentity(job(), step)!;
  const complete = result(identity);
  const incomplete = structuredClone(complete);
  incomplete.data.capture.status = "stopped";
  const { cache: _cache, ...legacyData } = structuredClone(complete).data;
  const legacy = { ...complete, data: legacyData };
  for (const [status, artifact] of [
    ["error", complete],
    ["ok", incomplete],
    ["ok", legacy],
  ] as const) {
    assert.equal(
      findReusableSurfaceComparison({
        identity,
        runs: [{ id: "source", status, writtenAt: 100, artifacts: [artifact] }],
        at: 200,
      }),
      null,
    );
  }
});

test("cache chains keep the original raw-capture provenance", () => {
  const identity = surfaceComparisonCacheIdentity(job(), step)!;
  const cached = result(identity);
  Object.assign(cached.data.cache, {
    status: "hit",
    sourceRunId: "run-original",
    sourceArtifactCapturedAt: 50,
    sourceCaptureId: "capture-original",
    sourceCapturedAt: 40,
  });
  const reused = findReusableSurfaceComparison({
    identity,
    runs: [{ id: "run-cache", status: "ok", writtenAt: 150, artifacts: [cached] }],
    at: 200,
  });
  assert.equal(reused?.provenance.sourceRunId, "run-original");
  assert.equal(reused?.provenance.sourceArtifactCapturedAt, 50);
  assert.equal(reused?.provenance.sourceCaptureId, "capture-original");
  assert.equal(reused?.provenance.sourceCapturedAt, 40);
});
