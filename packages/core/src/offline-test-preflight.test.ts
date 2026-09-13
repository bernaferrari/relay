import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

function plan(steps: AppMapCompiledTest["recipes"][string]["steps"]): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "grok",
    appMapRevision: 1,
    test: { id: "relay-40", name: "Relay 40", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    recipes: { root: { id: "root", title: "Root", parameters: [], steps } },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
}

const observation = {
  fingerprint: "settings",
  nodes: [
    { role: "button", identifier: "appearance", label: "Appearance", hittable: true },
    { role: "textview", label: "Birth Year" },
    { role: "button", label: "Delete conversations", hittable: true },
    { role: "button", label: "Delete conversations", hittable: true },
  ],
  volatileSignals: [],
};

test("raw preflight defers only a unique disabled control after text entry", () => {
  const send = {
    role: "button",
    label: "Send message",
    enabled: false,
    hittable: true,
    rect: { x: 20, y: 100, width: 44, height: 44 },
  };
  function report(nodes: (typeof send)[], typed: boolean) {
    return preflightCompiledAppMapTestOffline(
      plan([
        { kind: "expect-screen", screenId: "chat", screenTitle: "Chat", fingerprint: "chat" },
        ...(typed ? [{ kind: "type" as const, text: "hello" }] : []),
        { kind: "tap", target: { label: "Send message" } },
      ]),
      { rawObservationsByScreenId: { chat: [nodes] } },
    );
  }
  const afterTyping = report([send], true);
  assert.equal(afterTyping.summary.blockers, 0);
  assert.equal(afterTyping.summary.warnings, 1);
  assert.match(afterTyping.findings[0]!.message, /check it again before clicking/);
  assert.equal(afterTyping.selectors[0]!.status, "absent");
  assert.equal(report([send], false).summary.blockers, 1);
  assert.equal(report([{ ...send, label: "Unrelated" }], true).summary.blockers, 1);
  assert.equal(
    report([send, { ...send, rect: { ...send.rect, y: 200 } }], true).summary.blockers,
    1,
  );
  assert.equal(report([{ ...send, rect: { ...send.rect, width: 0 } }], true).summary.blockers, 1);
});

test("offline preflight blocks absent selectors but keeps flattened-tree ambiguity reviewable", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "settings",
        observations: [observation],
      },
      { kind: "tap", id: "appearance", target: { identifier: "appearance" } },
      { kind: "tap", id: "missing", target: { label: "Cloud filter" } },
      { kind: "tap", id: "duplicate", target: { label: "Delete conversations" } },
    ]),
  );
  assert.equal(report.summary.checkedSelectors, 3);
  assert.equal(report.summary.blockers, 1);
  assert.equal(report.summary.warnings, 1);
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["selector-absent", "selector-ambiguous"],
  );
});

test("offline preflight carries deterministic reviewed external-effect risk", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
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
    ]),
  );

  assert.equal(report.executionRisk.level, "guarded");
  assert.equal(report.executionRisk.confirmation, "once-per-run");
  assert.deepEqual(report.executionRisk.externalEffects, ["external-app"]);
});

test("offline preflight rejects invented Cloud filter copy unless a typed locator explains it", () => {
  const cloud = {
    fingerprint: "cloud",
    nodes: [
      { role: "textview", label: "Cloud Storage" },
      { role: "view", label: "Filter and sort" },
    ],
    volatileSignals: [],
  };
  const invented = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "cloud",
        screenTitle: "Cloud Storage",
        fingerprint: "cloud",
        observations: [cloud],
      },
      { kind: "tap", id: "open-filter-cloud-storage", target: { label: "Filter cloud storage" } },
    ]),
  );
  assert.deepEqual(
    invented.findings.map((finding) => finding.code),
    ["selector-absent"],
  );
  const proven = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "cloud",
        screenTitle: "Cloud Storage",
        fingerprint: "cloud",
        observations: [cloud],
      },
      { kind: "tap", id: "open-filter-cloud-storage", target: { label: "filter and sort" } },
    ]),
  );
  assert.deepEqual(proven.findings, []);
});

test("offline preflight keeps Birth Year independent of the stored user year", () => {
  const inventedYear = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "profile",
        screenTitle: "Edit profile",
        fingerprint: "profile",
        observations: [observation],
      },
      { kind: "tap", id: "open-birth-year", target: { label: "1994" } },
    ]),
  );
  assert.deepEqual(
    inventedYear.findings.map((finding) => finding.code),
    ["selector-absent"],
  );
  const heading = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "profile",
        screenTitle: "Edit profile",
        fingerprint: "profile",
        observations: [observation],
      },
      {
        kind: "tap",
        id: "open-birth-year",
        target: { relation: { kind: "following-row", anchor: { label: "Birth Year" } } },
      },
    ]),
  );
  assert.deepEqual(
    heading.findings.map((finding) => finding.code),
    ["selector-needs-raw-tree"],
  );
});

test("offline preflight follows the runtime identifier-to-label fallback", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "settings",
        observations: [
          {
            ...observation,
            nodes: [{ role: "button", label: "Settings", hittable: true }],
          },
        ],
      },
      {
        kind: "tap",
        id: "settings",
        target: { identifier: "settings_button", label: "Settings", role: "button" },
      },
    ]),
  );
  assert.deepEqual(report.findings, []);
});

test("offline preflight leaves an absent tap with semantic fallbacks for live confirmation", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "home",
        screenTitle: "Home",
        fingerprint: "home",
        observations: [observation],
      },
      {
        kind: "tap",
        id: "submit",
        target: { label: "Submit" },
        fallbackTargets: [{ identifier: "appearance" }],
      },
    ]),
  );
  assert.deepEqual(
    report.findings.map((finding) => [finding.severity, finding.code]),
    [["warning", "selector-absent"]],
  );
});

test("offline preflight leaves an absent reviewed coordinate for live confirmation", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "home",
        screenTitle: "Home",
        fingerprint: "home",
        observations: [observation],
      },
      {
        kind: "tap",
        id: "navigation",
        target: {
          label: "Navigation",
          point: { x: 44, y: 200, fallbackPolicy: "reviewed" },
        },
      },
    ]),
  );
  assert.deepEqual(
    report.findings.map((finding) => [finding.severity, finding.code]),
    [["warning", "selector-absent"]],
  );
});

test("offline preflight uses a frozen full-surface index for a reveal and its tap", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "reveal",
        id: "reveal-supergrok",
        target: { label: "SuperGrok" },
        navigation: [
          {
            schemaVersion: 1,
            surfaceId: "settings",
            captureId: "capture",
            documentHeight: 2_000,
            viewportHeight: 800,
            targetOrder: 0,
            targetDocumentY: 400,
            anchors: [
              {
                order: 0,
                documentY: 400,
                target: { label: "SuperGrok" },
                label: "SuperGrok",
                role: "button",
              },
            ],
          },
        ],
      },
      { kind: "tap", id: "tap-supergrok", target: { label: "SuperGrok" } },
    ]),
  );
  assert.deepEqual(report.findings, []);
});

test("offline preflight keeps a following-row repair and incomplete surface honest", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "profile",
        screenTitle: "Profile",
        fingerprint: "profile",
        observations: [observation],
      },
      {
        kind: "tap",
        id: "birth-year",
        target: { relation: { kind: "following-row", anchor: { label: "Birth Year" } } },
      },
      {
        kind: "capture-surface",
        screenId: "settings",
        screenTitle: "Settings",
        variantId: "android-en",
        surfaceId: "settings-surface",
        baselineCaptureId: "stopped-capture",
        reason: "Settings",
        baselineTrust: "recapture-required",
        baselineTrustReason: "Baseline capture is stopped/seam-ambiguous.",
      },
    ]),
  );
  assert.equal(report.summary.blockers, 0);
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["selector-needs-raw-tree", "surface-recapture-required"],
  );
});

test("offline preflight proves a following-row target from immutable raw evidence", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "profile",
        screenTitle: "Profile",
        fingerprint: "profile",
      },
      {
        kind: "tap",
        id: "birth-year",
        target: { relation: { kind: "following-row", anchor: { label: "Birth Year" } } },
      },
    ]),
    {
      rawObservationsByScreenId: {
        profile: [
          [
            {
              index: 1,
              parentIndex: 0,
              role: "textview",
              label: "Birth Year",
              rect: { x: 20, y: 100, width: 150, height: 32 },
            },
            {
              index: 2,
              parentIndex: 0,
              role: "button",
              label: "1994",
              hittable: true,
              rect: { x: 20, y: 140, width: 320, height: 48 },
            },
          ],
        ],
      },
    },
  );
  assert.deepEqual(report.findings, []);
});

test("offline preflight requests one recapture for a missing or unreadable raw source tree", () => {
  const compiled = plan([
    {
      kind: "expect-screen",
      id: "profile-source",
      screenId: "profile",
      screenTitle: "Profile",
      fingerprint: "profile",
    },
    { kind: "tap", id: "birth-year", target: { label: "Birth Year" } },
    {
      kind: "expect-screen",
      id: "profile-again",
      screenId: "profile",
      screenTitle: "Profile",
      fingerprint: "profile",
    },
  ]);
  const report = preflightCompiledAppMapTestOffline(compiled, {
    rawEvidenceStatusByScreenId: { profile: "unreadable" },
  });
  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.equal(report.summary.blockers, 1);
  assert.deepEqual(
    report.findings.filter((finding) => finding.code === "raw-evidence-recapture-required"),
    [
      {
        severity: "blocker",
        code: "raw-evidence-recapture-required",
        recipeId: "root",
        recipeStepId: "birth-year",
        screenId: "profile",
        message:
          "Profile's frozen raw accessibility tree is unavailable or corrupt; recapture this screen before relying on offline geometry.",
      },
    ],
  );
});

test("offline preflight blocks an ambiguous raw selector instead of trusting its flat summary", () => {
  const report = preflightCompiledAppMapTestOffline(
    plan([
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "settings",
        observations: [observation],
      },
      { kind: "tap", id: "voice", target: { label: "Voice" } },
    ]),
    {
      rawObservationsByScreenId: {
        settings: [
          [
            {
              role: "button",
              label: "Voice",
              hittable: true,
              rect: { x: 20, y: 100, width: 320, height: 48 },
            },
            {
              role: "button",
              label: "Voice",
              hittable: true,
              rect: { x: 20, y: 220, width: 320, height: 48 },
            },
          ],
        ],
      },
    },
  );
  assert.equal(report.findings[0]?.severity, "blocker");
  assert.equal(report.findings[0]?.code, "selector-ambiguous");
});

test("offline preflight is deterministic and never turns unresolved Back into a gesture", () => {
  const compiled = plan([
    {
      kind: "expect-screen",
      id: "return-needed",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "settings",
      returnRequirement: {
        connectionId: "return-from-help",
        fromScreenId: "help",
        destinationScreenId: "settings",
      },
    },
  ]);
  const first = preflightCompiledAppMapTestOffline(compiled);
  assert.deepEqual(preflightCompiledAppMapTestOffline(structuredClone(compiled)), first);
  assert.equal(first.findings[0]?.code, "unresolved-return");
  assert.equal(first.findings[0]?.severity, "blocker");
});

test("offline preflight exposes deterministic selector, cursor, return, and frozen-evidence ledgers", () => {
  const compiled = plan([
    {
      kind: "expect-screen",
      id: "settings-source",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "settings",
    },
    { kind: "tap", id: "open-usage", target: { label: "Usage", role: "button" } },
    {
      kind: "reveal",
      id: "reveal-voice",
      target: { label: "Voice", role: "button" },
      navigation: [
        {
          schemaVersion: 1,
          surfaceId: "settings-surface",
          captureId: "capture-2",
          documentHeight: 2_400,
          viewportHeight: 800,
          targetOrder: 9,
          targetDocumentY: 1_680,
          anchors: [],
        },
      ],
    },
    {
      kind: "expect-screen",
      id: "return-settings",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "settings",
      returnRequirement: {
        connectionId: "return-from-usage",
        fromScreenId: "settings",
        destinationScreenId: "usage",
      },
    },
  ]);
  const evidence = {
    rawObservationsByScreenId: {
      settings: [
        [
          {
            role: "button",
            label: "Usage",
            hittable: true,
            rect: { x: 20, y: 100, width: 320, height: 48 },
          },
          {
            role: "button",
            label: "Voice",
            hittable: true,
            rect: { x: 20, y: 420, width: 320, height: 48 },
          },
        ],
      ],
    },
    rawEvidenceReferencesByScreenId: {
      settings: ["relay-evidence://b", "relay-evidence://a", "relay-evidence://a"],
    },
  };
  const first = preflightCompiledAppMapTestOffline(compiled, evidence);
  const reorderedPlan = Object.fromEntries(
    Object.entries(structuredClone(compiled)).reverse(),
  ) as AppMapCompiledTest;
  const second = preflightCompiledAppMapTestOffline(reorderedPlan, evidence);

  assert.equal(second.planDigest, first.planDigest);
  assert.deepEqual(first.summary, {
    recipes: 1,
    checkedSelectors: 2,
    resolvedSelectors: 2,
    unknownCursorTransitions: 1,
    reviewRequiredReturns: 1,
    blockers: 1,
    warnings: 0,
  });
  assert.deepEqual(
    first.selectors.map((selector) => ({
      id: selector.recipeStepId,
      status: selector.status,
      references: selector.evidence.references,
      method: selector.resolution?.method,
      revealPositions: selector.revealPositions,
    })),
    [
      {
        id: "open-usage",
        status: "resolved",
        references: ["relay-evidence://a", "relay-evidence://b"],
        method: "label",
        revealPositions: undefined,
      },
      {
        id: "reveal-voice",
        status: "resolved",
        references: ["relay-evidence://a", "relay-evidence://b"],
        method: "label",
        revealPositions: [
          {
            surfaceId: "settings-surface",
            captureId: "capture-2",
            targetOrder: 9,
            targetDocumentY: 1_680,
            direction: "auto",
          },
        ],
      },
    ],
  );
  assert.deepEqual(
    first.cursorTimeline.map((cursor) => [cursor.recipeStepId, cursor.state, cursor.screenId]),
    [
      ["settings-source", "expected", "settings"],
      ["open-usage", "unknown", undefined],
      ["return-settings", "return-required", "settings"],
    ],
  );
  assert.deepEqual(first.returns, [
    {
      recipeId: "root",
      recipeStepId: "return-settings",
      connectionId: "return-from-usage",
      sourceScreenId: "usage",
      destinationScreenId: "settings",
      status: "review-required",
    },
  ]);
});
