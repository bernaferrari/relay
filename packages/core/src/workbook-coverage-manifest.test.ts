import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  coverByFindingSimilarlyNamedTest,
  countWorkbookEvidencePackets,
  countWorkbookSuggestedQueues,
  evaluateWorkbookCoverage,
  originalIsCovered,
  parseWorkbookCoverageManifest,
  similarNamedTests,
  suggestedExecutionQueueForOriginal,
  workbookCoverageAfterCompileAttempts,
  WORKBOOK_EVIDENCE_PACKET_LABELS,
  WORKBOOK_SURVIVAL_FAMILY_ID,
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
];

test("reviewed workbook freeze keeps 58 originals, 15 active families, and 5 exclusions", () => {
  const manifest = loadReviewedWorkbook();
  assert.equal(manifest.revision, 2);
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
  assert.equal(report.boundCount, 0);
  assert.equal(report.unboundCount, 53);
  assert.equal(report.remainingBeforePlatformTierGates, 53);
  assert.deepEqual(report.coveredOriginalIds, []);
});

test("similarly named live Tests do not cover Customize Grok, Imagine, Dictation, or original 50", () => {
  const manifest = loadReviewedWorkbook();
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  const byId = new Map(manifest.originals.map((item) => [item.id, item]));
  assert.equal(byId.get(8)?.status, "unbound");
  assert.equal(byId.get(37)?.status, "unbound");
  assert.equal(byId.get(42)?.status, "excluded");
  assert.equal(byId.get(50)?.status, "unbound");
  assert.equal(originalIsCovered(byId.get(8)!), false);
  assert.equal(originalIsCovered(byId.get(37)!), false);
  assert.equal(originalIsCovered(byId.get(42)!), false);
  assert.equal(originalIsCovered(byId.get(50)!), false);
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
  assert.equal(report.coveredOriginalIds.length, 0);
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
  const imagine = manifest.notWorkbookPacks.find((row) => row.packId === "grok-ios-imagine");
  assert.deepEqual(imagine?.testIds, ["test-grok-ios-imagine"]);
});

test("Customize Grok, Dictation, and original 50 conflicts stay unresolved", () => {
  const manifest = loadReviewedWorkbook();
  const ids = manifest.conflicts.map((item) => item.id);
  assert.deepEqual(ids, [
    "customize-grok-removed-vs-peek",
    "dictation-workbook-skip-vs-ios-dest-end",
    "orig-50-fast-vs-heavy-expert",
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
  assert.deepEqual(
    manifest.conflicts.find((item) => item.id === "orig-50-fast-vs-heavy-expert")?.originalIds,
    [50],
  );
  const orig50 = manifest.originals.find((item) => item.id === 50);
  assert.match(orig50?.gates.join(" ") ?? "", /Do not guess Fast vs Heavy\/Expert/u);
});

test("sequence capture does not bind workbook originals without kind:reviewed", () => {
  const manifest = loadReviewedWorkbook();
  const report = evaluateWorkbookCoverage(manifest, similarCatalog);
  assert.equal(report.boundCount, 0);
  assert.equal(report.unboundCount, 53);
  const survival = manifest.originals.find((item) => item.family === "S16");
  assert.equal(survival?.status, "unbound");
  assert.equal(originalIsCovered(survival!), false);
  assert.equal(coverByFindingSimilarlyNamedTest(survival!, similarCatalog), false);
});

test("RC-13 every original has a packet; excluded keep packet+exclusion; unbound stay unbound", () => {
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
  assert.equal(report.boundCount, 0);
  assert.equal(report.unboundCount, 53);
  assert.equal(report.coveredOriginalIds.length, 0);
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
  assert.equal(report.boundCount, 0);
  assert.equal(
    [8, 37, 42, 50].every((id) => !report.coveredOriginalIds.includes(id)),
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
  assert.equal(report.boundCount, 0);
  assert.equal(report.unboundCount, 53);
  assert.equal(report.excludedCount, 5);
  assert.equal(report.unboundOriginalIds.includes(37), true);
  assert.equal(report.coveredOriginalIds.includes(37), false);
  const imagine = manifest.originals.find((item) => item.id === 37);
  assert.equal(imagine?.status, "unbound");
  assert.equal(originalIsCovered(imagine!), false);
  assert.equal(coverByFindingSimilarlyNamedTest(imagine!, similarCatalog), false);
  assert.match(imagine?.gates.join(" ") ?? "", /navigation\.tab\.imagine absent/u);
});
