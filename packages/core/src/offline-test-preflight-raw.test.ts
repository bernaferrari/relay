import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest, RecipeStep } from "@relay/protocol";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

function plan(input: {
  screenId: string;
  screenTitle: string;
  steps: RecipeStep[];
}): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "grok",
    appMapRevision: 1,
    test: { id: "relay-40", name: "Relay 40", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    recipes: {
      root: {
        id: "root",
        title: "Root",
        parameters: [],
        steps: [
          {
            kind: "expect-screen",
            id: `${input.screenId}-source`,
            screenId: input.screenId,
            screenTitle: input.screenTitle,
            fingerprint: input.screenId,
          },
          ...input.steps,
        ],
      },
    },
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

const voiceSource = {
  reference: "relay-evidence://voice-tree",
  evidenceId: "settings-voice-tree",
  sha256: "a".repeat(64),
};

function composeVoiceTree(extraContentRow = false) {
  return [
    {
      index: 0,
      type: "Application",
      rect: { x: 0, y: 0, width: 1080, height: 2340 },
    },
    {
      index: 1,
      parentIndex: 0,
      type: "android.widget.TextView",
      label: "Voice",
      enabled: true,
      visibleToUser: true,
      rect: { x: 80, y: 700, width: 120, height: 44 },
    },
    {
      index: 2,
      parentIndex: 0,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      hittable: true,
      rect: { x: 45, y: 780, width: 990, height: 144 },
    },
    {
      index: 3,
      parentIndex: 2,
      type: "android.widget.TextView",
      label: "Voice",
      enabled: true,
      visibleToUser: true,
      rect: { x: 180, y: 824, width: 160, height: 52 },
    },
    ...(extraContentRow
      ? [
          {
            index: 4,
            parentIndex: 0,
            type: "android.view.View",
            enabled: true,
            visibleToUser: true,
            hittable: true,
            rect: { x: 45, y: 980, width: 990, height: 144 },
          },
          {
            index: 5,
            parentIndex: 4,
            type: "android.widget.TextView",
            label: "Voice",
            enabled: true,
            visibleToUser: true,
            rect: { x: 180, y: 1024, width: 160, height: 52 },
          },
        ]
      : []),
  ];
}

test("raw provenance resolves a Compose heading plus owned row without hiding a real duplicate", () => {
  const compiled = plan({
    screenId: "settings",
    screenTitle: "Settings",
    steps: [{ kind: "tap", id: "open-voice", target: { label: "Voice" } }],
  });
  const resolved = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: {
      settings: [{ source: voiceSource, nodes: composeVoiceTree() }],
    },
  });
  const selector = resolved.selectors[0]!;

  assert.deepEqual(resolved.findings, []);
  assert.equal(selector.status, "resolved");
  assert.deepEqual(selector.resolution?.snapshotBounds, { x: 45, y: 780, width: 990, height: 144 });
  assert.deepEqual(
    selector.rawCandidates?.map((candidate) => [
      candidate.source.evidenceId,
      candidate.node.index,
      candidate.node.parentIndex,
      candidate.node.bounds,
      candidate.owner?.index,
      candidate.owner?.hittable,
      candidate.relation,
    ]),
    [
      [
        "settings-voice-tree",
        2,
        0,
        { x: 45, y: 780, width: 990, height: 144 },
        2,
        true,
        "activation-owner",
      ],
      [
        "settings-voice-tree",
        1,
        0,
        { x: 80, y: 700, width: 120, height: 44 },
        undefined,
        undefined,
        "match",
      ],
      [
        "settings-voice-tree",
        3,
        2,
        { x: 180, y: 824, width: 160, height: 52 },
        undefined,
        undefined,
        "match",
      ],
    ],
  );

  const ambiguous = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: {
      settings: [{ source: voiceSource, nodes: composeVoiceTree(true) }],
    },
  });
  const ambiguousSelector = ambiguous.selectors[0]!;
  assert.equal(ambiguousSelector.status, "ambiguous");
  assert.equal(ambiguousSelector.rawCandidateCount, 3);
  assert.deepEqual(
    ambiguousSelector.rawCandidates?.map((candidate) => candidate.node.index),
    [1, 3, 5],
  );
  assert.equal(ambiguous.findings[0]?.code, "selector-ambiguous");
  assert.deepEqual(ambiguous.findings[0]?.evidence, [voiceSource]);
});

test("sticky chrome with the same label stays a raw-tree ambiguity", () => {
  const compiled = plan({
    screenId: "settings",
    screenTitle: "Settings",
    steps: [{ kind: "tap", id: "open-voice", target: { label: "Voice" } }],
  });
  const report = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: {
      settings: [
        {
          source: voiceSource,
          nodes: [
            {
              index: 0,
              type: "Application",
              rect: { x: 0, y: 0, width: 1080, height: 2340 },
            },
            {
              index: 1,
              parentIndex: 0,
              type: "android.view.View",
              rect: { x: 0, y: 0, width: 1080, height: 160 },
            },
            {
              index: 2,
              parentIndex: 1,
              type: "android.widget.Button",
              label: "Voice",
              enabled: true,
              visibleToUser: true,
              hittable: true,
              rect: { x: 780, y: 40, width: 180, height: 72 },
            },
            {
              index: 3,
              parentIndex: 0,
              type: "android.widget.ScrollView",
              rect: { x: 0, y: 160, width: 1080, height: 2020 },
            },
            {
              index: 4,
              parentIndex: 3,
              type: "android.view.View",
              enabled: true,
              visibleToUser: true,
              hittable: true,
              rect: { x: 45, y: 700, width: 990, height: 144 },
            },
            {
              index: 5,
              parentIndex: 4,
              type: "android.widget.TextView",
              label: "Voice",
              enabled: true,
              visibleToUser: true,
              rect: { x: 180, y: 744, width: 160, height: 52 },
            },
          ],
        },
      ],
    },
  });

  assert.equal(report.selectors[0]?.status, "ambiguous");
  assert.match(report.selectors[0]?.detail ?? "", /different control locations/u);
  assert.deepEqual(
    report.selectors[0]?.rawCandidates?.map((candidate) => candidate.node.index),
    [2, 5],
  );
});

test("raw dialog ownership resolves the active control while ignoring an occluded background copy", () => {
  const compiled = plan({
    screenId: "birth-year-dialog",
    screenTitle: "Birth year",
    steps: [{ kind: "tap", id: "cancel", target: { label: "Cancel" } }],
  });
  const report = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: {
      "birth-year-dialog": [
        {
          source: {
            reference: "relay-evidence://birth-year-dialog-tree",
            evidenceId: "birth-year-dialog-tree",
            sha256: "b".repeat(64),
          },
          nodes: [
            {
              index: 0,
              type: "Application",
              rect: { x: 0, y: 0, width: 1080, height: 2340 },
            },
            {
              index: 1,
              parentIndex: 0,
              type: "android.widget.Button",
              label: "Cancel",
              enabled: true,
              visibleToUser: false,
              hittable: true,
              rect: { x: 880, y: 80, width: 120, height: 64 },
            },
            {
              index: 2,
              parentIndex: 0,
              type: "android.app.Dialog",
              rect: { x: 80, y: 820, width: 920, height: 520 },
            },
            {
              index: 3,
              parentIndex: 2,
              type: "android.widget.Button",
              label: "Cancel",
              enabled: true,
              visibleToUser: true,
              hittable: true,
              rect: { x: 620, y: 1180, width: 260, height: 88 },
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.selectors[0]?.resolution?.snapshotBounds, {
    x: 620,
    y: 1180,
    width: 260,
    height: 88,
  });
  assert.deepEqual(
    report.selectors[0]?.rawCandidates?.map((candidate) => [
      candidate.relation,
      candidate.node.index,
      candidate.node.parentIndex,
      candidate.node.visibleToUser,
      candidate.owner?.index,
    ]),
    [
      ["activation-owner", 3, 2, true, 3],
      ["match", 1, 0, false, undefined],
      ["match", 3, 2, true, undefined],
    ],
  );
});

test("Shared Conversations excludes changing content but continues to prove its exit control", () => {
  const compiled = plan({
    screenId: "shared",
    screenTitle: "Shared Conversations",
    steps: [
      {
        kind: "expect",
        id: "dynamic-row",
        target: { label: "A user-generated shared conversation" },
        condition: "visible",
      },
      { kind: "tap", id: "close-shared", target: { label: "Close" } },
    ],
  });
  const report = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: {
      shared: [
        {
          source: {
            reference: "relay-evidence://shared-shell-tree",
            evidenceId: "shared-shell-tree",
            sha256: "c".repeat(64),
          },
          nodes: [
            {
              index: 0,
              type: "Application",
              rect: { x: 0, y: 0, width: 1080, height: 2340 },
            },
            {
              index: 1,
              parentIndex: 0,
              type: "android.widget.Button",
              label: "Close",
              enabled: true,
              visibleToUser: true,
              hittable: true,
              rect: { x: 40, y: 80, width: 72, height: 72 },
            },
          ],
        },
      ],
    },
  });

  assert.equal(report.summary.excludedDynamicSelectors, 1);
  assert.equal(report.selectors[0]?.status, "excluded-dynamic-content");
  assert.equal(report.selectors[1]?.status, "resolved");
  assert.deepEqual(report.findings, []);
});

test("Shared Conversations does not request raw recapture for intentionally excluded content alone", () => {
  const compiled = plan({
    screenId: "shared",
    screenTitle: "Shared Conversations",
    steps: [
      {
        kind: "expect",
        id: "dynamic-row",
        target: { label: "A user-generated shared conversation" },
        condition: "visible",
      },
    ],
  });
  const report = preflightCompiledAppMapTestOffline(compiled, {
    rawEvidenceStatusByScreenId: { shared: "missing" },
  });

  assert.equal(report.selectors[0]?.status, "excluded-dynamic-content");
  assert.equal(report.summary.blockers, 0);
  assert.deepEqual(report.findings, []);
});
