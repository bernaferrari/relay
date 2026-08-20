import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  AppMapCompiledRawAccessibilitySource,
  AppMapCompiledTest,
  RawAccessibilityTreeEvidence,
} from "@relay/protocol";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

function plan(
  rawAccessibilityTreesByScreenId: NonNullable<
    AppMapCompiledTest["rawAccessibilityTreesByScreenId"]
  > = {},
): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "grok",
    appMapRevision: 1,
    test: { id: "relay-40", name: "Relay 40", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    rawAccessibilityTreesByScreenId,
    recipes: {
      root: {
        id: "root",
        title: "Root",
        parameters: [],
        steps: [
          {
            kind: "expect-screen",
            id: "profile",
            screenId: "profile",
            screenTitle: "Edit Profile",
            fingerprint: "profile",
          },
          {
            kind: "tap",
            id: "birth-year",
            target: {
              relation: {
                kind: "following-row",
                anchor: { identifier: "profile.birth-year", label: "Birth Year" },
              },
            },
          },
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

function sourcePlan(
  rawAccessibilitySourcesByScreenId: NonNullable<
    AppMapCompiledTest["rawAccessibilitySourcesByScreenId"]
  >,
): AppMapCompiledTest {
  return {
    ...plan(),
    rawAccessibilitySourcesByScreenId,
  };
}

function rawTree(
  id: string,
  value: unknown,
): { reference: RawAccessibilityTreeEvidence; bytes: Buffer } {
  const bytes = Buffer.from(JSON.stringify(value));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    reference: {
      id,
      uri: `relay-evidence://${sha256}`,
      sha256,
      mime: "application/json",
      bytes: bytes.byteLength,
    },
    bytes,
  };
}

const reflowedBirthYearTree = {
  nodes: [
    {
      index: 0,
      type: "android.widget.ScrollView",
      rect: { x: 0, y: 120, width: 1080, height: 1920 },
    },
    {
      index: 10,
      parentIndex: 0,
      type: "android.widget.TextView",
      identifier: "profile.birth-year",
      label: "Ano de nascimento em duas linhas",
      enabled: true,
      visibleToUser: true,
      rect: { x: 72, y: 620, width: 620, height: 96 },
    },
    {
      index: 11,
      parentIndex: 0,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      rect: { x: 45, y: 748, width: 990, height: 136 },
    },
    {
      index: 12,
      parentIndex: 11,
      type: "android.view.View",
      enabled: true,
      visibleToUser: true,
      hittable: true,
      rect: { x: 45, y: 748, width: 990, height: 136 },
    },
    {
      index: 13,
      parentIndex: 12,
      type: "android.widget.TextView",
      label: "1994",
      enabled: true,
      visibleToUser: true,
      rect: { x: 192, y: 790, width: 90, height: 53 },
    },
  ],
};

test("loads a translated/reflowed raw tree with immutable source provenance", async () => {
  const tree = rawTree("profile-pt-tree", reflowedBirthYearTree);
  const source: AppMapCompiledRawAccessibilitySource = {
    screenId: "profile",
    variant: {
      id: "profile-pt",
      targetProfileId: "ipad-pt-BR",
      targetId: "ipad-1",
      platform: "ios",
      viewport: { width: 834, height: 1112 },
    },
    origin: {
      kind: "screen-variant",
      observationId: "observation-profile-pt",
      capturedAt: 10,
    },
    tree: tree.reference,
  };
  const compiled = sourcePlan({ profile: [source] });

  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === tree.reference.sha256 ? tree.bytes : null),
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);
  const selector = report.selectors[0]!;

  assert.deepEqual(report.findings, []);
  assert.equal(selector.status, "resolved");
  assert.deepEqual(selector.resolution, {
    method: "relation",
    activation: "snapshot-point",
    snapshotBounds: { x: 45, y: 748, width: 990, height: 136 },
    provenance: {
      reference: tree.reference.uri,
      evidenceId: "profile-pt-tree",
      sha256: tree.reference.sha256,
      variant: source.variant,
      origin: source.origin,
    },
  });
  assert.deepEqual(selector.evidence.sources, [selector.resolution?.provenance]);
  assert.deepEqual(
    selector.rawCandidates?.map((candidate) => [
      candidate.relation,
      candidate.node.index,
      candidate.node.parentIndex,
      candidate.node.bounds,
      candidate.node.hittable,
      candidate.owner?.index,
    ]),
    [
      ["relation-anchor", 10, 0, { x: 72, y: 620, width: 620, height: 96 }, undefined, undefined],
      ["following-row", 12, 11, { x: 45, y: 748, width: 990, height: 136 }, true, 12],
    ],
  );
});

test("rejects a partially corrupted frozen source set instead of using the surviving tree", async () => {
  const valid = rawTree("profile-valid-tree", reflowedBirthYearTree);
  const corrupt = rawTree("profile-corrupt-tree", { nodes: [{ label: "not this tree" }] });
  const compiled = plan({ profile: [valid.reference, corrupt.reference] });

  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) =>
      sha256 === valid.reference.sha256
        ? valid.bytes
        : sha256 === corrupt.reference.sha256
          ? Buffer.from('{"not":"a snapshot"}')
          : null,
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);
  const selector = report.selectors[0]!;

  assert.equal(evidence.rawEvidenceStatusByScreenId?.profile, "unreadable");
  assert.equal(selector.status, "raw-evidence-unavailable");
  assert.equal(report.summary.blockers, 1);
  assert.deepEqual(report.findings, [
    {
      severity: "blocker",
      code: "raw-evidence-recapture-required",
      recipeId: "root",
      recipeStepId: "birth-year",
      screenId: "profile",
      message:
        "Edit Profile's frozen raw accessibility tree is unavailable or corrupt; recapture this screen before relying on offline geometry.",
      evidence: [
        {
          reference: valid.reference.uri,
          evidenceId: valid.reference.id,
          sha256: valid.reference.sha256,
        },
        {
          reference: corrupt.reference.uri,
          evidenceId: corrupt.reference.id,
          sha256: corrupt.reference.sha256,
        },
      ],
    },
  ]);
});

test("turns a frozen evidence read error into a compact recapture blocker", async () => {
  const tree = rawTree("profile-unavailable-tree", reflowedBirthYearTree);
  const compiled = plan({ profile: [tree.reference] });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async () => {
      throw new Error("evidence storage unavailable");
    },
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);

  assert.equal(evidence.rawEvidenceStatusByScreenId?.profile, "unreadable");
  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.deepEqual(
    report.findings.map((finding) => finding.code),
    ["raw-evidence-recapture-required"],
  );
  assert.deepEqual(report.findings[0]?.evidence, [
    {
      reference: tree.reference.uri,
      evidenceId: tree.reference.id,
      sha256: tree.reference.sha256,
    },
  ]);
});

test("treats a valid legacy raw reference as one observation-binding recapture", async () => {
  const tree = rawTree("profile-legacy-tree", reflowedBirthYearTree);
  const compiled = plan({ profile: [tree.reference] });
  const evidence = await loadFrozenRawAccessibilityEvidence(compiled, {
    readEvidence: async (sha256) => (sha256 === tree.reference.sha256 ? tree.bytes : null),
  });
  const report = preflightCompiledAppMapTestOffline(compiled, evidence);

  assert.equal(evidence.rawEvidenceStatusByScreenId?.profile, "unbound");
  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.deepEqual(report.findings, [
    {
      severity: "blocker",
      code: "raw-evidence-recapture-required",
      recipeId: "root",
      recipeStepId: "birth-year",
      screenId: "profile",
      message:
        "Edit Profile's frozen raw accessibility tree is not bound to its current observation; recapture this screen before relying on offline geometry.",
      evidence: [
        {
          reference: tree.reference.uri,
          evidenceId: tree.reference.id,
          sha256: tree.reference.sha256,
        },
      ],
    },
  ]);
});

test("marks a declared-but-empty raw source as one missing recapture blocker", async () => {
  const compiled = plan({ profile: [] });
  const report = preflightCompiledAppMapTestOffline(
    compiled,
    await loadFrozenRawAccessibilityEvidence(compiled, { readEvidence: async () => null }),
  );

  assert.equal(report.selectors[0]?.status, "raw-evidence-unavailable");
  assert.deepEqual(
    report.findings.map((finding) => [finding.severity, finding.code]),
    [["blocker", "raw-evidence-recapture-required"]],
  );
});
