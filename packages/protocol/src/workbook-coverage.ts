/**
 * RC-09 / RC-13 coverage compiler. Coverage is only an explicit reviewed Test
 * binding whose dest-end executed that original's causal action. A similarly
 * named Test, grok-ios-daily 12/12, composer-focus inspect, or Unbound Imagine
 * never marks an original covered. Every original has a smallest-sufficient
 * evidence packet or an authorized exclusion; that packet is not coverage.
 * Captions are display text; obligations are plannedSlots identities.
 * S02 shell, S05 model/preset, S08 output-battery, S01 auth, S03
 * composer, S06 Auto-routing, S07 response-chrome, S09
 * single-agent tools + sources, S10 Heavy multi-agent, S11
 * image gen + edit + export, S12 image search, S13 history
 * lifecycle, S14 App Language / SuperGrok row, and S04 GQA-053
 * upload analysis originals keep
 * explicit test-action evidence-needed while remaining unbound.
 * GQA-040 Settings inventory stays the RC-23 dest-end view.
 * GQA-004 attach menu stays the RC-23 dest-end view.
 * Leftover Fast-checked is not a models Test. Inspect-only model
 * sheet is not Switch model, presets, or Auto Fast/Expert routing.
 * Leftover 3*5 extract-15 / Markdown judge is not S08 generated-output
 * coverage. Cloudflare Sign up / weekly Continue-with-X pause /
 * grok-lab leftover is not S01 coverage. Composer-focus inspect /
 * send-hello paywall / multiline extract-15 is not S03 type+send,
 * expand, or typeahead persistence. Model-iterate inspect / SuperGrok
 * pricing TAP / Think harder YAML seed is not S06 Auto routing.
 * Leftover 3*5 toolbar expect-set / dest-end toolbar-existing / More
 * extras-forbid / clipboard-denied share toast is not S07 Response
 * toolbar, follow-up chips, autoscroll, or Share. YAML sources/news
 * unrecorded / leftover 3*5 Search the web absent / inspect-only
 * Expert sheet / plugins overlay is not S09 Sources rail, Slack tools,
 * or Latest news. YAML sources/news unrecorded / leftover 3*5 /
 * inspect-only Expert or Heavy sheet / plugins overlay / finance
 * dest-end / orig 50 Heavy 5-image / S09 single-agent Slack/news is
 * not S10 Heavy agents, Heavy Latest news, or Heavy investment.
 * Imagine dest-end / iOS Imagine Unbound / logged-out Imagine judged
 * / UNRECORDED orig 50 Heavy 5-image / leftover 3*5 / S02 Imagine
 * from menu / S10 Heavy agents / GQA-008 Create Videos preset is
 * not S11 image gen download, Make Video, five-image edit, Draw a
 * puppy, or Draw a hat. Imagine dest-end / iOS Imagine Unbound /
 * logged-out Imagine judged / leftover 3*5 / S11 image gen / S02
 * Imagine from menu / S10 Heavy / GQA-008 Create Videos / history
 * Command Menu search is not S12 Image search. Dest-end
 * open-conversation / older-chat compile-blocked / Command Menu
 * search / Android Search dest-end / history-collapse / leftover
 * 3*5 / S12 Image search / draft delete-wrong-chat is not S13
 * open older conversation, History expand, search history, or
 * delete persistence. Settings dest-end / inspect-only Language
 * Selector / SuperGrok home banner / hide-upsell inspect is not
 * S14 App Language mutate or SuperGrok row. Paperclip dest-end /
 * 19z5.15/19z5.19 Upload a file compiles without YAML / iOS
 * Files-app compile-block / logged-out upload chip / signed-in
 * dest-end chip is not S04 GQA-053 upload analysis. Original criteria
 * stay on the slot.
 */
import { EXECUTION_QUEUES, type ExecutionQueue } from "./execution-queue.js";
import {
  WORKBOOK_EVIDENCE_PACKETS,
  type WorkbookEvidencePacket,
  isRc23DestEndBinding,
  type WorkbookOriginal,
  type WorkbookCoverageManifest,
  type WorkbookCatalogTest,
  type WorkbookNameCollision,
  type WorkbookCoverageReport,
  originalIsCovered,
} from "./workbook-coverage-obligations.js";
export * from "./workbook-coverage-obligations.js";
export * from "./workbook-coverage-parser.js";
export * from "./workbook-coverage-policy.js";

function distinctiveNeedles(original: WorkbookOriginal): readonly string[] {
  const fromName = original.name
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 5);
  const extra: string[] = [];
  if (original.id === 1) extra.push("send-hello", "composer");
  if (original.id === 2) extra.push("multiline", "composer");
  if (original.id === 5) extra.push("connector", "connectors");
  if (original.id === 6) extra.push("typeahead", "autocomplete", "composer");
  if (original.id === 9) extra.push("toolbar", "more-header");
  if (original.id === 10) extra.push("follow-up", "chip");
  if (original.id === 12) extra.push("autoscroll");
  if (original.id === 13) extra.push("share", "more-header");
  if (original.id === 11) extra.push("sources", "rail", "model-iterate", "3x5");
  if (original.id === 31)
    extra.push("heavy", "slack", "plugins", "agents", "news", "model-iterate", "3x5");
  if (original.id === 57) extra.push("news", "sources", "heavy", "think-harder", "3x5");
  if (original.id === 58) extra.push("heavy", "finance", "investment", "googl", "tsla");
  if (original.id === 30) extra.push("slack", "plugins", "connector");
  if (original.id === 56) extra.push("news", "think-harder", "sources", "3x5");
  if (original.id === 28) extra.push("think-harder", "model-iterate");
  if (original.id === 29) extra.push("quick-answer", "model-iterate");
  if (original.id === 8) extra.push("preset", "presets", "customize");
  if (original.id === 33) extra.push("sidebar", "menu");
  if (original.id === 3 || original.id === 36) extra.push("new-chat", "newchat");
  if (original.id === 35) extra.push("logo");
  if (original.id === 7) extra.push("model", "models", "selector");
  if (
    original.id === 37 ||
    original.id === 16 ||
    original.id === 17 ||
    original.id === 50 ||
    original.id === 54 ||
    original.id === 55
  )
    extra.push("imagine");
  if (original.id === 16) extra.push("download");
  if (original.id === 17) extra.push("video");
  if (original.id === 42) extra.push("dictation");
  if (original.id === 50) extra.push("heavy", "expert");
  if (original.id === 54) extra.push("puppy");
  if (original.id === 55) extra.push("hat");
  if (original.id === 49) extra.push("imagine", "3x5", "puppy", "download");
  if (original.id === 21) extra.push("open-conversation", "older-chat", "3x5");
  if (original.id === 34) extra.push("sidebar", "history-collapse");
  if (original.id === 38) extra.push("command", "3x5");
  if (original.id === 39) extra.push("delete");
  if (original.id === 14) extra.push("code", "snippet");
  if (original.id === 15) extra.push("markdown");
  if (original.id === 32) extra.push("coffee");
  if (original.id === 48) extra.push("3x5", "math");
  if (original.id === 51) extra.push("capital");
  if (original.id === 52) extra.push("greeting", "language");
  if (original.id === 41) extra.push("settings-language", "settings");
  if (original.id === 43) extra.push("banner", "upsell", "upgrade", "settings");
  if (original.id === 53) extra.push("upload", "files-app", "attach");
  if (original.id === 44) extra.push("sign-out", "signout");
  if (original.id === 45) extra.push("continue", "x-absent", "authorize");
  if (original.id === 46) extra.push("continue", "x-present", "x-app");
  if (original.id === 47) extra.push("signup", "sign-up");
  return [...new Set([...fromName, ...extra])];
}

export function similarNamedTests(
  original: WorkbookOriginal,
  catalog: readonly WorkbookCatalogTest[],
): readonly WorkbookCatalogTest[] {
  const needles = distinctiveNeedles(original);
  return catalog.filter((test) => {
    const hay = `${test.id} ${test.name}`.toLowerCase();
    return needles.some((needle) => hay.includes(needle));
  });
}

export function evaluateWorkbookCoverage(
  manifest: WorkbookCoverageManifest,
  catalog: readonly WorkbookCatalogTest[] = [],
): WorkbookCoverageReport {
  const errors: string[] = [];
  const coveredOriginalIds = manifest.originals.filter(originalIsCovered).map((item) => item.id);
  const unboundOriginalIds = manifest.originals
    .filter((item) => item.status === "unbound")
    .map((item) => item.id);
  const excludedOriginalIds = manifest.originals
    .filter((item) => item.status === "excluded")
    .map((item) => item.id);
  const nameCollisions: WorkbookNameCollision[] = [];
  for (const original of manifest.originals) {
    for (const test of similarNamedTests(original, catalog)) {
      if (original.bindings.some((binding) => binding.testId === test.id)) continue;
      nameCollisions.push({
        originalId: original.id,
        testId: test.id,
        testName: test.name,
        reason: "similar-name-does-not-cover",
      });
    }
  }
  const packCoverage = manifest.notWorkbookPacks.map((pack) => {
    const coveredByPack = manifest.originals
      .filter(
        (original) =>
          originalIsCovered(original) &&
          original.bindings.some(
            (binding) => pack.testIds.includes(binding.testId) && !isRc23DestEndBinding(binding),
          ),
      )
      .map((item) => item.id);
    if (pack.packId === "grok-ios-daily" && coveredByPack.length > 0) {
      errors.push("grok-ios-daily must not mark workbook originals covered");
    }
    return {
      packId: pack.packId,
      testCount: pack.testIds.length,
      coveredOriginalIds: coveredByPack,
    };
  });
  const boundCount = coveredOriginalIds.length;
  const remainingBeforePlatformTierGates = unboundOriginalIds.length + boundCount;
  return {
    originalCount: manifest.originals.length,
    familyCount: manifest.families.length,
    activeFamilyCount: manifest.families.filter((family) => family.active).length,
    excludedFamilyIds: manifest.families
      .filter((family) => !family.active)
      .map((family) => family.id),
    globallyExcludedCount: excludedOriginalIds.length,
    remainingBeforePlatformTierGates,
    boundCount,
    unboundCount: unboundOriginalIds.length,
    excludedCount: excludedOriginalIds.length,
    coveredOriginalIds,
    unboundOriginalIds,
    excludedOriginalIds,
    conflicts: manifest.conflicts,
    nameCollisions,
    packCoverage,
    errors,
  };
}

/**
 * Packet → Test.executionQueue suggestion. Family isolation overrides the
 * default (S16/S01/S15 stay stateful-survival; generated output is never Fast UI).
 * This is not a reviewed Test binding.
 */
export function countWorkbookEvidencePackets(
  originals: readonly Pick<WorkbookOriginal, "evidencePacket">[],
): Record<WorkbookEvidencePacket, number> {
  const counts = Object.fromEntries(
    WORKBOOK_EVIDENCE_PACKETS.map((packet) => [packet, 0]),
  ) as Record<WorkbookEvidencePacket, number>;
  for (const original of originals) counts[original.evidencePacket] += 1;
  return counts;
}

export function countWorkbookSuggestedQueues(
  originals: readonly Pick<WorkbookOriginal, "suggestedExecutionQueue">[],
): Record<ExecutionQueue, number> {
  const counts = Object.fromEntries(EXECUTION_QUEUES.map((queue) => [queue, 0])) as Record<
    ExecutionQueue,
    number
  >;
  for (const original of originals) counts[original.suggestedExecutionQueue] += 1;
  return counts;
}

export function coverByFindingSimilarlyNamedTest(
  original: WorkbookOriginal,
  catalog: readonly WorkbookCatalogTest[],
): boolean {
  void catalog;
  void original;
  return false;
}
