import assert from "node:assert/strict";
import test from "node:test";
import {
  coverByArithmeticOrMarkdownJudge,
  coverByFindingSimilarlyNamedTest,
  coverByRc23DestEnd,
  destEndViewPacketMayLeftoverSkip,
  evaluateWorkbookCoverage,
  originalIsCovered,
  parseWorkbookCoverageManifest,
  rc23DestEndSatisfiesOriginal,
  rc23WorkbookBoundOriginalIds,
  requiredEvidenceNeededKinds,
  similarNamedTests,
  suggestedExecutionQueueForOriginal,
  workbookEvidenceNeededError,
  workbookEvidencePolicyError,
  workbookOriginalAllowsAutoJudge,
  workbookOriginalMayLeftoverSkip,
  workbookOriginalObligationIdentity,
  workbookRc23BindingError,
  WORKBOOK_MODELS_FAMILY_ID,
  WORKBOOK_MODELS_ORIGINAL_IDS,
  WORKBOOK_OUTPUT_FAMILY_ID,
  WORKBOOK_OUTPUT_ORIGINAL_IDS,
  WORKBOOK_SHELL_FAMILY_ID,
  WORKBOOK_SHELL_ORIGINAL_IDS,
  type WorkbookCoverageManifest,
  type WorkbookOriginal,
} from "./workbook-coverage.js";

function original(
  partial: Partial<WorkbookOriginal> & Pick<WorkbookOriginal, "id" | "name" | "status">,
): WorkbookOriginal {
  const id = partial.id;
  const family = partial.family ?? "S99";
  const evidencePacket = partial.evidencePacket ?? "view";
  return {
    gqaId: `GQA-${String(id).padStart(3, "0")}`,
    family,
    mergeMapRow: `'Merge map'!A${3 + id}:G${3 + id}`,
    criteria: "Keep the original criterion visible.",
    intent: "Do the original action.",
    evidencePacket,
    queue: "fast-ui",
    suggestedExecutionQueue: suggestedExecutionQueueForOriginal({ id, family, evidencePacket }),
    gates: [],
    bindings: [],
    ...partial,
  };
}

function fixture(overrides: Partial<WorkbookCoverageManifest> = {}): WorkbookCoverageManifest {
  const originals = overrides.originals ?? [
    original({ id: 8, name: "Presets", status: "unbound" }),
    original({ id: 37, name: "Imagine from menu", family: "S02", status: "unbound" }),
    original({
      id: 42,
      name: "Enable Dictation",
      status: "excluded",
      queue: "excluded",
      exclusion: {
        kind: "dead-skip",
        authorizedBy: "workbook",
        reason: "Skip — option will be removed.",
      },
    }),
    original({ id: 50, name: "Five-image edit (dogs / hat)", status: "unbound" }),
  ];
  return parseWorkbookCoverageManifest(
    {
      schemaVersion: 1,
      id: "fixture",
      revision: 1,
      reviewedAt: "2026-09-16",
      source: {
        workbook: "grok-qa-graph.xlsx",
        sha256: "43a2ba192fde342e074b8dac805572b23136701d0662d0a9933cb8cacc81de7a",
        originals: "'Merge map'!A4:G61",
        families: "'Suite'!A4:H20",
        exclusions: "'Dead and skip'!A4:D10",
      },
      counts: {
        originals: originals.length,
        families: 1,
        excludedFamilies: ["S15"],
        activeFamilies: 0,
        globallyExcludedOriginals: originals.filter((item) => item.status === "excluded").length,
        remainingBeforePlatformTierGates: originals.filter((item) => item.status !== "excluded")
          .length,
      },
      conflicts: [
        {
          id: "orig-50-fast-vs-heavy-expert",
          originalIds: [50],
          status: "unresolved",
          summary: "Do not guess Fast vs Heavy/Expert.",
          sources: ["Suite S11"],
        },
      ],
      notWorkbookPacks: [
        {
          packId: "grok-ios-daily",
          testIds: [
            "test-grok-ios-home-chrome",
            "test-grok-ios-dictation",
            "test-grok-ios-sidebar",
            "test-grok-ios-logo",
            "test-grok-ios-composer-focus",
            "test-grok-ios-conversations",
            "test-grok-ios-new-chat",
            "test-grok-ios-private-chat",
            "test-grok-ios-attach",
            "test-grok-ios-settings",
            "test-grok-ios-models",
            "test-grok-ios-presets",
          ],
          note: "Not the 58-row workbook.",
        },
      ],
      families: [
        {
          id: "S99",
          name: "Fixture",
          active: false,
          queue: "excluded",
          originalIds: originals.map((item) => item.id),
          suiteRow: "'Suite'!A4:H4",
        },
      ],
      originals,
      ...overrides,
    },
    { requireCompleteWorkbook: false },
  );
}

const similarCatalog = [
  { id: "test-grok-ios-presets", name: "Customize Grok peek", appMapId: "grok-ios" },
  { id: "test-grok-ios-dictation", name: "Dictation inspect", appMapId: "grok-ios" },
  { id: "test-grok-ios-imagine", name: "Imagine", appMapId: "grok-ios" },
  { id: "test-grok-ios-settings", name: "Settings", appMapId: "grok-ios" },
  {
    id: "test-grok-android-unrecorded-heavy-image-5",
    name: "UNRECORDED 5-image Heavy",
    appMapId: "grok-android",
  },
];

test("a similarly named Test does not mark an unbound original covered", () => {
  const manifest = fixture();
  const imagine = manifest.originals.find((item) => item.id === 37);
  assert.equal(imagine?.status, "unbound");
  assert.equal(
    similarNamedTests(imagine!, similarCatalog).some(
      (testRow) => testRow.id === "test-grok-ios-imagine",
    ),
    true,
  );
  assert.equal(coverByFindingSimilarlyNamedTest(imagine!, similarCatalog), false);
  assert.equal(originalIsCovered(imagine!), false);
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.equal(report.coveredOriginalIds.includes(37), false);
  assert.equal(report.unboundOriginalIds.includes(37), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 37 && row.testId === "test-grok-ios-imagine",
    ),
    true,
  );
});

test("excluded originals stay excluded even when a dest-end Test shares the name", () => {
  const manifest = fixture();
  const dictation = manifest.originals.find((item) => item.id === 42);
  assert.equal(dictation?.status, "excluded");
  assert.equal(dictation?.exclusion?.kind, "dead-skip");
  assert.equal(originalIsCovered(dictation!), false);
  assert.equal(coverByFindingSimilarlyNamedTest(dictation!, similarCatalog), false);
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.equal(report.excludedOriginalIds.includes(42), true);
  assert.equal(report.coveredOriginalIds.includes(42), false);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 42 && row.testId === "test-grok-ios-dictation",
    ),
    true,
  );
});

test("unbound originals stay unbound when the catalog has a Settings Test", () => {
  const manifest = fixture({
    originals: [original({ id: 40, name: "Settings inventory", status: "unbound" })],
  });
  const report = evaluateWorkbookCoverage(manifest, [
    { id: "test-grok-ios-settings", name: "Open Settings" },
  ]);
  assert.deepEqual(report.unboundOriginalIds, [40]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.boundCount, 0);
});

test("grok-ios-daily 12 Tests do not cover the workbook", () => {
  const manifest = fixture();
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  const pack = report.packCoverage.find((row) => row.packId === "grok-ios-daily");
  assert.equal(pack?.testCount, 12);
  assert.deepEqual(pack?.coveredOriginalIds, []);
  assert.equal(report.boundCount, 0);
});

test("only an explicit reviewed binding can cover an original", () => {
  const unbound = fixture();
  assert.equal(evaluateWorkbookCoverage(unbound).boundCount, 0);
  const bound = fixture({
    originals: [
      original({
        id: 40,
        name: "Settings inventory",
        status: "bound",
        bindings: [
          {
            kind: "reviewed",
            appMapId: "grok-web",
            testId: "test-reviewed-settings-inventory",
            reviewedAt: "2026-09-16",
            note: "Owner-approved workbook binding, not a similar name.",
          },
        ],
      }),
    ],
  });
  const report = evaluateWorkbookCoverage(bound, [
    { id: "test-grok-web-signed-in-settings", name: "Open settings panel" },
  ]);
  assert.deepEqual(report.coveredOriginalIds, [40]);
  assert.equal(report.boundCount, 1);
  assert.equal(
    report.nameCollisions.some((row) => row.testId === "test-grok-web-signed-in-settings"),
    true,
  );
});

test("a similar-name binding kind is rejected rather than counted as coverage", () => {
  assert.throws(
    () =>
      parseWorkbookCoverageManifest(
        {
          schemaVersion: 1,
          id: "fixture",
          revision: 1,
          reviewedAt: "2026-09-16",
          source: {
            workbook: "grok-qa-graph.xlsx",
            sha256: "43a2ba192fde342e074b8dac805572b23136701d0662d0a9933cb8cacc81de7a",
            originals: "'Merge map'!A4:G61",
            families: "'Suite'!A4:H20",
            exclusions: "'Dead and skip'!A4:D10",
          },
          counts: {
            originals: 1,
            families: 1,
            excludedFamilies: [],
            activeFamilies: 1,
            globallyExcludedOriginals: 0,
            remainingBeforePlatformTierGates: 1,
          },
          conflicts: [],
          notWorkbookPacks: [],
          families: [],
          originals: [
            {
              id: 37,
              gqaId: "GQA-037",
              name: "Imagine from menu",
              family: "S02",
              mergeMapRow: "'Merge map'!A40:G40",
              criteria: "Imagine feed opens.",
              intent: "Tap Imagine.",
              evidencePacket: "transition",
              queue: "fast-ui",
              suggestedExecutionQueue: "fast-ui",
              gates: [],
              status: "bound",
              bindings: [{ kind: "similar-name", testId: "test-grok-ios-imagine" }],
            },
          ],
        },
        { requireCompleteWorkbook: false },
      ),
    /kind must be "reviewed"/,
  );
});

test("advertising 16 active families fails the complete workbook freeze", () => {
  const families = Array.from({ length: 17 }, (_, index) => ({
    id: `S${String(index + 1).padStart(2, "0")}`,
    name: `Family ${index + 1}`,
    active: index !== 14,
    queue: index === 14 || index === 16 ? "excluded" : "fast-ui",
    originalIds: [index + 1],
    suiteRow: `'Suite'!A${index + 4}:H${index + 4}`,
  }));
  families[16] = { ...families[16]!, active: true, queue: "fast-ui" };
  assert.equal(families.filter((family) => family.active).length, 16);
  const originals = Array.from({ length: 58 }, (_, index) => {
    const id = index + 1;
    const excluded = [5, 18, 19, 20, 42].includes(id);
    return original({
      id,
      name: `Original ${id}`,
      family: `S${String(Math.min(17, id)).padStart(2, "0")}`,
      status: excluded ? "excluded" : "unbound",
      ...(excluded
        ? {
            queue: "excluded",
            exclusion: { kind: "dead", authorizedBy: "workbook", reason: "skip" },
          }
        : {}),
    });
  });
  assert.throws(
    () =>
      parseWorkbookCoverageManifest({
        schemaVersion: 1,
        id: "grok-qa-workbook",
        revision: 1,
        reviewedAt: "2026-09-16",
        source: {
          workbook: "grok-qa-graph.xlsx",
          sha256: "43a2ba192fde342e074b8dac805572b23136701d0662d0a9933cb8cacc81de7a",
          originals: "'Merge map'!A4:G61",
          families: "'Suite'!A4:H20",
          exclusions: "'Dead and skip'!A4:D10",
        },
        counts: {
          originals: 58,
          families: 17,
          excludedFamilies: ["S15"],
          activeFamilies: 16,
          globallyExcludedOriginals: 5,
          remainingBeforePlatformTierGates: 53,
        },
        conflicts: [],
        notWorkbookPacks: [],
        families,
        originals,
      }),
    /active families must be 15, not 16|counts.activeFamilies must be 15/,
  );
});

test("original 50 Fast vs Heavy/Expert stays unresolved", () => {
  const report = evaluateWorkbookCoverage(fixture());
  const conflict = report.conflicts.find((item) => item.id === "orig-50-fast-vs-heavy-expert");
  assert.equal(conflict?.status, "unresolved");
  assert.deepEqual(conflict?.originalIds, [50]);
  assert.equal(report.unboundOriginalIds.includes(50), true);
});

test("capture-view leftover skip is only GQA-004 attach and GQA-040 Settings inventory", () => {
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 4, evidencePacket: "view" }), true);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 40, evidencePacket: "view" }), true);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 35, evidencePacket: "transition" }), false);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 43, evidencePacket: "view" }), false);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 4, evidencePacket: "transition" }), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 33,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 4,
      evidencePacket: "view",
      requirementAction: "capture-view",
    }),
    true,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 4,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 7, evidencePacket: "view" }), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 7,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    destEndViewPacketMayLeftoverSkip({ id: 48, evidencePacket: "generated-output" }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 48,
      evidencePacket: "generated-output",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    destEndViewPacketMayLeftoverSkip({ id: 14, evidencePacket: "generated-output" }),
    false,
  );
});

test("S16 cannot be single-view Fast UI", () => {
  const survivalView = original({
    id: 22,
    name: "Force-close while generating",
    family: "S16",
    evidencePacket: "view",
    suggestedExecutionQueue: "fast-ui",
    status: "unbound",
  });
  const error = workbookEvidencePolicyError(survivalView);
  assert.match(error ?? "", /S16 cannot be single view Fast UI|S16 cannot be single-view Fast UI/u);
  const ok = original({
    id: 22,
    name: "Force-close while generating",
    family: "S16",
    evidencePacket: "persistence",
    suggestedExecutionQueue: "stateful-survival",
    status: "unbound",
  });
  assert.equal(workbookEvidencePolicyError(ok), undefined);
});

test("S11 download needs screenshot+receipt; S08 math stays generated-output", () => {
  const downloadWrong = original({
    id: 16,
    name: "Image gen download",
    family: "S11",
    evidencePacket: "view",
    suggestedExecutionQueue: "fast-ui",
    status: "unbound",
  });
  assert.match(workbookEvidencePolicyError(downloadWrong) ?? "", /screenshot\+receipt/u);
  const mathWrong = original({
    id: 48,
    name: "Math 3*5",
    family: "S08",
    evidencePacket: "view",
    suggestedExecutionQueue: "fast-ui",
    status: "unbound",
  });
  assert.match(workbookEvidencePolicyError(mathWrong) ?? "", /generated-output for human review/u);
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 16,
      family: "S11",
      evidencePacket: "screenshot-receipt",
    }),
    "live-output",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 48,
      family: "S08",
      evidencePacket: "generated-output",
    }),
    "live-output",
  );
});

test("RC-23 dest-end table binds only orig 4 attach view and orig 40 settings view", () => {
  assert.deepEqual(rc23WorkbookBoundOriginalIds(), [4, 40]);
  assert.equal(rc23DestEndSatisfiesOriginal("attach", 4, "web"), true);
  assert.equal(rc23DestEndSatisfiesOriginal("settings", 40, "ios"), true);
  assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 1), false);
  assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 2), false);
  assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 6), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 7), false);
  assert.equal(rc23DestEndSatisfiesOriginal("sidebar", 33), false);
  assert.equal(rc23DestEndSatisfiesOriginal("logo", 35), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 37), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 54), false);
  assert.equal(rc23DestEndSatisfiesOriginal("dictation", 42), false);
  assert.equal(coverByRc23DestEnd({ id: 4 }, "attach"), true);
  assert.equal(coverByRc23DestEnd({ id: 6 }, "composer-focus"), false);
  const obligation = workbookOriginalObligationIdentity(
    original({ id: 6, name: "Autocomplete / typeaheads", status: "unbound" }),
  );
  assert.equal(obligation.requirementId, "GQA-006");
  assert.equal(obligation.caption, "Autocomplete / typeaheads");
  assert.equal(obligation.criteria, "Keep the original criterion visible.");
  assert.notEqual(obligation.requirementId, obligation.caption);
  assert.notEqual(obligation.criteria, obligation.caption);
});

test("complete workbook cannot bind orig 6 via composer-focus dest-end", () => {
  const error = workbookRc23BindingError([
    {
      id: 6,
      status: "bound",
      evidencePacket: "persistence",
      bindings: [
        {
          kind: "reviewed",
          appMapId: "grok-ios",
          testId: "test-grok-ios-composer-focus",
          reviewedAt: "2026-09-16",
          note: "similar name must not cover typeahead persistence",
          checkpointId: "composer-focus",
          platform: "ios",
          slotId: "rc23-screenshot-first::composer-focus::ai.x.GrokApp::::::1",
        },
      ],
    },
  ]);
  assert.match(error ?? "", /bound original ids must be 4, 40/u);
});

test("S02 packets stay unbound and need test-action before/after plus receipt", () => {
  assert.deepEqual([...WORKBOOK_SHELL_ORIGINAL_IDS], [3, 33, 35, 36, 37]);
  assert.deepEqual(requiredEvidenceNeededKinds("transition"), ["before", "after", "receipt"]);
  const missing = original({
    id: 33,
    name: "Open/close side menu",
    family: WORKBOOK_SHELL_FAMILY_ID,
    evidencePacket: "transition",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S02 must be test-action|S02 needs explicit evidence-needed/u,
  );
  const packet = original({
    id: 33,
    name: "Open/close side menu",
    family: WORKBOOK_SHELL_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-shell-closed",
        note: "Closed shell. Leftover open sidebar is dest leftover, not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-open-menu",
        note: "TAP open actually executed.",
      },
      {
        kind: "after",
        id: "after-menu-open",
        note: "Open menu destinations.",
      },
      {
        kind: "receipt",
        id: "tap-close-menu",
        note: "TAP close actually executed.",
      },
      {
        kind: "after",
        id: "after-menu-closed",
        note: "Closed menu.",
      },
    ],
    status: "unbound",
  });
  assert.equal(workbookEvidenceNeededError(packet), undefined);
  assert.equal(workbookEvidencePolicyError(packet), undefined);
  assert.equal(originalIsCovered(packet), false);
  const report = evaluateWorkbookCoverage(fixture({ originals: [packet] }), [
    { id: "test-grok-web-signed-in-sidebar", name: "Toggle sidebar" },
  ]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(33), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 33 && row.testId === "test-grok-web-signed-in-sidebar",
    ),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 33 }, "sidebar"), false);
});

test("S05 packets stay unbound and need a causal TAP that changes selection", () => {
  assert.deepEqual([...WORKBOOK_MODELS_ORIGINAL_IDS], [7, 8]);
  const missing = original({
    id: 7,
    name: "Switch model",
    family: WORKBOOK_MODELS_FAMILY_ID,
    evidencePacket: "view",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S05 must be test-action|S05 needs explicit evidence-needed|causal TAP must change selection/u,
  );
  const leftoverFast = original({
    id: 7,
    name: "Switch model",
    family: WORKBOOK_MODELS_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "view",
        id: "leftover-fast-checked",
        note: "Inspect-only Fast-checked sheet.",
      },
    ],
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverFast) ?? "",
    /causal TAP must change selection/u,
  );
  const packet = original({
    id: 7,
    name: "Switch model",
    family: WORKBOOK_MODELS_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-current-model",
        note: "Current model before the switch TAP.",
      },
      {
        kind: "receipt",
        id: "tap-different-model",
        note: "TAP a different model actually executed.",
      },
      {
        kind: "after",
        id: "after-selection-reflected",
        note: "New selection reflected.",
      },
      {
        kind: "view",
        id: "after-selector-chrome",
        note: "Selector after the causal TAP.",
      },
    ],
    status: "unbound",
  });
  assert.equal(workbookEvidenceNeededError(packet), undefined);
  assert.equal(workbookEvidencePolicyError(packet), undefined);
  assert.equal(originalIsCovered(packet), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 7,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  const presets = original({
    id: 8,
    name: "Presets",
    family: WORKBOOK_MODELS_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-open-presets",
        note: "TAP that opens mobile presets actually executed.",
      },
      {
        kind: "view",
        id: "presets-inventory",
        note: "Mobile presets inventory. Customize Grok conflict unresolved.",
      },
    ],
    status: "unbound",
  });
  assert.equal(workbookEvidenceNeededError(presets), undefined);
  assert.equal(originalIsCovered(presets), false);
  const report = evaluateWorkbookCoverage(fixture({ originals: [packet, presets] }), [
    { id: "test-grok-web-signed-in-model-iterate", name: "Inspect model choices" },
    { id: "test-grok-ios-presets", name: "Customize Grok peek" },
  ]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(7), true);
  assert.equal(report.unboundOriginalIds.includes(8), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 7 && row.testId === "test-grok-web-signed-in-model-iterate",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 8 && row.testId === "test-grok-ios-presets",
    ),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 7 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 8 }, "models"), false);
});

test("S08 packets stay unbound and capture without arithmetic or Markdown judge", () => {
  assert.deepEqual([...WORKBOOK_OUTPUT_ORIGINAL_IDS], [14, 15, 32, 48, 51, 52]);
  assert.deepEqual(requiredEvidenceNeededKinds("generated-output"), ["after"]);
  const missing = original({
    id: 48,
    name: "Math 3*5",
    family: WORKBOOK_OUTPUT_FAMILY_ID,
    evidencePacket: "generated-output",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S08 must be test-action|S08 needs explicit evidence-needed|send TAP receipt/u,
  );
  const leftoverExtract = original({
    id: 48,
    name: "Math 3*5",
    family: WORKBOOK_OUTPUT_FAMILY_ID,
    evidencePacket: "generated-output",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "after",
        id: "leftover-extract-15",
        note: "Leftover 3*5 thread with extract contains 15.",
      },
    ],
    status: "unbound",
    criteria:
      "Result should appear instantly. There should be no Quick Answer visible (thunderbolt suggestions).",
  });
  assert.match(workbookEvidenceNeededError(leftoverExtract) ?? "", /send TAP receipt/u);
  assert.equal(workbookOriginalAllowsAutoJudge(leftoverExtract), false);
  assert.equal(coverByArithmeticOrMarkdownJudge(leftoverExtract), false);
  const math = original({
    id: 48,
    name: "Math 3*5",
    family: WORKBOOK_OUTPUT_FAMILY_ID,
    evidencePacket: "generated-output",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-empty-thread",
        note: "Empty composer. Leftover extract-15 is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-send-math-prompt",
        note: "Type and send 3*5 actually executed.",
      },
      {
        kind: "after",
        id: "after-math-result",
        note: "Generated output at a declared phase. Human reviews original criterion.",
      },
    ],
    status: "unbound",
    criteria:
      "Result should appear instantly. There should be no Quick Answer visible (thunderbolt suggestions).",
  });
  assert.equal(workbookEvidenceNeededError(math), undefined);
  assert.equal(workbookEvidencePolicyError(math), undefined);
  assert.equal(originalIsCovered(math), false);
  assert.equal(workbookOriginalAllowsAutoJudge(math), false);
  const obligation = workbookOriginalObligationIdentity(math);
  assert.equal(obligation.requirementId, "GQA-048");
  assert.equal(obligation.caption, "Math 3*5");
  assert.equal(
    obligation.criteria,
    "Result should appear instantly. There should be no Quick Answer visible (thunderbolt suggestions).",
  );
  assert.notEqual(obligation.criteria, "contains 15");
  const markdown = original({
    id: 15,
    name: "Markdown headers",
    family: WORKBOOK_OUTPUT_FAMILY_ID,
    evidencePacket: "generated-output",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-send-markdown-prompt",
        note: "Type and send H1–H6 prompt actually executed.",
      },
      {
        kind: "after",
        id: "after-markdown-headers",
        note: "Generated headers. No mandatory Markdown judge.",
      },
    ],
    status: "unbound",
    criteria: "Response displays formatted headers with size hierarchy (H1 largest – H6 smallest).",
  });
  assert.equal(workbookEvidenceNeededError(markdown), undefined);
  assert.equal(workbookOriginalAllowsAutoJudge(markdown), false);
  assert.equal(coverByArithmeticOrMarkdownJudge(markdown), false);
  const capital = original({
    id: 51,
    name: "Capital of France",
    family: WORKBOOK_OUTPUT_FAMILY_ID,
    evidencePacket: "generated-output",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-send-capital-prompt",
        note: "Type and send Capital of France actually executed.",
      },
      {
        kind: "after",
        id: "after-short-answer",
        note: "Short answer. No mandatory answer judge.",
      },
    ],
    status: "unbound",
  });
  const report = evaluateWorkbookCoverage(fixture({ originals: [math, markdown, capital] }), [
    { id: "test-grok-web-signed-in-3x5", name: "Ask 3*5" },
    { id: "test-grok-web-signed-in-capital", name: "Ask Capital of France" },
    { id: "test-grok-web-send-hello", name: "Send hello while logged out" },
  ]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(48), true);
  assert.equal(report.unboundOriginalIds.includes(15), true);
  assert.equal(report.unboundOriginalIds.includes(51), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 48 && row.testId === "test-grok-web-signed-in-3x5",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 51 && row.testId === "test-grok-web-signed-in-capital",
    ),
    true,
  );
  assert.equal(coverByFindingSimilarlyNamedTest(math, []), false);
  assert.equal(coverByRc23DestEnd({ id: 48 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 48 }, "models"), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 48,
      evidencePacket: "generated-output",
      requirementAction: "test-action",
    }),
    false,
  );
});
