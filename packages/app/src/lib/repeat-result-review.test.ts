import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import {
  findPreviousApprovedRepeatCapture,
  projectRepeatResultEvidence,
  repeatResultDecision,
} from "./repeat-result-review";

function run(input: Partial<JobInfo> & Pick<JobInfo, "id">): JobInfo {
  return {
    action: "settings-localization",
    status: "ok",
    queuedAt: 100,
    logs: [],
    matrixCase: {
      kind: "combine",
      appMapId: "settings",
      testId: "settings-localization",
      world: "Português · Pixel 9",
      values: { language: "pt-BR", device: "pixel-9" },
    },
    targetProfile: {
      id: "pixel-9",
      targetId: "serial",
      source: "device",
      platform: "android",
      name: "Pixel 9",
      capabilities: [],
      observedAt: 1,
    },
    ...input,
  } as JobInfo;
}

test("previous baseline requires an older human-approved exact tuple, target, Test, and checkpoint", () => {
  const approved = run({
    id: "approved",
    batchId: "old",
    queuedAt: 10,
    review: {
      schemaVersion: 1,
      status: "approved",
      capability: "visual-baseline",
      reason: "Approved checkpoint",
      requestedAt: 19,
      decidedAt: 20,
      decidedBy: { id: "human:reviewer", kind: "human" },
    },
    frames: [{ path: "data-controls-old.png", caption: "screen:Data Controls", capturedAt: 12 }],
  });
  const wrongTuple = run({
    id: "wrong-locale",
    batchId: "old-2",
    queuedAt: 20,
    review: {
      schemaVersion: 1,
      status: "approved",
      capability: "visual-baseline",
      reason: "Approved checkpoint",
      requestedAt: 20,
      decidedAt: 21,
      decidedBy: { id: "human:reviewer", kind: "human" },
    },
    matrixCase: {
      kind: "combine",
      appMapId: "settings",
      testId: "settings-localization",
      world: "Deutsch · Pixel 9",
      values: { language: "de", device: "pixel-9" },
    },
    frames: [{ path: "de.png", caption: "screen:Data Controls", capturedAt: 21 }],
  });
  const current = run({ id: "current", batchId: "new", queuedAt: 100 });

  assert.equal(
    findPreviousApprovedRepeatCapture([wrongTuple, approved, current], current, "Data Controls")
      ?.job.id,
    "approved",
  );
  assert.equal(
    findPreviousApprovedRepeatCapture(
      [{ ...approved, review: undefined }, current],
      current,
      "Data Controls",
    ),
    null,
    "an earlier pass is not silently promoted into an approved baseline",
  );
});

test("previous baseline rejects generic approvals and another target behind the same profile", () => {
  const approved = run({
    id: "approved",
    batchId: "old",
    queuedAt: 10,
    review: {
      schemaVersion: 1,
      status: "approved",
      capability: "visual-baseline",
      reason: "Approved checkpoint",
      requestedAt: 19,
      decidedAt: 20,
      decidedBy: { id: "human:reviewer", kind: "human" },
    },
    frames: [{ path: "data-controls-old.png", caption: "screen:Data Controls", capturedAt: 12 }],
  });
  const genericApproval = run({
    ...approved,
    id: "generic-approval",
    batchId: "generic",
    queuedAt: 80,
    review: { ...approved.review!, capability: "run-result" },
  });
  const otherPhysicalTarget = run({
    ...approved,
    id: "other-target",
    batchId: "other",
    queuedAt: 90,
    targetProfile: { ...approved.targetProfile!, targetId: "different-serial" },
  });
  const current = run({ id: "current", batchId: "new", queuedAt: 100 });

  assert.equal(
    findPreviousApprovedRepeatCapture(
      [genericApproval, otherPhysicalTarget, approved, current],
      current,
      "Data Controls",
    )?.job.id,
    "approved",
    "newer ineligible reviews must not shadow the exact visual baseline",
  );
  assert.equal(
    findPreviousApprovedRepeatCapture([genericApproval, current], current, "Data Controls"),
    null,
  );
  assert.equal(
    findPreviousApprovedRepeatCapture([otherPhysicalTarget, current], current, "Data Controls"),
    null,
  );
});

test("selected result projection separates findings and reports causal proof gaps deterministically", () => {
  const job = run({
    id: "failed",
    status: "error",
    failureCategory: "locator",
    error: "Settings target was absent",
    logs: ["one", "two", "three"],
    steps: [
      {
        id: "open",
        index: 0,
        kind: "tap",
        tone: "danger",
        status: "failed",
        title: "Open Settings",
        glyphs: [],
        startedAt: 1,
        frames: [],
        log: "",
      },
    ],
    artifacts: [
      {
        kind: "selector-resolution",
        capturedAt: 2,
        data: { reason: "Accessibility label Settings did not resolve" },
      },
      { kind: "crash-report", capturedAt: 3, data: { message: "SIGABRT" } },
      { kind: "semantic-evaluation", capturedAt: 4, data: { summary: "Heading changed" } },
    ],
    evidence: {
      schemaVersion: 1,
      runId: "failed",
      target: { kind: "device", platform: "android" },
      startedAt: 1,
      channels: {
        screenshot: { channel: "screenshot", status: "captured", count: 1 },
        semantics: { channel: "semantics", status: "missing", count: 0 },
      } as never,
      events: [],
    },
  });
  const result = projectRepeatResultEvidence({
    job,
    verdict: "failed",
    analysis: {
      findings: [
        {
          id: "missing-control",
          code: "CONTROL_MISSING",
          severity: "critical",
          confidence: "high",
          canonicalKey: "data-controls",
          screenLabel: "Data Controls",
          locale: "pt-BR",
          baselineLocale: "en",
          detail: "Data controls was absent",
        },
        {
          id: "clipped",
          code: "POSSIBLE_TEXT_CLIPPED",
          severity: "warning",
          confidence: "medium",
          canonicalKey: "data-controls",
          screenLabel: "Data Controls",
          locale: "pt-BR",
          baselineLocale: "en",
          detail: "Text may be clipped",
        },
      ],
    },
  });

  assert.equal(result.decision.label, "Could not verify");
  assert.equal(result.structuralFindings.length, 1);
  assert.equal(result.localizationFindings.length, 1);
  assert.deepEqual(result.semanticFindings, ["Heading changed"]);
  assert.match(result.firstCausalFailure ?? "", /Open Settings · Target not found/u);
  assert.equal(result.crash, "SIGABRT");
  assert.match(result.selectorReasoning ?? "", /Accessibility label Settings/u);
  assert.equal(result.evidence.status, "partial");
  assert.deepEqual(result.evidence.missing, ["semantics: missing"]);
  assert.equal(repeatResultDecision("pass").label, "Passed");
  assert.equal(repeatResultDecision("clipped").label, "Needs review");
});
