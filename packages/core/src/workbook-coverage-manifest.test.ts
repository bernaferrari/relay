import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  coverByCloudflareOrWeeklyAuthPause,
  coverByComposerFocusOrSendHello,
  coverByFindingSimilarlyNamedTest,
  coverByModelIterateOrPricingTap,
  coverByToolbarExpectSetOrShareToast,
  coverByUnrecordedSourcesNewsOrPlugins,
  coverByUnrecordedHeavyOrFinanceDestEnd,
  coverByImagineDestEndOrUnrecordedHeavyImage,
  coverByImagineDestEndOrHistorySearch,
  coverByHistoryDestEndOrCommandMenuSearch,
  coverBySettingsDestEndOrLanguageInspect,
  coverByRc23DestEnd,
  countWorkbookEvidencePackets,
  countWorkbookSuggestedQueues,
  evaluateWorkbookCoverage,
  isRc23DestEndBinding,
  originalIsCovered,
  parseWorkbookCoverageManifest,
  rc23DestEndSatisfiesOriginal,
  rc23WorkbookBindingSlotId,
  rc23WorkbookBoundOriginalIds,
  similarNamedTests,
  suggestedExecutionQueueForOriginal,
  workbookCoverageAfterCompileAttempts,
  workbookOriginalAllowsAutoJudge,
  workbookOriginalObligationIdentity,
  WORKBOOK_AUTH_FAMILY_ID,
  WORKBOOK_AUTH_ORIGINAL_IDS,
  WORKBOOK_COMPOSER_FAMILY_ID,
  WORKBOOK_COMPOSER_ORIGINAL_IDS,
  WORKBOOK_AUTO_FAMILY_ID,
  WORKBOOK_AUTO_ORIGINAL_IDS,
  WORKBOOK_CHROME_FAMILY_ID,
  WORKBOOK_CHROME_ORIGINAL_IDS,
  WORKBOOK_TOOLS_FAMILY_ID,
  WORKBOOK_TOOLS_ORIGINAL_IDS,
  WORKBOOK_HEAVY_FAMILY_ID,
  WORKBOOK_HEAVY_ORIGINAL_IDS,
  WORKBOOK_IMAGE_FAMILY_ID,
  WORKBOOK_IMAGE_ORIGINAL_IDS,
  WORKBOOK_IMAGE_SEARCH_FAMILY_ID,
  WORKBOOK_IMAGE_SEARCH_ORIGINAL_IDS,
  WORKBOOK_HISTORY_FAMILY_ID,
  WORKBOOK_HISTORY_ORIGINAL_IDS,
  WORKBOOK_SETTINGS_FAMILY_ID,
  WORKBOOK_SETTINGS_UNBOUND_ORIGINAL_IDS,
  WORKBOOK_EVIDENCE_PACKET_LABELS,
  WORKBOOK_RC23_REQUIREMENT_ID,
  WORKBOOK_MODELS_FAMILY_ID,
  WORKBOOK_MODELS_ORIGINAL_IDS,
  WORKBOOK_OUTPUT_FAMILY_ID,
  WORKBOOK_OUTPUT_ORIGINAL_IDS,
  WORKBOOK_SHELL_FAMILY_ID,
  WORKBOOK_SHELL_ORIGINAL_IDS,
  WORKBOOK_SURVIVAL_FAMILY_ID,
  RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION,
  RC23_SCREENSHOT_FIRST_REQUIREMENT_ID,
  RC23_SCREENSHOT_FIRST_TESTS,
  WORKBOOK_RC23_PLATFORM_CONFIGURATION,
} from "@relay/protocol";
import { parse } from "yaml";

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/coverage/grok-qa-workbook.v1.yaml",
);

function loadReviewedWorkbook() {
  return parseWorkbookCoverageManifest(parse(readFileSync(manifestPath, "utf8")));
}

const similarCatalog = [
  { id: "test-grok-ios-presets", name: "Customize Grok peek", appMapId: "grok-ios" },
  { id: "test-grok-ios-dictation", name: "Dictation inspect", appMapId: "grok-ios" },
  { id: "test-grok-ios-imagine", name: "Imagine", appMapId: "grok-ios" },
  { id: "test-grok-ios-settings", name: "Open Settings", appMapId: "grok-ios" },
  { id: "test-grok-web-signed-in-settings", name: "Open settings panel", appMapId: "grok-web" },
  {
    id: "test-grok-android-unrecorded-heavy-image-5",
    name: "UNRECORDED 5-image Heavy",
    appMapId: "grok-android",
  },
  {
    id: "test-grok-web-signed-in-model-iterate",
    name: "Inspect model choices",
    appMapId: "grok-web",
  },
  { id: "test-grok-web-signed-in-3x5", name: "Ask 3*5", appMapId: "grok-web" },
  { id: "test-grok-web-signed-in-capital", name: "Ask Capital of France", appMapId: "grok-web" },
  { id: "test-grok-web-send-hello", name: "Send hello while logged out", appMapId: "grok-web" },
  { id: "test-grok-web-signed-in-multiline", name: "Ask 3*5 multiline", appMapId: "grok-web" },
  {
    id: "test-grok-web-signed-in-composer-focus",
    name: "Composer focus",
    appMapId: "grok-web",
  },
  { id: "test-grok-ios-composer-focus", name: "Composer focus", appMapId: "grok-ios" },
  { id: "test-grok-web-signed-in-sign-out", name: "Sign Out", appMapId: "grok-web" },
  { id: "test-grok-web-signup", name: "Sign Up", appMapId: "grok-web" },
  { id: "test-grok-web-weekly", name: "Continue with X weekly pause", appMapId: "grok-web" },
  {
    id: "test-grok-web-wait-think-harder",
    name: "Think harder response",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-toolbar",
    name: "Ask 3*5 then toolbar",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-toolbar-existing",
    name: "Toolbar on an existing chat",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-share",
    name: "Ask 3*5 then share",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-more-header",
    name: "Header More on an existing chat",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-sources",
    name: "YAML sources unrecorded",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-news",
    name: "YAML news unrecorded",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-plugins",
    name: "Open Plugins",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-finance",
    name: "Finance card",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-imagine",
    name: "Open Imagine",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-android-imagine",
    name: "Open Imagine",
    appMapId: "grok-android",
  },
  {
    id: "test-grok-web-logged-out-imagine-judged",
    name: "Judge logged-out Imagine chrome",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-search",
    name: "Search history",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-android-search",
    name: "Open sidebar Search",
    appMapId: "grok-android",
  },
  {
    id: "test-grok-web-signed-in-open-conversation",
    name: "Open existing sidebar conversation",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-older-chat",
    name: "Older conversation",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-history-collapse",
    name: "History collapse from Search preview",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-delete",
    name: "Delete conversation",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-sidebar",
    name: "Toggle sidebar",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-settings-language",
    name: "Settings Language",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-android-settings",
    name: "Open Settings",
    appMapId: "grok-android",
  },
  {
    id: "test-grok-web-signed-in-banner",
    name: "SuperGrok banner",
    appMapId: "grok-web",
  },
  {
    id: "test-grok-web-signed-in-hide-upsell",
    name: "Inspect upsell",
    appMapId: "grok-web",
  },
];

test("reviewed workbook freeze keeps 58 originals, 15 active families, and 5 exclusions", () => {
  const manifest = loadReviewedWorkbook();
  assert.equal(manifest.revision, 16);
  assert.equal(manifest.counts.originals, 58);
  assert.equal(manifest.counts.families, 17);
  assert.equal(manifest.counts.activeFamilies, 15);
  assert.deepEqual(manifest.counts.excludedFamilies, ["S15", "S17"]);
  assert.equal(manifest.counts.globallyExcludedOriginals, 5);
  assert.equal(manifest.counts.remainingBeforePlatformTierGates, 53);
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.equal(report.originalCount, 58);
  assert.equal(report.activeFamilyCount, 15);
  assert.deepEqual(report.excludedFamilyIds, ["S15", "S17"]);
  assert.deepEqual(report.excludedOriginalIds, [5, 18, 19, 20, 42]);
  assert.equal(report.excludedCount, 5);
  assert.equal(report.boundCount, 2);
  assert.equal(report.unboundCount, 51);
  assert.equal(report.remainingBeforePlatformTierGates, 53);
  assert.deepEqual(report.coveredOriginalIds, [4, 40]);
  assert.deepEqual(rc23WorkbookBoundOriginalIds(), [4, 40]);
  assert.equal(report.boundCount + report.unboundCount + report.excludedCount, 58);
  assert.notEqual(report.boundCount, 53);
});

test("similarly named live Tests do not cover Customize Grok, Imagine, Dictation, or original 50", () => {
  const manifest = loadReviewedWorkbook();
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  const byId = new Map(manifest.originals.map((item) => [item.id, item]));
  assert.equal(byId.get(8)?.status, "unbound");
  assert.equal(byId.get(37)?.status, "unbound");
  assert.equal(byId.get(42)?.status, "excluded");
  assert.equal(byId.get(50)?.status, "unbound");
  assert.equal(byId.get(49)?.status, "unbound");
  assert.equal(byId.get(48)?.status, "unbound");
  assert.equal(byId.get(51)?.status, "unbound");
  assert.equal(originalIsCovered(byId.get(8)!), false);
  assert.equal(originalIsCovered(byId.get(37)!), false);
  assert.equal(originalIsCovered(byId.get(42)!), false);
  assert.equal(originalIsCovered(byId.get(50)!), false);
  assert.equal(originalIsCovered(byId.get(49)!), false);
  assert.equal(originalIsCovered(byId.get(48)!), false);
  assert.equal(originalIsCovered(byId.get(51)!), false);
  assert.equal(
    similarNamedTests(byId.get(8)!, similarCatalog).some(
      (row) => row.id === "test-grok-ios-presets",
    ),
    true,
  );
  assert.equal(
    similarNamedTests(byId.get(37)!, similarCatalog).some(
      (row) => row.id === "test-grok-ios-imagine",
    ),
    true,
  );
  assert.equal(
    similarNamedTests(byId.get(42)!, similarCatalog).some(
      (row) => row.id === "test-grok-ios-dictation",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 8 && row.testId === "test-grok-ios-presets",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 37 && row.testId === "test-grok-ios-imagine",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 42 && row.testId === "test-grok-ios-dictation",
    ),
    true,
  );
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
      (row) => row.originalId === 6 && row.testId === "test-grok-ios-composer-focus",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 28 && row.testId === "test-grok-web-signed-in-model-iterate",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 28 && row.testId === "test-grok-web-wait-think-harder",
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
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 11 && row.testId === "test-grok-web-sources",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 30 && row.testId === "test-grok-web-signed-in-plugins",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 56 && row.testId === "test-grok-web-news",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 16 && row.testId === "test-grok-web-signed-in-imagine",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 16 && row.testId === "test-grok-ios-imagine",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 17 && row.testId === "test-grok-android-imagine",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 50 && row.testId === "test-grok-android-unrecorded-heavy-image-5",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 54 && row.testId === "test-grok-ios-imagine",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 55 && row.testId === "test-grok-web-logged-out-imagine-judged",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 49 && row.testId === "test-grok-web-signed-in-imagine",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 49 && row.testId === "test-grok-web-signed-in-search",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 49 && row.testId === "test-grok-android-search",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 49 && row.testId === "test-grok-web-signed-in-3x5",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 41 && row.testId === "test-grok-web-signed-in-settings-language",
    ),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 43 && row.testId === "test-grok-web-signed-in-banner",
    ),
    true,
  );
  assert.equal(
    [
      8, 37, 42, 50, 48, 51, 44, 47, 1, 2, 6, 28, 29, 9, 10, 12, 13, 11, 30, 56, 16, 17, 54, 55, 49,
      41, 43,
    ].every((id) => !report.coveredOriginalIds.includes(id)),
    true,
  );
});

test("grok-ios-daily 12/12 is not the 58-row workbook", () => {
  const manifest = loadReviewedWorkbook();
  const pack = manifest.notWorkbookPacks.find((row) => row.packId === "grok-ios-daily");
  assert.equal(pack?.testIds.length, 12);
  assert.equal(pack?.testIds.includes("test-grok-ios-imagine"), false);
  const report = evaluateWorkbookCoverage(
    manifest,
    pack!.testIds.map((id) => ({ id, name: id })),
  );
  const coverage = report.packCoverage.find((row) => row.packId === "grok-ios-daily");
  assert.deepEqual(coverage?.coveredOriginalIds, []);
  assert.deepEqual(report.coveredOriginalIds, [4, 40]);
  assert.equal(report.errors.length, 0);
  const imagine = manifest.notWorkbookPacks.find((row) => row.packId === "grok-ios-imagine");
  assert.deepEqual(imagine?.testIds, ["test-grok-ios-imagine"]);
});

test("preserves unresolved conflicts and records the owner decision for original 50", () => {
  const manifest = loadReviewedWorkbook();
  const ids = manifest.conflicts.map((item) => item.id);
  assert.deepEqual(ids, [
    "customize-grok-removed-vs-peek",
    "dictation-workbook-skip-vs-ios-dest-end",
  ]);
  assert.equal(
    manifest.conflicts.every((item) => item.status === "unresolved"),
    true,
  );
  assert.deepEqual(
    manifest.conflicts.find((item) => item.id === "customize-grok-removed-vs-peek")?.originalIds,
    [8],
  );
  assert.deepEqual(
    manifest.conflicts.find((item) => item.id === "dictation-workbook-skip-vs-ios-dest-end")
      ?.originalIds,
    [42],
  );
  assert.equal(
    manifest.conflicts.some((item) => item.id === "orig-50-fast-vs-heavy-expert"),
    false,
  );
  const orig50 = manifest.originals.find((item) => item.id === 50);
  assert.match(orig50?.gates.join(" ") ?? "", /five-image edit requires Heavy\/Expert/u);
});

test("sequence capture does not bind workbook originals without kind:reviewed", () => {
  const manifest = loadReviewedWorkbook();
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.deepEqual(report.coveredOriginalIds, [4, 40]);
  const survival = manifest.originals.find((item) => item.family === "S16");
  assert.equal(survival?.status, "unbound");
  assert.equal(originalIsCovered(survival!), false);
  assert.equal(coverByFindingSimilarlyNamedTest(survival!, similarCatalog), false);
});

test("RC-13 every original has a packet; excluded keep packet+exclusion; dest-end binds only 4 and 40", () => {
  const manifest = loadReviewedWorkbook();
  assert.equal(manifest.originals.length, 58);
  assert.equal(
    manifest.originals.every((item) => item.evidencePacket in WORKBOOK_EVIDENCE_PACKET_LABELS),
    true,
  );
  assert.equal(
    manifest.originals.every((item) => item.criteria.trim().length > 0),
    true,
  );
  const excluded = manifest.originals.filter((item) => item.status === "excluded");
  assert.equal(excluded.length, 5);
  assert.equal(
    excluded.every(
      (item) =>
        Boolean(item.exclusion) && Boolean(item.evidencePacket) && item.bindings.length === 0,
    ),
    true,
  );
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.equal(report.boundCount, 2);
  assert.equal(report.unboundCount, 51);
  assert.deepEqual(report.coveredOriginalIds, [4, 40]);
  assert.equal(
    manifest.originals.every((item) => {
      const obligation = workbookOriginalObligationIdentity(item);
      return (
        obligation.requirementId === item.gqaId &&
        obligation.caption === item.name &&
        obligation.criteria === item.criteria
      );
    }),
    true,
  );
  assert.equal(
    manifest.originals.every(
      (item) =>
        item.suggestedExecutionQueue ===
        suggestedExecutionQueueForOriginal({
          id: item.id,
          family: item.family,
          evidencePacket: item.evidencePacket,
        }),
    ),
    true,
  );
});

test("RC-13 S16 cannot be single-view Fast UI; S11 download is receipt; S08 math is human review", () => {
  const manifest = loadReviewedWorkbook();
  const survival = manifest.originals.filter((item) => item.family === WORKBOOK_SURVIVAL_FAMILY_ID);
  assert.equal(survival.length, 6);
  assert.equal(
    survival.every(
      (item) =>
        (item.evidencePacket === "sequence" || item.evidencePacket === "persistence") &&
        item.suggestedExecutionQueue === "stateful-survival" &&
        item.status === "unbound",
    ),
    true,
  );
  const forceClose = survival.find((item) => item.id === 22);
  assert.equal(forceClose?.evidencePacket, "persistence");
  const imagineSwap = survival.find((item) => item.id === 27);
  assert.equal(imagineSwap?.evidencePacket, "sequence");
  const download = manifest.originals.find((item) => item.id === 16);
  assert.equal(download?.evidencePacket, "screenshot-receipt");
  assert.equal(download?.suggestedExecutionQueue, "live-output");
  const math = manifest.originals.find((item) => item.id === 48);
  assert.equal(math?.evidencePacket, "generated-output");
  assert.equal(math?.suggestedExecutionQueue, "live-output");
  assert.match(math?.criteria ?? "", /Result should appear instantly/u);
  assert.match(math?.gates.join(" ") ?? "", /No mandatory number-equals judge/u);
  assert.equal(workbookOriginalAllowsAutoJudge(math!), false);
  const mathSlot = workbookOriginalObligationIdentity(math!);
  assert.equal(mathSlot.criteria, math?.criteria);
  assert.notEqual(mathSlot.criteria, "contains 15");
  const packets = countWorkbookEvidencePackets(manifest.originals);
  assert.equal(
    Object.values(packets).reduce((sum, count) => sum + count, 0),
    58,
  );
  const queues = countWorkbookSuggestedQueues(manifest.originals);
  assert.equal(queues["fast-ui"] + queues["live-output"] + queues["stateful-survival"], 58);
  assert.equal(queues["stateful-survival"] >= survival.length, true);
});

test("RC-13 similarly named Test still does not cover originals 8, 37, 42, or 50", () => {
  const manifest = loadReviewedWorkbook();
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.deepEqual(report.coveredOriginalIds, [4, 40]);
  assert.equal(
    [8, 37, 42, 50, 48, 51, 44, 47].every((id) => !report.coveredOriginalIds.includes(id)),
    true,
  );
  assert.equal(
    report.nameCollisions.some(
      (row) => row.originalId === 8 && row.testId === "test-grok-ios-presets",
    ),
    true,
  );
});

test("RC-19 unresolved-step Imagine compile leaves original 37 unbound in the 53 remaining", () => {
  const manifest = loadReviewedWorkbook();
  const report = workbookCoverageAfterCompileAttempts(manifest, similarCatalog, [
    { testId: "test-grok-ios-imagine", errorCode: "unresolved-step" },
  ]);
  assert.equal(report.remainingBeforePlatformTierGates, 53);
  assert.equal(report.boundCount, 2);
  assert.equal(report.unboundCount, 51);
  assert.equal(report.excludedCount, 5);
  assert.equal(report.unboundOriginalIds.includes(37), true);
  assert.equal(report.coveredOriginalIds.includes(37), false);
  const imagine = manifest.originals.find((item) => item.id === 37);
  assert.equal(imagine?.status, "unbound");
  assert.equal(originalIsCovered(imagine!), false);
  assert.equal(coverByFindingSimilarlyNamedTest(imagine!, similarCatalog), false);
  assert.equal(coverByRc23DestEnd(imagine!, "imagine"), false);
  assert.match(imagine?.gates.join(" ") ?? "", /navigation\.tab\.imagine absent/u);
});

test("RC-23 dest-ends bind orig 4 and 40 by slot identity; similar names do not auto-bind", () => {
  const manifest = loadReviewedWorkbook();
  assert.deepEqual(
    WORKBOOK_RC23_PLATFORM_CONFIGURATION,
    RC23_SCREENSHOT_FIRST_PLATFORM_CONFIGURATION,
  );
  assert.equal(WORKBOOK_RC23_REQUIREMENT_ID, RC23_SCREENSHOT_FIRST_REQUIREMENT_ID);
  const attach = manifest.originals.find((item) => item.id === 4)!;
  const settings = manifest.originals.find((item) => item.id === 40)!;
  const composer = manifest.originals.find((item) => item.id === 6)!;
  const send = manifest.originals.find((item) => item.id === 1)!;
  const multiline = manifest.originals.find((item) => item.id === 2)!;
  const models = manifest.originals.find((item) => item.id === 7)!;
  const sidebar = manifest.originals.find((item) => item.id === 33)!;
  const logo = manifest.originals.find((item) => item.id === 35)!;
  const puppy = manifest.originals.find((item) => item.id === 54)!;
  assert.equal(attach.status, "bound");
  assert.equal(settings.status, "bound");
  assert.equal(attach.evidencePacket, "view");
  assert.equal(settings.evidencePacket, "view");
  assert.equal(attach.bindings.length, 3);
  assert.equal(settings.bindings.length, 3);
  assert.equal(
    attach.bindings.every((binding) => isRc23DestEndBinding(binding)),
    true,
  );
  for (const platform of ["web", "android", "ios"] as const) {
    const attachSlot = rc23WorkbookBindingSlotId("attach", platform);
    const settingsSlot = rc23WorkbookBindingSlotId("settings", platform);
    assert.match(attachSlot, /::attach::/u);
    assert.notEqual(attachSlot, "Attach");
    assert.notEqual(settingsSlot, "Settings");
    assert.equal(coverByRc23DestEnd(attach, "attach", platform), true);
    assert.equal(coverByRc23DestEnd(settings, "settings", platform), true);
    assert.equal(
      attach.bindings.some(
        (binding) => binding.platform === platform && binding.slotId === attachSlot,
      ),
      true,
    );
    assert.equal(
      settings.bindings.some(
        (binding) => binding.platform === platform && binding.slotId === settingsSlot,
      ),
      true,
    );
    assert.equal(
      RC23_SCREENSHOT_FIRST_TESTS.attach[platform],
      attach.bindings.find((row) => row.platform === platform)?.testId,
    );
    assert.equal(
      RC23_SCREENSHOT_FIRST_TESTS.settings[platform],
      settings.bindings.find((row) => row.platform === platform)?.testId,
    );
  }
  assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 1), false);
  assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 2), false);
  assert.equal(rc23DestEndSatisfiesOriginal("composer-focus", 6), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 7), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 28), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 29), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 11), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 30), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 56), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 31), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 57), false);
  assert.equal(rc23DestEndSatisfiesOriginal("models", 58), false);
  assert.equal(rc23DestEndSatisfiesOriginal("sidebar", 33), false);
  assert.equal(rc23DestEndSatisfiesOriginal("logo", 35), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 37), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 16), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 17), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 50), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 54), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 55), false);
  assert.equal(rc23DestEndSatisfiesOriginal("imagine", 49), false);
  assert.equal(rc23DestEndSatisfiesOriginal("dictation", 42), false);
  assert.equal(rc23DestEndSatisfiesOriginal("settings", 41), false);
  assert.equal(rc23DestEndSatisfiesOriginal("settings", 43), false);
  assert.equal(rc23DestEndSatisfiesOriginal("settings", 44), false);
  assert.equal(rc23DestEndSatisfiesOriginal("private-chat", 4), false);
  assert.equal(coverByFindingSimilarlyNamedTest(composer, similarCatalog), false);
  assert.equal(send.status, "unbound");
  assert.equal(multiline.status, "unbound");
  assert.equal(composer.status, "unbound");
  assert.equal(models.status, "unbound");
  assert.equal(sidebar.status, "unbound");
  assert.equal(logo.status, "unbound");
  assert.equal(puppy.status, "unbound");
  const shell = manifest.originals.filter((item) => item.family === WORKBOOK_SHELL_FAMILY_ID);
  assert.deepEqual(
    shell.map((item) => item.id),
    [...WORKBOOK_SHELL_ORIGINAL_IDS],
  );
  assert.equal(
    shell.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0,
    ),
    true,
  );
  const modelsFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_MODELS_FAMILY_ID,
  );
  assert.deepEqual(
    modelsFamily.map((item) => item.id),
    [...WORKBOOK_MODELS_ORIGINAL_IDS],
  );
  assert.equal(
    modelsFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0,
    ),
    true,
  );
  const switchKinds = new Set(models.evidenceNeeded?.map((item) => item.kind) ?? []);
  assert.equal(
    ["before", "after", "receipt"].every((kind) => switchKinds.has(kind)),
    true,
  );
  assert.equal(
    similarNamedTests(models, similarCatalog).some(
      (row) => row.id === "test-grok-web-signed-in-model-iterate",
    ),
    true,
  );
  const outputFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_OUTPUT_FAMILY_ID,
  );
  assert.deepEqual(
    outputFamily.map((item) => item.id),
    [...WORKBOOK_OUTPUT_ORIGINAL_IDS],
  );
  assert.equal(
    outputFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.evidencePacket === "generated-output" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        workbookOriginalAllowsAutoJudge(item) === false,
    ),
    true,
  );
  const mathKinds = new Set(
    manifest.originals.find((item) => item.id === 48)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => mathKinds.has(kind)),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 48)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-3x5"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 51)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-capital"),
    true,
  );
  const authFamily = manifest.originals.filter((item) => item.family === WORKBOOK_AUTH_FAMILY_ID);
  assert.deepEqual(
    authFamily.map((item) => item.id),
    [...WORKBOOK_AUTH_ORIGINAL_IDS],
  );
  assert.equal(
    authFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "stateful-survival" &&
        coverByCloudflareOrWeeklyAuthPause(item) === false,
    ),
    true,
  );
  const signOutKinds = new Set(
    manifest.originals.find((item) => item.id === 44)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => signOutKinds.has(kind)),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 44)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-sign-out"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 47)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signup"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 45)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-weekly"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 44 }, "settings"), false);
  const composerFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_COMPOSER_FAMILY_ID,
  );
  assert.deepEqual(
    composerFamily.map((item) => item.id),
    [...WORKBOOK_COMPOSER_ORIGINAL_IDS],
  );
  assert.equal(
    composerFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        coverByComposerFocusOrSendHello(item) === false,
    ),
    true,
  );
  const sendKinds = new Set(
    manifest.originals.find((item) => item.id === 1)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => sendKinds.has(kind)),
    true,
  );
  const multilineKinds = new Set(
    manifest.originals.find((item) => item.id === 2)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["view", "receipt"].every((kind) => multilineKinds.has(kind)),
    true,
  );
  const typeaheadKinds = new Set(
    manifest.originals.find((item) => item.id === 6)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "restart", "after", "receipt"].every((kind) => typeaheadKinds.has(kind)),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 1)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-send-hello"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 2)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-multiline"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 6)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-ios-composer-focus"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 1 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 2 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 6 }, "composer-focus"), false);
  const autoFamily = manifest.originals.filter((item) => item.family === WORKBOOK_AUTO_FAMILY_ID);
  assert.deepEqual(
    autoFamily.map((item) => item.id),
    [...WORKBOOK_AUTO_ORIGINAL_IDS],
  );
  assert.equal(
    autoFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "live-output" &&
        coverByModelIterateOrPricingTap(item) === false,
    ),
    true,
  );
  const autoFastKinds = new Set(
    manifest.originals.find((item) => item.id === 28)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => autoFastKinds.has(kind)),
    true,
  );
  const autoFastReceipts =
    manifest.originals
      .find((item) => item.id === 28)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
  assert.equal(autoFastReceipts.length >= 2, true);
  const autoExpertReceipts =
    manifest.originals
      .find((item) => item.id === 29)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
  assert.equal(autoExpertReceipts.length >= 2, true);
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 28)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-model-iterate"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 28)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-wait-think-harder"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 29)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-model-iterate"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 28 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 29 }, "models"), false);
  const chromeFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_CHROME_FAMILY_ID,
  );
  assert.deepEqual(
    chromeFamily.map((item) => item.id),
    [...WORKBOOK_CHROME_ORIGINAL_IDS],
  );
  assert.equal(
    chromeFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "live-output" &&
        coverByToolbarExpectSetOrShareToast(item) === false,
    ),
    true,
  );
  const toolbarKinds = new Set(
    manifest.originals.find((item) => item.id === 9)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["view", "receipt"].every((kind) => toolbarKinds.has(kind)),
    true,
  );
  const chipKinds = new Set(
    manifest.originals.find((item) => item.id === 10)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => chipKinds.has(kind)),
    true,
  );
  const autoscrollKinds = new Set(
    manifest.originals.find((item) => item.id === 12)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(autoscrollKinds.has("sequence"), true);
  const shareKinds = new Set(
    manifest.originals.find((item) => item.id === 13)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["view", "receipt"].every((kind) => shareKinds.has(kind)),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 9)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-toolbar"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 9)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-toolbar-existing"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 13)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-share"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 13)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-more-header"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 9 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 10 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 12 }, "home-chrome"), false);
  assert.equal(coverByRc23DestEnd({ id: 13 }, "settings"), false);
  const toolsFamily = manifest.originals.filter((item) => item.family === WORKBOOK_TOOLS_FAMILY_ID);
  assert.deepEqual(
    toolsFamily.map((item) => item.id),
    [...WORKBOOK_TOOLS_ORIGINAL_IDS],
  );
  assert.equal(
    toolsFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "live-output" &&
        item.evidencePacket === "sequence" &&
        coverByUnrecordedSourcesNewsOrPlugins(item) === false,
    ),
    true,
  );
  const sourcesKinds = new Set(
    manifest.originals.find((item) => item.id === 11)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(sourcesKinds.has("sequence"), true);
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 11)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  const slackKinds = new Set(
    manifest.originals.find((item) => item.id === 30)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(slackKinds.has("sequence"), true);
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 30)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  const newsKinds = new Set(
    manifest.originals.find((item) => item.id === 56)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(newsKinds.has("sequence"), true);
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 56)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 11)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-sources"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 11)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-3x5"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 11)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-model-iterate"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 30)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-plugins"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 56)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-news"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 56)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-wait-think-harder"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 11 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 30 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 56 }, "home-chrome"), false);
  const heavyFamily = manifest.originals.filter((item) => item.family === WORKBOOK_HEAVY_FAMILY_ID);
  assert.deepEqual(
    heavyFamily.map((item) => item.id),
    [...WORKBOOK_HEAVY_ORIGINAL_IDS],
  );
  assert.equal(
    heavyFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "live-output" &&
        item.evidencePacket === "sequence" &&
        coverByUnrecordedHeavyOrFinanceDestEnd(item) === false,
    ),
    true,
  );
  const heavyKinds = new Set(
    manifest.originals.find((item) => item.id === 31)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(heavyKinds.has("sequence"), true);
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 31)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  const heavyNewsKinds = new Set(
    manifest.originals.find((item) => item.id === 57)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(heavyNewsKinds.has("sequence"), true);
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 57)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  const investmentKinds = new Set(
    manifest.originals.find((item) => item.id === 58)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(investmentKinds.has("sequence"), true);
  assert.equal(investmentKinds.has("receipt"), true);
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 31)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-plugins"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 31)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-3x5"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 31)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-model-iterate"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 31)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-unrecorded-heavy-image-5"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 57)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-news"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 57)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-wait-think-harder"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 58)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-finance"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 58)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-unrecorded-heavy-image-5"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 31 }, "models"), false);
  assert.equal(coverByRc23DestEnd({ id: 57 }, "composer-focus"), false);
  assert.equal(coverByRc23DestEnd({ id: 58 }, "home-chrome"), false);
  const imageFamily = manifest.originals.filter((item) => item.family === WORKBOOK_IMAGE_FAMILY_ID);
  assert.deepEqual(
    imageFamily.map((item) => item.id),
    [...WORKBOOK_IMAGE_ORIGINAL_IDS],
  );
  assert.equal(
    imageFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "live-output" &&
        coverByImagineDestEndOrUnrecordedHeavyImage(item) === false,
    ),
    true,
  );
  const downloadKinds = new Set(
    manifest.originals.find((item) => item.id === 16)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["view", "receipt"].every((kind) => downloadKinds.has(kind)),
    true,
  );
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 16)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  const makeVideoReceipts =
    manifest.originals
      .find((item) => item.id === 17)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0;
  assert.equal(makeVideoReceipts >= 2, true);
  const fiveImageReceipts =
    manifest.originals
      .find((item) => item.id === 50)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0;
  assert.equal(fiveImageReceipts >= 2, true);
  const puppyKinds = new Set(
    manifest.originals.find((item) => item.id === 54)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(puppyKinds.has("receipt"), true);
  assert.equal(puppyKinds.has("after"), true);
  const hatKinds = new Set(
    manifest.originals.find((item) => item.id === 55)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(hatKinds.has("receipt"), true);
  assert.equal(hatKinds.has("after"), true);
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 16)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-imagine"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 16)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-ios-imagine"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 17)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-imagine"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 50)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-unrecorded-heavy-image-5"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 54)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-ios-imagine"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 55)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-logged-out-imagine-judged"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 16 }, "imagine"), false);
  assert.equal(coverByRc23DestEnd({ id: 17 }, "imagine"), false);
  assert.equal(coverByRc23DestEnd({ id: 50 }, "imagine"), false);
  assert.equal(coverByRc23DestEnd({ id: 54 }, "imagine"), false);
  assert.equal(coverByRc23DestEnd({ id: 55 }, "imagine"), false);
  const imageSearchFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_IMAGE_SEARCH_FAMILY_ID,
  );
  assert.deepEqual(
    imageSearchFamily.map((item) => item.id),
    [...WORKBOOK_IMAGE_SEARCH_ORIGINAL_IDS],
  );
  assert.equal(
    imageSearchFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        item.suggestedExecutionQueue === "live-output" &&
        coverByImagineDestEndOrHistorySearch(item) === false,
    ),
    true,
  );
  const imageSearchKinds = new Set(
    manifest.originals.find((item) => item.id === 49)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(imageSearchKinds.has("sequence"), true);
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 49)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 3,
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 49)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-imagine"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 49)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-search"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 49)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-search"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 49)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-3x5"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 49)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-unrecorded-heavy-image-5"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 49 }, "imagine"), false);
  const historyFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_HISTORY_FAMILY_ID,
  );
  assert.deepEqual(
    historyFamily.map((item) => item.id),
    [...WORKBOOK_HISTORY_ORIGINAL_IDS],
  );
  assert.equal(
    historyFamily.every(
      (item) =>
        item.status === "unbound" &&
        item.requirementAction === "test-action" &&
        (item.evidenceNeeded?.length ?? 0) > 0 &&
        item.bindings.length === 0 &&
        item.criteria.trim().length > 0 &&
        coverByHistoryDestEndOrCommandMenuSearch(item) === false,
    ),
    true,
  );
  const olderKinds = new Set(
    manifest.originals.find((item) => item.id === 21)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => olderKinds.has(kind)),
    true,
  );
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 21)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 21,
      family: WORKBOOK_HISTORY_FAMILY_ID,
      evidencePacket: "transition",
    }),
    "stateful-survival",
  );
  const expandKinds = new Set(
    manifest.originals.find((item) => item.id === 34)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(expandKinds.has("receipt"), true);
  assert.equal(expandKinds.has("view"), true);
  const historySearchKinds = new Set(
    manifest.originals.find((item) => item.id === 38)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "after", "receipt"].every((kind) => historySearchKinds.has(kind)),
    true,
  );
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 38)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  const deleteKinds = new Set(
    manifest.originals.find((item) => item.id === 39)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "restart", "after", "receipt"].every((kind) => deleteKinds.has(kind)),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 21)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-open-conversation"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 21)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-older-chat"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 38)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-search"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 38)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-android-search"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 34)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-history-collapse"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 34)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-sidebar"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 39)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-delete"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 21 }, "sidebar"), false);
  assert.equal(coverByRc23DestEnd({ id: 34 }, "sidebar"), false);
  assert.equal(coverByRc23DestEnd({ id: 38 }, "sidebar"), false);
  assert.equal(coverByRc23DestEnd({ id: 39 }, "settings"), false);
  const settingsFamily = manifest.originals.filter(
    (item) => item.family === WORKBOOK_SETTINGS_FAMILY_ID,
  );
  assert.deepEqual(
    settingsFamily.map((item) => item.id),
    [40, ...WORKBOOK_SETTINGS_UNBOUND_ORIGINAL_IDS],
  );
  assert.equal(settingsFamily.find((item) => item.id === 40)?.status, "bound");
  assert.equal(
    settingsFamily
      .filter((item) => item.id !== 40)
      .every(
        (item) =>
          item.status === "unbound" &&
          item.requirementAction === "test-action" &&
          (item.evidenceNeeded?.length ?? 0) > 0 &&
          item.bindings.length === 0 &&
          item.criteria.trim().length > 0 &&
          coverBySettingsDestEndOrLanguageInspect(item) === false,
      ),
    true,
  );
  const languageKinds = new Set(
    manifest.originals.find((item) => item.id === 41)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(
    ["before", "restart", "after", "receipt"].every((kind) => languageKinds.has(kind)),
    true,
  );
  assert.equal(
    (manifest.originals
      .find((item) => item.id === 41)
      ?.evidenceNeeded?.filter((item) => item.kind === "receipt").length ?? 0) >= 2,
    true,
  );
  assert.equal(
    suggestedExecutionQueueForOriginal({
      id: 41,
      family: WORKBOOK_SETTINGS_FAMILY_ID,
      evidencePacket: "persistence",
    }),
    "stateful-survival",
  );
  const superGrokKinds = new Set(
    manifest.originals.find((item) => item.id === 43)?.evidenceNeeded?.map((item) => item.kind) ??
      [],
  );
  assert.equal(superGrokKinds.has("receipt"), true);
  assert.equal(superGrokKinds.has("view"), true);
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 41)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-settings-language"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 41)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-settings"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 43)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-banner"),
    true,
  );
  assert.equal(
    similarNamedTests(
      manifest.originals.find((item) => item.id === 43)!,
      similarCatalog,
    ).some((row) => row.id === "test-grok-web-signed-in-hide-upsell"),
    true,
  );
  assert.equal(coverByRc23DestEnd({ id: 41 }, "settings"), false);
  assert.equal(coverByRc23DestEnd({ id: 43 }, "settings"), false);
  const slotsPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../tests/coverage/rc23-screenshot-first-slots.json",
  );
  const slots = JSON.parse(readFileSync(slotsPath, "utf8")) as {
    workbookBound: number;
    workbookBoundOriginalIds?: number[];
    requirementId: string;
  };
  assert.equal(slots.workbookBound, 2);
  assert.deepEqual(slots.workbookBoundOriginalIds, [4, 40]);
  assert.equal(slots.requirementId, "rc23-screenshot-first");
  assert.equal(slots.requirementId.startsWith("GQA-"), false);
});
