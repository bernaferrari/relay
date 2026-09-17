import assert from "node:assert/strict";
import test from "node:test";
import {
  coverByArithmeticOrMarkdownJudge,
  coverByCloudflareOrWeeklyAuthPause,
  coverByComposerFocusOrSendHello,
  coverByFindingSimilarlyNamedTest,
  coverByModelIterateOrPricingTap,
  coverByToolbarExpectSetOrShareToast,
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
  WORKBOOK_AUTH_FAMILY_ID,
  WORKBOOK_AUTH_ORIGINAL_IDS,
  WORKBOOK_COMPOSER_FAMILY_ID,
  WORKBOOK_COMPOSER_ORIGINAL_IDS,
  WORKBOOK_AUTO_FAMILY_ID,
  WORKBOOK_AUTO_ORIGINAL_IDS,
  WORKBOOK_CHROME_FAMILY_ID,
  WORKBOOK_CHROME_ORIGINAL_IDS,
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
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 44, evidencePacket: "transition" }), false);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 47, evidencePacket: "view" }), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 44,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 47,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    destEndViewPacketMayLeftoverSkip({ id: 1, evidencePacket: "generated-output" }),
    false,
  );
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 2, evidencePacket: "view" }), false);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 6, evidencePacket: "persistence" }), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 1,
      evidencePacket: "generated-output",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 2,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 6,
      evidencePacket: "persistence",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 28, evidencePacket: "transition" }), false);
  assert.equal(destEndViewPacketMayLeftoverSkip({ id: 29, evidencePacket: "transition" }), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 28,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 29,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
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
  assert.equal(rc23DestEndSatisfiesOriginal("models", 28), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 29), false);
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

test("S01 packets stay unbound and need isolated auth TAP evidence", () => {
  assert.deepEqual([...WORKBOOK_AUTH_ORIGINAL_IDS], [44, 45, 46, 47]);
  assert.deepEqual(requiredEvidenceNeededKinds("transition"), ["before", "after", "receipt"]);
  assert.deepEqual(requiredEvidenceNeededKinds("sequence"), ["sequence"]);
  assert.deepEqual(requiredEvidenceNeededKinds("view"), ["view"]);
  const missing = original({
    id: 44,
    name: "Sign Out",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "transition",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S01 must be test-action|S01 needs explicit evidence-needed|Sign Out TAP must execute/u,
  );
  const leftoverLoggedOut = original({
    id: 44,
    name: "Sign Out",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "after",
        id: "leftover-logged-out-home",
        note: "Leftover logged-out home. No Sign Out TAP.",
      },
    ],
    status: "unbound",
    criteria: "User is signed out successfully and redirected to the login or onboarding screen.",
  });
  assert.match(workbookEvidenceNeededError(leftoverLoggedOut) ?? "", /Sign Out TAP must execute/u);
  const signOut = original({
    id: 44,
    name: "Sign Out",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-signed-in-with-sign-out",
        note: "Signed-in Settings with Sign Out. Isolated fixture, not grok-lab SuperGrok.",
      },
      {
        kind: "receipt",
        id: "tap-sign-out-confirm",
        note: "TAP Sign Out and confirm actually executed.",
      },
      {
        kind: "after",
        id: "after-login-or-onboarding",
        note: "Login or onboarding after successful sign-out. Cloudflare x.ai is not this frame.",
      },
    ],
    status: "unbound",
    criteria: "User is signed out successfully and redirected to the login or onboarding screen.",
  });
  assert.equal(workbookEvidenceNeededError(signOut), undefined);
  assert.equal(workbookEvidencePolicyError(signOut), undefined);
  assert.equal(originalIsCovered(signOut), false);
  assert.equal(coverByCloudflareOrWeeklyAuthPause(signOut), false);
  const obligation = workbookOriginalObligationIdentity(signOut);
  assert.equal(obligation.requirementId, "GQA-044");
  assert.equal(obligation.caption, "Sign Out");
  assert.equal(
    obligation.criteria,
    "User is signed out successfully and redirected to the login or onboarding screen.",
  );
  const weeklyPause = original({
    id: 45,
    name: "Continue with X (sheet / X absent)",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "sequence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "sequence",
        id: "weekly-pause",
        note: "Weekly Continue-with-X pause. No TAP.",
      },
    ],
    status: "unbound",
  });
  assert.match(workbookEvidenceNeededError(weeklyPause) ?? "", /Continue with X TAP receipt/u);
  const xAbsent = original({
    id: 45,
    name: "Continue with X (sheet / X absent)",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "sequence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-continue-with-x-sheet",
        note: "TAP Continue with X actually executed.",
      },
      {
        kind: "sequence",
        id: "x-absent-sheet-authorize",
        note: "Welcome → x.com sheet → authorize. X-app-present is GQA-046.",
      },
    ],
    status: "unbound",
    criteria: "Grok will log in with X account. Session exists after authorize.",
  });
  assert.equal(workbookEvidenceNeededError(xAbsent), undefined);
  assert.equal(originalIsCovered(xAbsent), false);
  const xPresent = original({
    id: 46,
    name: "Continue with X (X app present)",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "sequence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-continue-with-x-app",
        note: "TAP Continue with X actually executed.",
      },
      {
        kind: "sequence",
        id: "x-app-authorize",
        note: "Welcome → X app → authorize. One leftover sheet is not this original.",
      },
    ],
    status: "unbound",
  });
  assert.equal(workbookEvidenceNeededError(xPresent), undefined);
  const cloudflareSignup = original({
    id: 47,
    name: "Sign Up",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "leftover-cloudflare",
        note: "Cloudflare x.ai. No Create your account view.",
      },
    ],
    status: "unbound",
    criteria:
      "The Create your account page opens with sign-up options, switch to sign-in, and terms/policy at the bottom.",
  });
  assert.match(workbookEvidenceNeededError(cloudflareSignup) ?? "", /view packet needs view/u);
  const signUp = original({
    id: 47,
    name: "Sign Up",
    family: WORKBOOK_AUTH_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-sign-up",
        note: "TAP Sign Up actually executed.",
      },
      {
        kind: "view",
        id: "create-account-page",
        note: "Create your account. Cloudflare x.ai is not this view.",
      },
    ],
    status: "unbound",
    criteria:
      "The Create your account page opens with sign-up options, switch to sign-in, and terms/policy at the bottom.",
  });
  assert.equal(workbookEvidenceNeededError(signUp), undefined);
  assert.equal(workbookEvidencePolicyError(signUp), undefined);
  assert.equal(originalIsCovered(signUp), false);
  assert.equal(coverByCloudflareOrWeeklyAuthPause(signUp), false);
  const report = evaluateWorkbookCoverage(
    fixture({ originals: [signOut, xAbsent, xPresent, signUp] }),
    [
      { id: "test-grok-web-signed-in-sign-out", name: "Sign Out" },
      { id: "test-grok-web-signup", name: "Sign Up" },
      { id: "test-grok-web-weekly", name: "Continue with X weekly pause" },
    ],
  );
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(44), true);
  assert.equal(report.unboundOriginalIds.includes(45), true);
  assert.equal(report.unboundOriginalIds.includes(46), true);
  assert.equal(report.unboundOriginalIds.includes(47), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 44 && row.testId === "test-grok-web-signed-in-sign-out",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 47 && row.testId === "test-grok-web-signup",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 45 && row.testId === "test-grok-web-weekly",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 46 && row.testId === "test-grok-web-weekly",
    ),
    true,
  );
  assert.equal(coverByFindingSimilarlyNamedTest(signOut, []), false);
  assert.equal(coverByRc23DestEnd({ id: 44 }, "settings"), false);
  assert.equal(coverByRc23DestEnd({ id: 47 }, "home-chrome"), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 44,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 47,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 44,
      family: WORKBOOK_AUTH_FAMILY_ID,
      evidencePacket: "transition",
    }),
    "stateful-survival",
  );
});

test("S03 packets stay unbound and need type+send TAP evidence", () => {
  assert.deepEqual([...WORKBOOK_COMPOSER_ORIGINAL_IDS], [1, 2, 6]);
  assert.deepEqual(requiredEvidenceNeededKinds("generated-output"), ["after"]);
  assert.deepEqual(requiredEvidenceNeededKinds("view"), ["view"]);
  assert.deepEqual(requiredEvidenceNeededKinds("persistence"), ["before", "restart", "after"]);
  const missing = original({
    id: 1,
    name: "Type and send a message",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "generated-output",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S03 must be test-action|S03 needs explicit evidence-needed|send TAP must execute/u,
  );
  const leftoverFocus = original({
    id: 1,
    name: "Type and send a message",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "generated-output",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "after",
        id: "leftover-composer-focus",
        note: "Leftover composer-focus inspect. No type or send TAP.",
      },
    ],
    status: "unbound",
    criteria: "Message is entered and sent successfully.",
  });
  assert.match(workbookEvidenceNeededError(leftoverFocus) ?? "", /send TAP must execute/u);
  assert.equal(coverByComposerFocusOrSendHello(leftoverFocus), false);
  const send = original({
    id: 1,
    name: "Type and send a message",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "generated-output",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-empty-composer",
        note: "Empty composer. Leftover composer-focus inspect is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-type-and-send",
        note: "Type and send actually executed.",
      },
      {
        kind: "after",
        id: "after-message-sent",
        note: "Message sent successfully. Send-hello paywall is not this frame.",
      },
    ],
    status: "unbound",
    criteria: "Message is entered and sent successfully.",
  });
  assert.equal(workbookEvidenceNeededError(send), undefined);
  assert.equal(workbookEvidencePolicyError(send), undefined);
  assert.equal(originalIsCovered(send), false);
  assert.equal(coverByComposerFocusOrSendHello(send), false);
  const obligation = workbookOriginalObligationIdentity(send);
  assert.equal(obligation.requirementId, "GQA-001");
  assert.equal(obligation.caption, "Type and send a message");
  assert.equal(obligation.criteria, "Message is entered and sent successfully.");
  const leftoverMultiline = original({
    id: 2,
    name: "Multiline composer",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "view",
        id: "leftover-extract-15",
        note: "3*5 multiline extract-15. No type TAP.",
      },
    ],
    status: "unbound",
    criteria:
      "Message is entered and sent successfully. Input box expands to show multiple lines of text.",
  });
  assert.match(workbookEvidenceNeededError(leftoverMultiline) ?? "", /multiline type TAP receipt/u);
  const multiline = original({
    id: 2,
    name: "Multiline composer",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "view",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-type-multiline",
        note: "Type a long message with line breaks actually executed.",
      },
      {
        kind: "view",
        id: "multiline-composer-expanded",
        note: "Input box expanded. 3*5 extract-15 is leftover math, not this view.",
      },
    ],
    status: "unbound",
    criteria:
      "Message is entered and sent successfully. Input box expands to show multiple lines of text.",
  });
  assert.equal(workbookEvidenceNeededError(multiline), undefined);
  assert.equal(workbookEvidencePolicyError(multiline), undefined);
  assert.equal(originalIsCovered(multiline), false);
  const leftoverTypeahead = original({
    id: 6,
    name: "Autocomplete / typeaheads",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "persistence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-composer-focus",
        note: "Composer-focus inspect. No typeahead TAP.",
      },
      {
        kind: "restart",
        id: "unused-restart",
        note: "No force-close.",
      },
      {
        kind: "after",
        id: "after-composer-focus",
        note: "Still inspect-only.",
      },
    ],
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverTypeahead) ?? "",
    /typeahead select TAP receipt/u,
  );
  const typeahead = original({
    id: 6,
    name: "Autocomplete / typeaheads",
    family: WORKBOOK_COMPOSER_FAMILY_ID,
    evidencePacket: "persistence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-typeaheads-on",
        note: "Typeaheads on. Composer-focus inspect is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-select-typeahead",
        note: "Select a typeahead suggestion actually executed.",
      },
      {
        kind: "restart",
        id: "force-close-reopen",
        note: "Force-close and reopen.",
      },
      {
        kind: "after",
        id: "after-typeaheads-stick",
        note: "Typeaheads still on; selected query sent.",
      },
    ],
    status: "unbound",
    criteria:
      "The selected query is sent and the assistant responds. Typeaheads toggled on in Settings must stick after force-close and reopen.",
  });
  assert.equal(workbookEvidenceNeededError(typeahead), undefined);
  assert.equal(workbookEvidencePolicyError(typeahead), undefined);
  assert.equal(originalIsCovered(typeahead), false);
  assert.equal(coverByComposerFocusOrSendHello(typeahead), false);
  const report = evaluateWorkbookCoverage(fixture({ originals: [send, multiline, typeahead] }), [
    { id: "test-grok-web-send-hello", name: "Send hello while logged out" },
    { id: "test-grok-web-signed-in-multiline", name: "Ask 3*5 multiline" },
    { id: "test-grok-ios-composer-focus", name: "Composer focus" },
    { id: "test-grok-web-signed-in-composer-focus", name: "Composer focus" },
  ]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(1), true);
  assert.equal(report.unboundOriginalIds.includes(2), true);
  assert.equal(report.unboundOriginalIds.includes(6), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 1 && row.testId === "test-grok-web-send-hello",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 2 && row.testId === "test-grok-web-signed-in-multiline",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 1 && row.testId === "test-grok-ios-composer-focus",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 6 && row.testId === "test-grok-ios-composer-focus",
    ),
    true,
  );
  assert.equal(coverByFindingSimilarlyNamedTest(send, []), false);
  assert.equal(coverByRc23DestEnd({ id: 1 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 2 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 6 }, "composer-focus"), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 1,
      evidencePacket: "generated-output",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 2,
      evidencePacket: "view",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 1,
      family: WORKBOOK_COMPOSER_FAMILY_ID,
      evidencePacket: "generated-output",
    }),
    "live-output",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 2,
      family: WORKBOOK_COMPOSER_FAMILY_ID,
      evidencePacket: "view",
    }),
    "fast-ui",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 6,
      family: WORKBOOK_COMPOSER_FAMILY_ID,
      evidencePacket: "persistence",
    }),
    "stateful-survival",
  );
});

test("S06 packets stay unbound and need Auto routing TAP evidence", () => {
  assert.deepEqual([...WORKBOOK_AUTO_ORIGINAL_IDS], [28, 29]);
  assert.deepEqual(requiredEvidenceNeededKinds("transition"), ["before", "after", "receipt"]);
  const missing = original({
    id: 28,
    name: "Auto routes Fast",
    family: WORKBOOK_AUTO_FAMILY_ID,
    evidencePacket: "transition",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S06 must be test-action|S06 needs explicit evidence-needed|Auto Fast routing TAP must execute/u,
  );
  const leftoverFastChecked = original({
    id: 28,
    name: "Auto routes Fast",
    family: WORKBOOK_AUTO_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "after",
        id: "leftover-fast-checked",
        note: "Leftover Fast-checked inspect-only model sheet. No Auto prompt TAP.",
      },
    ],
    status: "unbound",
    criteria:
      "The request is routed to the Fast model. A Think harder button is shown and routes to the Expert model when clicked.",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverFastChecked) ?? "",
    /Auto Fast routing TAP must execute/u,
  );
  assert.equal(coverByModelIterateOrPricingTap(leftoverFastChecked), false);
  const leftoverSendOnly = original({
    id: 28,
    name: "Auto routes Fast",
    family: WORKBOOK_AUTO_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-auto-selected",
        note: "Auto selected. Leftover Fast-checked is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-send-simple-auto-prompt",
        note: "Send simple Auto query. No Think harder TAP.",
      },
      {
        kind: "after",
        id: "after-routed-fast-think-harder",
        note: "Routed to Fast. Think harder not tapped.",
      },
    ],
    status: "unbound",
    criteria:
      "The request is routed to the Fast model. A Think harder button is shown and routes to the Expert model when clicked.",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverSendOnly) ?? "",
    /send TAP and Think harder TAP receipts/u,
  );
  const autoFast = original({
    id: 28,
    name: "Auto routes Fast",
    family: WORKBOOK_AUTO_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-auto-selected",
        note: "Auto selected. Leftover Fast-checked / model-iterate is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-send-simple-auto-prompt",
        note: "Type and send a simple Auto query actually executed.",
      },
      {
        kind: "after",
        id: "after-routed-fast-think-harder",
        note: "Routed to Fast. Think harder shown. SuperGrok pricing TAP is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-think-harder",
        note: "TAP Think harder actually executed.",
      },
      {
        kind: "after",
        id: "after-think-harder-expert",
        note: "Think harder routes to Expert.",
      },
    ],
    status: "unbound",
    criteria:
      "The request is routed to the Fast model. A Think harder button is shown and routes to the Expert model when clicked.",
  });
  assert.equal(workbookEvidenceNeededError(autoFast), undefined);
  assert.equal(workbookEvidencePolicyError(autoFast), undefined);
  assert.equal(originalIsCovered(autoFast), false);
  assert.equal(coverByModelIterateOrPricingTap(autoFast), false);
  const obligation = workbookOriginalObligationIdentity(autoFast);
  assert.equal(obligation.requirementId, "GQA-028");
  assert.equal(obligation.caption, "Auto routes Fast");
  assert.equal(
    obligation.criteria,
    "The request is routed to the Fast model. A Think harder button is shown and routes to the Expert model when clicked.",
  );
  const leftoverExpertSendOnly = original({
    id: 29,
    name: "Auto routes Expert",
    family: WORKBOOK_AUTO_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-auto-selected",
        note: "Auto selected. No Quick answer TAP.",
      },
      {
        kind: "receipt",
        id: "tap-send-complex-auto-prompt",
        note: "Send complex Auto query. No Quick answer TAP.",
      },
      {
        kind: "after",
        id: "after-routed-expert-quick-answer",
        note: "Routed to Expert. Quick answer not tapped.",
      },
    ],
    status: "unbound",
    criteria:
      "The request is routed to the Expert model. A Quick answer button is shown and routes to the Fast model when clicked.",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverExpertSendOnly) ?? "",
    /send TAP and Quick answer TAP receipts/u,
  );
  const autoExpert = original({
    id: 29,
    name: "Auto routes Expert",
    family: WORKBOOK_AUTO_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-auto-selected",
        note: "Auto selected. Leftover Fast-checked / model-iterate is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-send-complex-auto-prompt",
        note: "Type and send a complex Auto query actually executed.",
      },
      {
        kind: "after",
        id: "after-routed-expert-quick-answer",
        note: "Routed to Expert. Quick answer shown. GQA-048 math thunderbolt is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-quick-answer",
        note: "TAP Quick answer actually executed.",
      },
      {
        kind: "after",
        id: "after-quick-answer-fast",
        note: "Quick answer routes to Fast.",
      },
    ],
    status: "unbound",
    criteria:
      "The request is routed to the Expert model. A Quick answer button is shown and routes to the Fast model when clicked.",
  });
  assert.equal(workbookEvidenceNeededError(autoExpert), undefined);
  assert.equal(workbookEvidencePolicyError(autoExpert), undefined);
  assert.equal(originalIsCovered(autoExpert), false);
  assert.equal(coverByModelIterateOrPricingTap(autoExpert), false);
  const report = evaluateWorkbookCoverage(fixture({ originals: [autoFast, autoExpert] }), [
    { id: "test-grok-web-signed-in-model-iterate", name: "Inspect model choices" },
    { id: "test-grok-web-wait-think-harder", name: "Think harder response" },
    { id: "test-grok-web-signed-in-3x5", name: "Ask 3*5" },
  ]);
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(28), true);
  assert.equal(report.unboundOriginalIds.includes(29), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 28 && row.testId === "test-grok-web-signed-in-model-iterate",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 29 && row.testId === "test-grok-web-signed-in-model-iterate",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 28 && row.testId === "test-grok-web-wait-think-harder",
    ),
    true,
  );
  assert.equal(coverByFindingSimilarlyNamedTest(autoFast, []), false);
  assert.equal(coverByRc23DestEnd({ id: 28 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 29 }, "models"), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 28,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 29,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 28,
      family: WORKBOOK_AUTO_FAMILY_ID,
      evidencePacket: "transition",
    }),
    "live-output",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 29,
      family: WORKBOOK_AUTO_FAMILY_ID,
      evidencePacket: "transition",
    }),
    "live-output",
  );
});

test("S07 packets stay unbound and need toolbar, chip, autoscroll, and share TAP evidence", () => {
  assert.deepEqual([...WORKBOOK_CHROME_ORIGINAL_IDS], [9, 10, 12, 13]);
  assert.deepEqual(requiredEvidenceNeededKinds("screenshot-receipt"), ["view", "receipt"]);
  assert.deepEqual(requiredEvidenceNeededKinds("transition"), ["before", "after", "receipt"]);
  assert.deepEqual(requiredEvidenceNeededKinds("sequence"), ["sequence"]);
  const missing = original({
    id: 9,
    name: "Response toolbar",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "screenshot-receipt",
    status: "unbound",
  });
  assert.match(
    workbookEvidenceNeededError(missing) ?? "",
    /S07 must be test-action|S07 needs explicit evidence-needed|TAP More must execute/u,
  );
  const leftoverToolbarExpectSet = original({
    id: 9,
    name: "Response toolbar",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "screenshot-receipt",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "view",
        id: "leftover-3x5-toolbar-expect-set",
        note: "Leftover 3*5 extract-15 toolbar expect-set. No TAP More.",
      },
    ],
    status: "unbound",
    criteria:
      "Web quick actions: Regen, Read Aloud, Copy, Create Share Link, Rating, More {Report Issue, Export PDF, Start Thread}. Android = no More.",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverToolbarExpectSet) ?? "",
    /TAP More must execute/u,
  );
  assert.equal(coverByToolbarExpectSetOrShareToast(leftoverToolbarExpectSet), false);
  const toolbar = original({
    id: 9,
    name: "Response toolbar",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "screenshot-receipt",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-response-toolbar-more",
        note: "TAP More actually executed. Leftover extras-forbid is not this original.",
      },
      {
        kind: "view",
        id: "response-toolbar-quick-actions",
        note: "Toolbar quick actions visible. leftover 3*5 expect-set is not this view.",
      },
    ],
    status: "unbound",
    criteria:
      "Web quick actions: Regen, Read Aloud, Copy, Create Share Link, Rating, More {Report Issue, Export PDF, Start Thread}. Android = no More.",
  });
  assert.equal(workbookEvidenceNeededError(toolbar), undefined);
  assert.equal(workbookEvidencePolicyError(toolbar), undefined);
  assert.equal(originalIsCovered(toolbar), false);
  assert.equal(coverByToolbarExpectSetOrShareToast(toolbar), false);
  const toolbarObligation = workbookOriginalObligationIdentity(toolbar);
  assert.equal(toolbarObligation.requirementId, "GQA-009");
  assert.equal(toolbarObligation.caption, "Response toolbar");
  assert.match(toolbarObligation.criteria, /Regen, Read Aloud, Copy/u);
  const leftoverChipSkip = original({
    id: 10,
    name: "Follow-up chips",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-follow-up-chips",
        note: "Chips visible. No chip TAP.",
      },
      {
        kind: "after",
        id: "after-leftover-toolbar",
        note: "Leftover 3*5 toolbar dest-end. No chip TAP.",
      },
    ],
    status: "unbound",
    criteria: "The query text is sent in the chat and the assistant responds to that query.",
  });
  assert.match(
    workbookEvidenceNeededError(leftoverChipSkip) ?? "",
    /follow-up chip TAP must execute/u,
  );
  const chips = original({
    id: 10,
    name: "Follow-up chips",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "transition",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "before",
        id: "before-follow-up-chips",
        note: "Follow-up chips visible. leftover 3*5 toolbar dest-end is not this frame.",
      },
      {
        kind: "receipt",
        id: "tap-follow-up-chip",
        note: "TAP one follow-up chip actually executed.",
      },
      {
        kind: "after",
        id: "after-chip-query-answered",
        note: "Query sent and assistant responds. leftover 3*5 extract-15 is not this frame.",
      },
    ],
    status: "unbound",
    criteria: "The query text is sent in the chat and the assistant responds to that query.",
  });
  assert.equal(workbookEvidenceNeededError(chips), undefined);
  assert.equal(workbookEvidencePolicyError(chips), undefined);
  assert.equal(originalIsCovered(chips), false);
  const leftoverAutoscroll = original({
    id: 12,
    name: "No autoscroll",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "sequence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "leftover-3x5-send",
        note: "Leftover 3*5 extract-15. Autoscroll unmeasured.",
      },
    ],
    status: "unbound",
    criteria: "The response should not autoscroll to the bottom.",
  });
  assert.match(workbookEvidenceNeededError(leftoverAutoscroll) ?? "", /sequence evidence/u);
  const autoscroll = original({
    id: 12,
    name: "No autoscroll",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "sequence",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "sequence",
        id: "no-autoscroll-beginning-visible",
        note: "Beginning of the response visible after generation. leftover 3*5 is not this sequence.",
      },
    ],
    status: "unbound",
    criteria: "The response should not autoscroll to the bottom.",
  });
  assert.equal(workbookEvidenceNeededError(autoscroll), undefined);
  assert.equal(workbookEvidencePolicyError(autoscroll), undefined);
  assert.equal(originalIsCovered(autoscroll), false);
  const leftoverShareToast = original({
    id: 13,
    name: "Share conversation",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "screenshot-receipt",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "view",
        id: "clipboard-denied-toast",
        note: "Leftover 3*5 share clipboard-denied toast. No copied-link confirmation.",
      },
    ],
    status: "unbound",
    criteria:
      "A copied-link confirmation appears and the correct share link is copied. On iOS, ... next to New Chat opens Share Conversation & Delete Conversation.",
  });
  assert.match(workbookEvidenceNeededError(leftoverShareToast) ?? "", /share TAP must execute/u);
  assert.equal(coverByToolbarExpectSetOrShareToast(leftoverShareToast), false);
  const share = original({
    id: 13,
    name: "Share conversation",
    family: WORKBOOK_CHROME_FAMILY_ID,
    evidencePacket: "screenshot-receipt",
    requirementAction: "test-action",
    evidenceNeeded: [
      {
        kind: "receipt",
        id: "tap-share-top-right",
        note: "TAP share top-right actually executed. clipboard-denied toast is not this original.",
      },
      {
        kind: "view",
        id: "copied-link-confirmation",
        note: "Copied-link confirmation visible. more-header chrome-only is not this view.",
      },
    ],
    status: "unbound",
    criteria:
      "A copied-link confirmation appears and the correct share link is copied. On iOS, ... next to New Chat opens Share Conversation & Delete Conversation.",
  });
  assert.equal(workbookEvidenceNeededError(share), undefined);
  assert.equal(workbookEvidencePolicyError(share), undefined);
  assert.equal(originalIsCovered(share), false);
  const shareObligation = workbookOriginalObligationIdentity(share);
  assert.equal(shareObligation.requirementId, "GQA-013");
  assert.match(shareObligation.criteria, /copied-link confirmation/u);
  const report = evaluateWorkbookCoverage(
    fixture({ originals: [toolbar, chips, autoscroll, share] }),
    [
      { id: "test-grok-web-signed-in-toolbar", name: "Ask 3*5 then toolbar" },
      { id: "test-grok-web-signed-in-toolbar-existing", name: "Toolbar on an existing chat" },
      { id: "test-grok-web-signed-in-share", name: "Ask 3*5 then share" },
      { id: "test-grok-web-signed-in-more-header", name: "Header More on an existing chat" },
      { id: "test-grok-web-signed-in-3x5", name: "Ask 3*5" },
    ],
  );
  assert.deepEqual(report.coveredOriginalIds, []);
  assert.equal(report.unboundOriginalIds.includes(9), true);
  assert.equal(report.unboundOriginalIds.includes(10), true);
  assert.equal(report.unboundOriginalIds.includes(12), true);
  assert.equal(report.unboundOriginalIds.includes(13), true);
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 9 && row.testId === "test-grok-web-signed-in-toolbar",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 9 && row.testId === "test-grok-web-signed-in-toolbar-existing",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 9 && row.testId === "test-grok-web-signed-in-more-header",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 13 && row.testId === "test-grok-web-signed-in-share",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 13 && row.testId === "test-grok-web-signed-in-more-header",
    ),
    true,
  );
  assert.equal(coverByFindingSimilarlyNamedTest(toolbar, []), false);
  assert.equal(coverByRc23DestEnd({ id: 9 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 10 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 12 }, "home-chrome"), false);
  assert.equal(coverByRc23DestEnd({ id: 13 }, "settings"), false);
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 9,
      evidencePacket: "screenshot-receipt",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 10,
      evidencePacket: "transition",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 12,
      evidencePacket: "sequence",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    workbookOriginalMayLeftoverSkip({
      id: 13,
      evidencePacket: "screenshot-receipt",
      requirementAction: "test-action",
    }),
    false,
  );
  assert.equal(
    destEndViewPacketMayLeftoverSkip({ id: 9, evidencePacket: "screenshot-receipt" }),
    false,
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 9,
      family: WORKBOOK_CHROME_FAMILY_ID,
      evidencePacket: "screenshot-receipt",
    }),
    "live-output",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 10,
      family: WORKBOOK_CHROME_FAMILY_ID,
      evidencePacket: "transition",
    }),
    "live-output",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 12,
      family: WORKBOOK_CHROME_FAMILY_ID,
      evidencePacket: "sequence",
    }),
    "live-output",
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 13,
      family: WORKBOOK_CHROME_FAMILY_ID,
      evidencePacket: "screenshot-receipt",
    }),
    "live-output",
  );
});
