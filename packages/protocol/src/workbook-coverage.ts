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

import { captureReviewSlotId, type CaptureReviewConfiguration } from "./capture-review.js";
import { EXECUTION_QUEUES, type ExecutionQueue } from "./execution-queue.js";
import { isRequirementActionKind, type RequirementActionKind } from "./recipes.js";

export const WORKBOOK_COVERAGE_SCHEMA_VERSION = 1 as const;
export const WORKBOOK_ORIGINAL_COUNT = 58;
export const WORKBOOK_FAMILY_COUNT = 17;
export const WORKBOOK_ACTIVE_FAMILY_COUNT = 15;
export const WORKBOOK_EXCLUDED_FAMILY_IDS = ["S15", "S17"] as const;
export const WORKBOOK_GLOBAL_EXCLUSION_IDS = [5, 18, 19, 20, 42] as const;
export const WORKBOOK_SURVIVAL_FAMILY_ID = "S16";
export const WORKBOOK_AUTH_FAMILY_ID = "S01";
export const WORKBOOK_AUTH_ORIGINAL_IDS = [44, 45, 46, 47] as const;
export const WORKBOOK_SHELL_FAMILY_ID = "S02";
export const WORKBOOK_SHELL_ORIGINAL_IDS = [3, 33, 35, 36, 37] as const;
export const WORKBOOK_COMPOSER_FAMILY_ID = "S03";
export const WORKBOOK_COMPOSER_ORIGINAL_IDS = [1, 2, 6] as const;
export const WORKBOOK_AUTO_FAMILY_ID = "S06";
export const WORKBOOK_AUTO_ORIGINAL_IDS = [28, 29] as const;
export const WORKBOOK_CHROME_FAMILY_ID = "S07";
export const WORKBOOK_CHROME_ORIGINAL_IDS = [9, 10, 12, 13] as const;
export const WORKBOOK_TOOLS_FAMILY_ID = "S09";
export const WORKBOOK_TOOLS_ORIGINAL_IDS = [11, 30, 56] as const;
export const WORKBOOK_HEAVY_FAMILY_ID = "S10";
export const WORKBOOK_HEAVY_ORIGINAL_IDS = [31, 57, 58] as const;
export const WORKBOOK_IMAGE_FAMILY_ID = "S11";
export const WORKBOOK_IMAGE_ORIGINAL_IDS = [16, 17, 50, 54, 55] as const;
export const WORKBOOK_IMAGE_SEARCH_FAMILY_ID = "S12";
export const WORKBOOK_IMAGE_SEARCH_ORIGINAL_IDS = [49] as const;
export const WORKBOOK_HISTORY_FAMILY_ID = "S13";
export const WORKBOOK_HISTORY_ORIGINAL_IDS = [21, 34, 38, 39] as const;
export const WORKBOOK_SETTINGS_FAMILY_ID = "S14";
export const WORKBOOK_SETTINGS_UNBOUND_ORIGINAL_IDS = [41, 43] as const;
export const WORKBOOK_ATTACH_FAMILY_ID = "S04";
export const WORKBOOK_UPLOAD_ANALYSIS_ORIGINAL_ID = 53;
export const WORKBOOK_MODELS_FAMILY_ID = "S05";
export const WORKBOOK_MODELS_ORIGINAL_IDS = [7, 8] as const;
export const WORKBOOK_OUTPUT_FAMILY_ID = "S08";
export const WORKBOOK_OUTPUT_ORIGINAL_IDS = [14, 15, 32, 48, 51, 52] as const;
export const WORKBOOK_MATH_ORIGINAL_ID = 48;
export const WORKBOOK_DOWNLOAD_ORIGINAL_ID = 16;

export const WORKBOOK_EVIDENCE_PACKETS = [
  "view",
  "transition",
  "screenshot-receipt",
  "persistence",
  "sequence",
  "generated-output",
] as const;
export type WorkbookEvidencePacket = (typeof WORKBOOK_EVIDENCE_PACKETS)[number];

/** User review §6A packet names. Criteria text stays even when not auto-asserted. */
export const WORKBOOK_EVIDENCE_PACKET_LABELS: Record<WorkbookEvidencePacket, string> = {
  view: "single view",
  transition: "before/after",
  "screenshot-receipt": "screenshot + file/link receipt",
  persistence: "before/restart/after",
  sequence: "short temporal sequence",
  "generated-output": "generated output at a declared phase",
};

export const WORKBOOK_SURVIVAL_PACKETS = ["sequence", "persistence"] as const;
export type WorkbookSurvivalPacket = (typeof WORKBOOK_SURVIVAL_PACKETS)[number];

/** Smallest-sufficient packet pieces. Criteria text stays even when unbound. */
export const WORKBOOK_EVIDENCE_NEEDED_KINDS = [
  "before",
  "after",
  "receipt",
  "sequence",
  "view",
  "restart",
] as const;
export type WorkbookEvidenceNeededKind = (typeof WORKBOOK_EVIDENCE_NEEDED_KINDS)[number];

export type WorkbookEvidenceNeededItem = {
  kind: WorkbookEvidenceNeededKind;
  id: string;
  note: string;
};

/** Packet → required evidence-needed kinds. Extra kinds (sequence on a
 * transition) are allowed. This is not a reviewed Test binding. */
export function requiredEvidenceNeededKinds(
  packet: WorkbookEvidencePacket,
): readonly WorkbookEvidenceNeededKind[] {
  switch (packet) {
    case "view":
      return ["view"];
    case "transition":
      return ["before", "after", "receipt"];
    case "screenshot-receipt":
      return ["view", "receipt"];
    case "persistence":
      return ["before", "restart", "after"];
    case "sequence":
      return ["sequence"];
    case "generated-output":
      return ["after"];
  }
}

export const WORKBOOK_ORIGINAL_STATUSES = ["bound", "unbound", "excluded"] as const;
export type WorkbookOriginalStatus = (typeof WORKBOOK_ORIGINAL_STATUSES)[number];

export const WORKBOOK_EXCLUSION_KINDS = ["dead", "dead-skip", "skip-temporary"] as const;
export type WorkbookExclusionKind = (typeof WORKBOOK_EXCLUSION_KINDS)[number];

export const WORKBOOK_QUEUES = [
  "fast-ui",
  "output",
  "slow-output",
  "tools/output",
  "auth-isolated",
  "stateful",
  "survival",
  "excluded",
] as const;
export type WorkbookQueue = (typeof WORKBOOK_QUEUES)[number];

export const WORKBOOK_RC23_PLATFORMS = ["web", "android", "ios"] as const;
export type WorkbookRc23Platform = (typeof WORKBOOK_RC23_PLATFORMS)[number];

export const WORKBOOK_RC23_PLATFORM_CONFIGURATION = {
  web: { browser: "grok-com" },
  android: { app: "android" },
  ios: { app: "ai.x.GrokApp" },
} as const satisfies Record<WorkbookRc23Platform, CaptureReviewConfiguration>;

export const WORKBOOK_RC23_REQUIREMENT_ID = "rc23-screenshot-first";

export const WORKBOOK_RC23_APP_MAP_IDS: Record<WorkbookRc23Platform, string> = {
  web: "grok-web",
  android: "grok-android",
  ios: "grok-ios",
};

/**
 * Narrow dest-end table. An RC-23 checkpoint binds a GQA original only when
 * the Test executed that original's causal action as a screenshot-first
 * view / before-after packet. Captions are display text; slotId is identity.
 */
export type Rc23WorkbookDestEndBinding = {
  checkpointId: string;
  originalId: number;
  evidencePacket: Extract<WorkbookEvidencePacket, "view" | "transition">;
  platforms: readonly WorkbookRc23Platform[];
  note: string;
};

export const RC23_WORKBOOK_DEST_END_BINDINGS: readonly Rc23WorkbookDestEndBinding[] = [
  {
    checkpointId: "attach",
    originalId: 4,
    evidencePacket: "view",
    platforms: WORKBOOK_RC23_PLATFORMS,
    note: "Dest-end opens the paperclip import menu (single view). Not orig 5 File Connectors and not orig 53 upload analysis.",
  },
  {
    checkpointId: "settings",
    originalId: 40,
    evidencePacket: "view",
    platforms: WORKBOOK_RC23_PLATFORMS,
    note: "Dest-end opens Settings inventory (single view). Does not tap App Language, Sign Out, or SuperGrok. Not orig 41/43/44.",
  },
];

/** Capture-view leftover skip is only GQA-004 attach and GQA-040 Settings
 * inventory. Other view packets and every transition packet must tap. */
export function destEndViewPacketMayLeftoverSkip(original: {
  id: number;
  evidencePacket: WorkbookEvidencePacket;
}): boolean {
  return (
    original.evidencePacket === "view" &&
    RC23_WORKBOOK_DEST_END_BINDINGS.some(
      (binding) => binding.originalId === original.id && binding.evidencePacket === "view",
    )
  );
}

/** Test-action never leftover-skips, even when leftover already is dest.
 * Capture-view leftover skip stays GQA-004/040 only. */
export function workbookOriginalMayLeftoverSkip(original: {
  id: number;
  evidencePacket: WorkbookEvidencePacket;
  requirementAction?: RequirementActionKind;
}): boolean {
  if (original.requirementAction === "test-action") return false;
  return destEndViewPacketMayLeftoverSkip(original);
}

/** Checkpoints that must not auto-bind similarly named originals. */
export const RC23_WORKBOOK_NON_BINDINGS: readonly {
  checkpointId: string;
  originalIds: readonly number[];
  reason: string;
}[] = [
  {
    checkpointId: "home-chrome",
    originalIds: [],
    reason: "No workbook original is home-chrome inventory.",
  },
  {
    checkpointId: "dictation",
    originalIds: [42],
    reason: "Inspect mic; orig 42 Enable Dictation is globally excluded.",
  },
  {
    checkpointId: "sidebar",
    originalIds: [21, 33, 34, 36],
    reason:
      "Open dest-end is not open+close, History expand, New Chat from menu, or open older conversation + send.",
  },
  {
    checkpointId: "imagine",
    originalIds: [16, 17, 37, 49, 50, 54, 55],
    reason:
      "iOS Imagine Unbound; image-generation rows stay unbound; Android Imagine is a native companion, not a workbook binding. Imagine dest-end is not generate+download, Make Video, five-image edit, Draw a puppy, Draw a hat, or Image search.",
  },
  {
    checkpointId: "logo",
    originalIds: [35],
    reason:
      "Leftover inspect-skip / home wait-for is not logo from Chat/Imagine/Voice/Projects/History.",
  },
  {
    checkpointId: "composer-focus",
    originalIds: [1, 2, 6],
    reason:
      "Inspect/focus without typing does not cover send, multiline expand, or typeahead persistence.",
  },
  {
    checkpointId: "models",
    originalIds: [7, 8, 11, 28, 29, 30, 31, 56, 57, 58],
    reason:
      "Inspect-only model sheet is not Switch model, presets, Auto Fast/Expert routing, S09 sources-rail / Slack tools / Latest news, or S10 Heavy agents / Heavy news / Heavy investment.",
  },
  {
    checkpointId: "private-chat",
    originalIds: [],
    reason: "No workbook original for private chat.",
  },
  {
    checkpointId: "settings",
    originalIds: [41, 43, 44],
    reason:
      "Settings inventory dest-end does not tap App Language, SuperGrok, or Sign Out. GQA-040 stays the dest-end view.",
  },
  {
    checkpointId: "attach",
    originalIds: [5, 53],
    reason:
      "Paperclip dest-end is not File Connectors (excluded) or orig 53 upload analysis. GQA-004 stays the dest-end view. 19z5.15/19z5.19 Upload a file compiles without YAML and iOS Files-app compile-blocked is not GQA-053 coverage.",
  },
];

const RC23_PLATFORM = new Set<string>(WORKBOOK_RC23_PLATFORMS);

export function rc23WorkbookBoundOriginalIds(): number[] {
  return [...new Set(RC23_WORKBOOK_DEST_END_BINDINGS.map((row) => row.originalId))].sort(
    (left, right) => left - right,
  );
}

export function rc23WorkbookNonBindingOriginalIds(): number[] {
  return [...new Set(RC23_WORKBOOK_NON_BINDINGS.flatMap((row) => [...row.originalIds]))].sort(
    (left, right) => left - right,
  );
}

export function rc23WorkbookBindingSlotId(
  checkpointId: string,
  platform: WorkbookRc23Platform,
): string {
  return captureReviewSlotId({
    requirementId: WORKBOOK_RC23_REQUIREMENT_ID,
    checkpointId,
    configuration: WORKBOOK_RC23_PLATFORM_CONFIGURATION[platform],
    attempt: 1,
  });
}

export function rc23DestEndSatisfiesOriginal(
  checkpointId: string,
  originalId: number,
  platform?: WorkbookRc23Platform,
): boolean {
  return RC23_WORKBOOK_DEST_END_BINDINGS.some(
    (row) =>
      row.checkpointId === checkpointId &&
      row.originalId === originalId &&
      (platform === undefined || row.platforms.includes(platform)),
  );
}

export function coverByRc23DestEnd(
  original: Pick<WorkbookOriginal, "id">,
  checkpointId: string,
  platform?: WorkbookRc23Platform,
): boolean {
  return rc23DestEndSatisfiesOriginal(checkpointId, original.id, platform);
}

export function isRc23DestEndBinding(binding: Pick<WorkbookReviewedBinding, "slotId">): boolean {
  const slotId = binding.slotId?.trim() ?? "";
  return slotId.startsWith(`${WORKBOOK_RC23_REQUIREMENT_ID}::`);
}

/** Caption is display text. Obligation identity is GQA id + packet.
 * Original criteria stay visible on the slot even when not auto-asserted. */
export function workbookOriginalObligationIdentity(
  original: Pick<WorkbookOriginal, "gqaId" | "name" | "evidencePacket" | "status" | "criteria">,
): {
  requirementId: string;
  caption: string;
  criteria: string;
  evidencePacket: WorkbookEvidencePacket;
  status: WorkbookOriginalStatus;
} {
  return {
    requirementId: original.gqaId,
    caption: original.name,
    criteria: original.criteria,
    evidencePacket: original.evidencePacket,
    status: original.status,
  };
}

/** Arithmetic extract-15, Markdown, or answer judges never cover S08.
 * Capture the generated output; a human reviews the original criterion. */
export function workbookOriginalAllowsAutoJudge(original: { family: string }): boolean {
  return original.family !== WORKBOOK_OUTPUT_FAMILY_ID;
}

/** Similar-name extract-15 / Markdown / Paris judges are not coverage. */
export function coverByArithmeticOrMarkdownJudge(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Cloudflare Sign up, weekly Continue-with-X pause, or grok-lab leftover
 * never cover S01. Isolated auth TAP evidence is required. */
export function coverByCloudflareOrWeeklyAuthPause(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Composer-focus inspect, logged-out send-hello paywall, or 3*5
 * multiline extract-15 never cover S03. Type+send TAP evidence is required. */
export function coverByComposerFocusOrSendHello(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Inspect-only model-iterate, Fast/Expert SuperGrok pricing TAP, or
 * Think harder YAML seed never cover S06. Auto prompt + routing TAP
 * evidence is required. */
export function coverByModelIterateOrPricingTap(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Leftover 3*5 extract-15 toolbar expect-set, dest-end toolbar-existing,
 * More extras-forbid, clipboard-denied share toast, or more-header
 * chrome-only never cover S07. Toolbar TAP, chip TAP, autoscroll
 * sequence, and share TAP evidence is required. */
export function coverByToolbarExpectSetOrShareToast(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** YAML typeahead/sources/code/news unrecorded, leftover 3*5 extract-15
 * (Search the web absent), inspect-only Expert sheet / model-iterate,
 * or plugins overlay (do not add Gmail/Drive) never cover S09.
 * Sources-rail TAP + sequence evidence is required. Heavy GQA-031/057
 * stay S10. */
export function coverByUnrecordedSourcesNewsOrPlugins(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** YAML sources/news unrecorded, leftover 3*5 extract-15 (Search the
 * web absent), inspect-only Expert or Heavy sheet / model-iterate,
 * plugins overlay (do not add Gmail/Drive), finance dest-end (do not
 * tap Add), orig 50 Heavy 5-image, or S09 single-agent Slack/news
 * never cover S10. Heavy send TAP + Agents-working sequence evidence
 * is required. */
export function coverByUnrecordedHeavyOrFinanceDestEnd(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Imagine dest-end, iOS Imagine Unbound, logged-out Imagine judged
 * (do not require generated images), UNRECORDED orig 50 Heavy 5-image,
 * leftover 3*5 extract-15, S02 Imagine from menu, S10 Heavy agents,
 * or GQA-008 Create Videos preset never cover S11. Generate TAP +
 * download / Make Video / Heavy 5-image edit / Draw a puppy / Draw a
 * hat TAP evidence is required. */
export function coverByImagineDestEndOrUnrecordedHeavyImage(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Imagine dest-end, iOS Imagine Unbound, logged-out Imagine judged,
 * leftover 3*5 extract-15, S11 image gen, S02 Imagine from menu,
 * S10 Heavy, GQA-008 Create Videos, or history Command Menu search
 * never cover S12. Find-3-images TAP + similar follow-up TAP
 * evidence is required. */
export function coverByImagineDestEndOrHistorySearch(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Dest-end open-conversation (no new prompt), older-chat
 * compile-blocked, Command Menu search / Android Search dest-end,
 * history-collapse Hide Conversation Previews, leftover 3*5
 * extract-15, S12 Image search, or draft delete-wrong-chat never
 * cover S13. Open TAP + send, History expand TAP, keyword TAP +
 * clear, and delete TAP + restart evidence is required. */
export function coverByHistoryDestEndOrCommandMenuSearch(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Settings dest-end inventory, inspect-only Language Selector (do not
 * tap a language), SuperGrok home banner / hide-upsell inspect (do not
 * tap Hide or Upgrade), logged-out Light/Dark/System, or iOS App
 * Language OS handoff never cover S14 App Language mutate or SuperGrok
 * row. TAP + persist / TAP SuperGrok view evidence is required. GQA-040
 * stays the RC-23 dest-end view. Do not tap App Language in default
 * capture. Do not tap Upgrade / Try now / Dismiss / Sign Out. */
export function coverBySettingsDestEndOrLanguageInspect(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

/** Paperclip dest-end, 19z5.15/19z5.19 Upload a file compiles without
 * YAML, iOS Files-app compile-block (SHA 9b65f1b2f), logged-out upload
 * chip, signed-in dest-end sample.pdf chip, or android-primitives
 * Files dump never cover S04 GQA-053. Upload TAP + analysis send TAP
 * + generated analysis (not a generic stub) evidence is required.
 * GQA-004 stays the RC-23 dest-end attach menu. Orig 5 File
 * Connectors stays excluded. Similar upload names do not cover. */
export function coverByUploadCompileOrFilesAppBlock(
  original: Pick<WorkbookOriginal, "id" | "family">,
): boolean {
  void original;
  return false;
}

export type WorkbookReviewedBinding = {
  kind: "reviewed";
  appMapId: string;
  testId: string;
  reviewedAt: string;
  note: string;
  slotId?: string;
  checkpointId?: string;
  platform?: WorkbookRc23Platform;
};

export type WorkbookExclusion = {
  kind: WorkbookExclusionKind;
  authorizedBy: "workbook";
  reason: string;
};

export type WorkbookConflict = {
  id: string;
  originalIds: readonly number[];
  relatedOriginalIds?: readonly number[];
  status: "unresolved";
  summary: string;
  sources: readonly string[];
};

export type WorkbookOriginal = {
  id: number;
  gqaId: string;
  name: string;
  family: string;
  mergeMapRow: string;
  criteria: string;
  intent: string;
  evidencePacket: WorkbookEvidencePacket;
  queue: WorkbookQueue;
  suggestedExecutionQueue: ExecutionQueue;
  gates: readonly string[];
  status: WorkbookOriginalStatus;
  exclusion?: WorkbookExclusion;
  bindings: readonly WorkbookReviewedBinding[];
  /** Capture-view may leftover-skip dest chrome only for GQA-004/040.
   * Omitted dest-end stays test-action. */
  requirementAction?: RequirementActionKind;
  /** Explicit before/after, receipt, or sequence pieces. Presence is not coverage. */
  evidenceNeeded?: readonly WorkbookEvidenceNeededItem[];
};

export type WorkbookFamily = {
  id: string;
  name: string;
  active: boolean;
  queue: WorkbookQueue;
  originalIds: readonly number[];
  suiteRow: string;
};

export type WorkbookNotCoveragePack = {
  packId: string;
  testIds: readonly string[];
  note: string;
};

export type WorkbookCoverageManifest = {
  schemaVersion: typeof WORKBOOK_COVERAGE_SCHEMA_VERSION;
  id: string;
  revision: number;
  reviewedAt: string;
  source: {
    workbook: string;
    sha256: string;
    originals: string;
    families: string;
    exclusions: string;
  };
  counts: {
    originals: number;
    families: number;
    excludedFamilies: readonly string[];
    activeFamilies: number;
    globallyExcludedOriginals: number;
    remainingBeforePlatformTierGates: number;
  };
  conflicts: readonly WorkbookConflict[];
  notWorkbookPacks: readonly WorkbookNotCoveragePack[];
  families: readonly WorkbookFamily[];
  originals: readonly WorkbookOriginal[];
};

export type WorkbookCatalogTest = {
  id: string;
  name: string;
  appMapId?: string;
};

export type WorkbookNameCollision = {
  originalId: number;
  testId: string;
  testName: string;
  reason: "similar-name-does-not-cover";
};

export type WorkbookCoverageReport = {
  originalCount: number;
  familyCount: number;
  activeFamilyCount: number;
  excludedFamilyIds: readonly string[];
  globallyExcludedCount: number;
  remainingBeforePlatformTierGates: number;
  boundCount: number;
  unboundCount: number;
  excludedCount: number;
  coveredOriginalIds: readonly number[];
  unboundOriginalIds: readonly number[];
  excludedOriginalIds: readonly number[];
  conflicts: readonly WorkbookConflict[];
  nameCollisions: readonly WorkbookNameCollision[];
  packCoverage: readonly {
    packId: string;
    testCount: number;
    coveredOriginalIds: readonly number[];
  }[];
  errors: readonly string[];
};

const PACKET = new Set<string>(WORKBOOK_EVIDENCE_PACKETS);
const STATUS = new Set<string>(WORKBOOK_ORIGINAL_STATUSES);
const QUEUE = new Set<string>(WORKBOOK_QUEUES);
const SUGGESTED_QUEUE = new Set<string>(EXECUTION_QUEUES);
const SURVIVAL_PACKET = new Set<string>(WORKBOOK_SURVIVAL_PACKETS);
const EXCLUSION_KIND = new Set<string>(WORKBOOK_EXCLUSION_KINDS);

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function num(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

function strArr(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(`${label} must be a string array`);
  }
  return value.map((item) => item.trim());
}

function intArr(value: unknown, label: string): number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "number" || !Number.isInteger(item))
  ) {
    throw new Error(`${label} must be an integer array`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBinding(raw: unknown, label: string): WorkbookReviewedBinding {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  if (raw.kind !== "reviewed") {
    throw new Error(`${label}.kind must be "reviewed" — similar names are not bindings`);
  }
  const platformRaw = raw.platform;
  let platform: WorkbookRc23Platform | undefined;
  if (platformRaw !== undefined) {
    if (typeof platformRaw !== "string" || !RC23_PLATFORM.has(platformRaw)) {
      throw new Error(`${label}.platform must be web, android, or ios`);
    }
    platform = platformRaw as WorkbookRc23Platform;
  }
  return {
    kind: "reviewed",
    appMapId: text(raw.appMapId, `${label}.appMapId`),
    testId: text(raw.testId, `${label}.testId`),
    reviewedAt: text(raw.reviewedAt, `${label}.reviewedAt`),
    note: text(raw.note, `${label}.note`),
    ...(raw.slotId === undefined ? {} : { slotId: text(raw.slotId, `${label}.slotId`) }),
    ...(raw.checkpointId === undefined
      ? {}
      : { checkpointId: text(raw.checkpointId, `${label}.checkpointId`) }),
    ...(platform ? { platform } : {}),
  };
}

function parseExclusion(raw: unknown, label: string): WorkbookExclusion {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  if (typeof raw.kind !== "string" || !EXCLUSION_KIND.has(raw.kind)) {
    throw new Error(`${label}.kind is not a workbook exclusion kind`);
  }
  if (raw.authorizedBy !== "workbook") {
    throw new Error(`${label}.authorizedBy must be "workbook"`);
  }
  return {
    kind: raw.kind as WorkbookExclusionKind,
    authorizedBy: "workbook",
    reason: text(raw.reason, `${label}.reason`),
  };
}

const EVIDENCE_NEEDED_KIND = new Set<string>(WORKBOOK_EVIDENCE_NEEDED_KINDS);

function parseEvidenceNeededItem(raw: unknown, label: string): WorkbookEvidenceNeededItem {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  const kindRaw = text(raw.kind, `${label}.kind`);
  if (!EVIDENCE_NEEDED_KIND.has(kindRaw)) {
    throw new Error(`${label}.kind must be before, after, receipt, sequence, view, or restart`);
  }
  return {
    kind: kindRaw as WorkbookEvidenceNeededKind,
    id: text(raw.id, `${label}.id`),
    note: text(raw.note, `${label}.note`),
  };
}

function parseEvidenceNeeded(raw: unknown, label: string): WorkbookEvidenceNeededItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  return raw.map((item, index) => parseEvidenceNeededItem(item, `${label}[${index}]`));
}

function parseOriginal(raw: unknown, label: string): WorkbookOriginal {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  const id = num(raw.id, `${label}.id`);
  const statusRaw = text(raw.status, `${label}.status`);
  if (!STATUS.has(statusRaw)) throw new Error(`${label}.status is invalid`);
  const packet = text(raw.evidencePacket, `${label}.evidencePacket`);
  if (!PACKET.has(packet)) throw new Error(`${label}.evidencePacket is invalid`);
  const queue = text(raw.queue, `${label}.queue`);
  if (!QUEUE.has(queue)) throw new Error(`${label}.queue is invalid`);
  const suggested = text(raw.suggestedExecutionQueue, `${label}.suggestedExecutionQueue`);
  if (!SUGGESTED_QUEUE.has(suggested)) {
    throw new Error(
      `${label}.suggestedExecutionQueue must be fast-ui, live-output, or stateful-survival`,
    );
  }
  const bindingsRaw = Array.isArray(raw.bindings) ? raw.bindings : [];
  const bindings = bindingsRaw.map((item, index) =>
    parseBinding(item, `${label}.bindings[${index}]`),
  );
  const status = statusRaw as WorkbookOriginalStatus;
  const exclusion =
    raw.exclusion === undefined ? undefined : parseExclusion(raw.exclusion, `${label}.exclusion`);
  if (status === "excluded") {
    if (!exclusion) throw new Error(`${label} excluded original needs exclusion`);
    if (bindings.length > 0) {
      throw new Error(`${label} excluded original cannot carry reviewed bindings`);
    }
  }
  if (status !== "excluded" && exclusion) {
    throw new Error(`${label} non-excluded original cannot carry exclusion`);
  }
  if (status === "bound" && bindings.length === 0) {
    throw new Error(`${label} bound original needs at least one reviewed binding`);
  }
  if (status === "unbound" && bindings.length > 0) {
    throw new Error(`${label} unbound original cannot carry bindings`);
  }
  const evidenceNeeded =
    raw.evidenceNeeded === undefined
      ? undefined
      : parseEvidenceNeeded(raw.evidenceNeeded, `${label}.evidenceNeeded`);
  let requirementAction: RequirementActionKind | undefined;
  if (raw.requirementAction !== undefined) {
    if (
      typeof raw.requirementAction !== "string" ||
      !isRequirementActionKind(raw.requirementAction)
    ) {
      throw new Error(`${label}.requirementAction must be capture-view or test-action`);
    }
    requirementAction = raw.requirementAction;
  }
  return {
    id,
    gqaId: text(raw.gqaId, `${label}.gqaId`),
    name: text(raw.name, `${label}.name`),
    family: text(raw.family, `${label}.family`),
    mergeMapRow: text(raw.mergeMapRow, `${label}.mergeMapRow`),
    criteria: text(raw.criteria, `${label}.criteria`),
    intent: text(raw.intent, `${label}.intent`),
    evidencePacket: packet as WorkbookEvidencePacket,
    queue: queue as WorkbookQueue,
    suggestedExecutionQueue: suggested as ExecutionQueue,
    gates: strArr(raw.gates, `${label}.gates`),
    status,
    ...(exclusion ? { exclusion } : {}),
    bindings,
    ...(requirementAction ? { requirementAction } : {}),
    ...(evidenceNeeded ? { evidenceNeeded } : {}),
  };
}

function parseFamily(raw: unknown, label: string): WorkbookFamily {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  const queue = text(raw.queue, `${label}.queue`);
  if (!QUEUE.has(queue)) throw new Error(`${label}.queue is invalid`);
  if (typeof raw.active !== "boolean") throw new Error(`${label}.active must be boolean`);
  return {
    id: text(raw.id, `${label}.id`),
    name: text(raw.name, `${label}.name`),
    active: raw.active,
    queue: queue as WorkbookQueue,
    originalIds: intArr(raw.originalIds, `${label}.originalIds`),
    suiteRow: text(raw.suiteRow, `${label}.suiteRow`),
  };
}

function parseConflict(raw: unknown, label: string): WorkbookConflict {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  if (raw.status !== "unresolved")
    throw new Error(`${label}.status must stay unresolved until the owner decides`);
  return {
    id: text(raw.id, `${label}.id`),
    originalIds: intArr(raw.originalIds, `${label}.originalIds`),
    ...(raw.relatedOriginalIds === undefined
      ? {}
      : { relatedOriginalIds: intArr(raw.relatedOriginalIds, `${label}.relatedOriginalIds`) }),
    status: "unresolved",
    summary: text(raw.summary, `${label}.summary`),
    sources: strArr(raw.sources, `${label}.sources`),
  };
}

function parsePack(raw: unknown, label: string): WorkbookNotCoveragePack {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  return {
    packId: text(raw.packId, `${label}.packId`),
    testIds: strArr(raw.testIds, `${label}.testIds`),
    note: text(raw.note, `${label}.note`),
  };
}

export function parseWorkbookCoverageManifest(
  raw: unknown,
  options?: { requireCompleteWorkbook?: boolean },
): WorkbookCoverageManifest {
  if (!isRecord(raw)) throw new Error("workbook manifest must be an object");
  if (raw.schemaVersion !== WORKBOOK_COVERAGE_SCHEMA_VERSION) {
    throw new Error("workbook manifest schemaVersion must be 1");
  }
  if (!isRecord(raw.source)) throw new Error("source must be an object");
  if (!isRecord(raw.counts)) throw new Error("counts must be an object");
  const families = (Array.isArray(raw.families) ? raw.families : []).map((item, index) =>
    parseFamily(item, `families[${index}]`),
  );
  const originals = (Array.isArray(raw.originals) ? raw.originals : []).map((item, index) =>
    parseOriginal(item, `originals[${index}]`),
  );
  const conflicts = (Array.isArray(raw.conflicts) ? raw.conflicts : []).map((item, index) =>
    parseConflict(item, `conflicts[${index}]`),
  );
  const notWorkbookPacks = (Array.isArray(raw.notWorkbookPacks) ? raw.notWorkbookPacks : []).map(
    (item, index) => parsePack(item, `notWorkbookPacks[${index}]`),
  );
  const complete = options?.requireCompleteWorkbook !== false;
  if (complete) {
    if (originals.length !== WORKBOOK_ORIGINAL_COUNT) {
      throw new Error(`expected ${WORKBOOK_ORIGINAL_COUNT} originals, got ${originals.length}`);
    }
    if (families.length !== WORKBOOK_FAMILY_COUNT) {
      throw new Error(`expected ${WORKBOOK_FAMILY_COUNT} families, got ${families.length}`);
    }
    const ids = originals.map((item) => item.id);
    for (let expected = 1; expected <= WORKBOOK_ORIGINAL_COUNT; expected += 1) {
      if (!ids.includes(expected)) throw new Error(`missing original ${expected}`);
    }
    const gqa = new Set(originals.map((item) => item.gqaId));
    if (gqa.size !== WORKBOOK_ORIGINAL_COUNT) throw new Error("GQA ids must be unique");
    for (const original of originals) {
      const expected = `GQA-${String(original.id).padStart(3, "0")}`;
      if (original.gqaId !== expected) {
        throw new Error(`original ${original.id} gqaId must be ${expected}`);
      }
      const mergeRow = 3 + original.id;
      if (original.mergeMapRow !== `'Merge map'!A${mergeRow}:G${mergeRow}`) {
        throw new Error(`original ${original.id} mergeMapRow must keep Merge map row ${mergeRow}`);
      }
    }
    const activeFamilies = families.filter((family) => family.active);
    if (activeFamilies.length !== WORKBOOK_ACTIVE_FAMILY_COUNT) {
      throw new Error(
        `active families must be ${WORKBOOK_ACTIVE_FAMILY_COUNT}, not ${activeFamilies.length}`,
      );
    }
    const excludedFamilyIds = families
      .filter((family) => !family.active)
      .map((family) => family.id);
    if (excludedFamilyIds.join() !== WORKBOOK_EXCLUDED_FAMILY_IDS.join()) {
      throw new Error("excluded families must be S15 and S17");
    }
    const familyIds = new Set(originals.map((item) => item.family));
    for (const family of families) {
      if (!familyIds.has(family.id) && family.originalIds.length === 0) {
        throw new Error(`family ${family.id} has no originals`);
      }
      const members = originals.filter((item) => item.family === family.id).map((item) => item.id);
      if (members.join() !== family.originalIds.join()) {
        throw new Error(`family ${family.id} originalIds must match original.family`);
      }
    }
    const excluded = originals.filter((item) => item.status === "excluded").map((item) => item.id);
    if (excluded.join() !== WORKBOOK_GLOBAL_EXCLUSION_IDS.join()) {
      throw new Error("global exclusions must be originals 5, 18, 19, 20, 42");
    }
    const remaining = originals.filter((item) => item.status !== "excluded").length;
    if (remaining !== WORKBOOK_ORIGINAL_COUNT - WORKBOOK_GLOBAL_EXCLUSION_IDS.length) {
      throw new Error("remaining-before-gates must be 53");
    }
    if (num(raw.counts.originals, "counts.originals") !== WORKBOOK_ORIGINAL_COUNT) {
      throw new Error("counts.originals must be 58");
    }
    if (num(raw.counts.families, "counts.families") !== WORKBOOK_FAMILY_COUNT) {
      throw new Error("counts.families must be 17");
    }
    if (num(raw.counts.activeFamilies, "counts.activeFamilies") !== WORKBOOK_ACTIVE_FAMILY_COUNT) {
      throw new Error("counts.activeFamilies must be 15, not 16");
    }
    if (num(raw.counts.globallyExcludedOriginals, "counts.globallyExcludedOriginals") !== 5) {
      throw new Error("counts.globallyExcludedOriginals must be 5");
    }
    if (
      num(
        raw.counts.remainingBeforePlatformTierGates,
        "counts.remainingBeforePlatformTierGates",
      ) !== 53
    ) {
      throw new Error("counts.remainingBeforePlatformTierGates must be 53");
    }
    for (const original of originals) {
      const policy = workbookEvidencePolicyError(original);
      if (policy) throw new Error(policy);
    }
    const bindingError = workbookRc23BindingError(originals);
    if (bindingError) throw new Error(bindingError);
  }
  return {
    schemaVersion: WORKBOOK_COVERAGE_SCHEMA_VERSION,
    id: text(raw.id, "id"),
    revision: num(raw.revision, "revision"),
    reviewedAt: text(raw.reviewedAt, "reviewedAt"),
    source: {
      workbook: text(raw.source.workbook, "source.workbook"),
      sha256: text(raw.source.sha256, "source.sha256"),
      originals: text(raw.source.originals, "source.originals"),
      families: text(raw.source.families, "source.families"),
      exclusions: text(raw.source.exclusions, "source.exclusions"),
    },
    counts: {
      originals: num(raw.counts.originals, "counts.originals"),
      families: num(raw.counts.families, "counts.families"),
      excludedFamilies: strArr(raw.counts.excludedFamilies, "counts.excludedFamilies"),
      activeFamilies: num(raw.counts.activeFamilies, "counts.activeFamilies"),
      globallyExcludedOriginals: num(
        raw.counts.globallyExcludedOriginals,
        "counts.globallyExcludedOriginals",
      ),
      remainingBeforePlatformTierGates: num(
        raw.counts.remainingBeforePlatformTierGates,
        "counts.remainingBeforePlatformTierGates",
      ),
    },
    conflicts,
    notWorkbookPacks,
    families,
    originals,
  };
}

export function originalIsCovered(original: WorkbookOriginal): boolean {
  return (
    original.status === "bound" && original.bindings.some((binding) => binding.kind === "reviewed")
  );
}

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
export function suggestedExecutionQueueForOriginal(input: {
  id: number;
  family: string;
  evidencePacket: WorkbookEvidencePacket;
}): ExecutionQueue {
  if (
    input.family === WORKBOOK_SURVIVAL_FAMILY_ID ||
    input.family === WORKBOOK_AUTH_FAMILY_ID ||
    input.family === "S15"
  ) {
    return "stateful-survival";
  }
  if (input.evidencePacket === "persistence" || input.id === 21) return "stateful-survival";
  if (
    input.evidencePacket === "generated-output" ||
    input.evidencePacket === "screenshot-receipt" ||
    input.evidencePacket === "sequence"
  ) {
    return "live-output";
  }
  if (
    input.family === WORKBOOK_AUTO_FAMILY_ID ||
    input.family === WORKBOOK_CHROME_FAMILY_ID ||
    input.family === WORKBOOK_TOOLS_FAMILY_ID ||
    input.family === WORKBOOK_HEAVY_FAMILY_ID ||
    input.family === WORKBOOK_IMAGE_FAMILY_ID ||
    input.family === WORKBOOK_IMAGE_SEARCH_FAMILY_ID ||
    input.family === "S17"
  )
    return "live-output";
  return "fast-ui";
}

export function workbookRc23BindingError(
  originals: readonly Pick<WorkbookOriginal, "id" | "status" | "evidencePacket" | "bindings">[],
): string | undefined {
  const expected = rc23WorkbookBoundOriginalIds();
  const boundIds = originals
    .filter((item) => item.status === "bound")
    .map((item) => item.id)
    .sort((left, right) => left - right);
  if (boundIds.join() !== expected.join()) {
    return `bound original ids must be ${expected.join(", ")} (RC-23 dest-end view packets), not ${boundIds.join(", ") || "none"}`;
  }
  const forbidden = new Set(rc23WorkbookNonBindingOriginalIds());
  for (const original of originals) {
    if (original.status !== "bound") continue;
    if (forbidden.has(original.id)) {
      return `original ${original.id} cannot bind an RC-23 dest-end that does not execute its causal action`;
    }
    const row = RC23_WORKBOOK_DEST_END_BINDINGS.find((item) => item.originalId === original.id);
    if (!row) return `original ${original.id} has no RC-23 dest-end binding`;
    if (original.evidencePacket !== row.evidencePacket) {
      return `original ${original.id} packet must stay ${row.evidencePacket} for the dest-end binding`;
    }
    const platforms = new Set(row.platforms);
    if (original.bindings.length !== row.platforms.length) {
      return `original ${original.id} needs one dest-end binding per platform`;
    }
    for (const binding of original.bindings) {
      if (!binding.slotId || !binding.checkpointId || !binding.platform) {
        return `original ${original.id} obligations must be plannedSlots identities, not captions`;
      }
      if (binding.checkpointId !== row.checkpointId) {
        return `original ${original.id} cannot bind checkpoint ${binding.checkpointId}`;
      }
      if (!platforms.has(binding.platform)) {
        return `original ${original.id} cannot bind platform ${binding.platform}`;
      }
      if (!rc23DestEndSatisfiesOriginal(binding.checkpointId, original.id, binding.platform)) {
        return `original ${original.id} dest-end does not execute that causal action`;
      }
      const expectedSlot = rc23WorkbookBindingSlotId(binding.checkpointId, binding.platform);
      if (binding.slotId !== expectedSlot) {
        return `original ${original.id} slotId must be ${expectedSlot}, not a caption`;
      }
      if (binding.appMapId !== WORKBOOK_RC23_APP_MAP_IDS[binding.platform]) {
        return `original ${original.id} appMapId must match ${binding.platform}`;
      }
    }
  }
  return undefined;
}

export function workbookEvidencePolicyError(
  original: Pick<
    WorkbookOriginal,
    | "id"
    | "family"
    | "evidencePacket"
    | "suggestedExecutionQueue"
    | "status"
    | "exclusion"
    | "criteria"
    | "requirementAction"
    | "evidenceNeeded"
  >,
): string | undefined {
  const label = `original ${original.id}`;
  if (!original.criteria.trim())
    return `${label} must keep criteria text even when not auto-asserted`;
  if (original.status === "excluded" && !original.exclusion) {
    return `${label} excluded original needs packet+exclusion`;
  }
  if (original.family === WORKBOOK_SURVIVAL_FAMILY_ID) {
    if (!SURVIVAL_PACKET.has(original.evidencePacket)) {
      return `${label} S16 cannot be ${WORKBOOK_EVIDENCE_PACKET_LABELS[original.evidencePacket]} Fast UI`;
    }
    if (original.suggestedExecutionQueue !== "stateful-survival") {
      return `${label} S16 cannot be single-view Fast UI`;
    }
  }
  if (
    original.id === WORKBOOK_DOWNLOAD_ORIGINAL_ID &&
    original.evidencePacket !== "screenshot-receipt"
  ) {
    return `${label} S11 download needs screenshot+receipt`;
  }
  if (
    original.family === WORKBOOK_OUTPUT_FAMILY_ID &&
    original.evidencePacket !== "generated-output"
  ) {
    return original.id === WORKBOOK_MATH_ORIGINAL_ID
      ? `${label} S08 math stays generated-output for human review`
      : `${label} S08 stays generated-output for human review`;
  }
  if (
    original.evidencePacket === "generated-output" &&
    original.suggestedExecutionQueue === "fast-ui"
  ) {
    return `${label} generated-output cannot suggest Fast UI`;
  }
  if (
    original.evidencePacket === "persistence" &&
    original.suggestedExecutionQueue !== "stateful-survival"
  ) {
    return `${label} before/restart/after must suggest stateful-survival`;
  }
  const expected = suggestedExecutionQueueForOriginal(original);
  if (original.suggestedExecutionQueue !== expected) {
    return `${label} suggestedExecutionQueue must be ${expected} for packet ${original.evidencePacket}`;
  }
  const needed = workbookEvidenceNeededError(original);
  if (needed) return needed;
  return undefined;
}

export function workbookEvidenceNeededError(
  original: Pick<
    WorkbookOriginal,
    "id" | "family" | "evidencePacket" | "requirementAction" | "evidenceNeeded"
  >,
): string | undefined {
  const label = `original ${original.id}`;
  if (original.family === WORKBOOK_SHELL_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S02 must be test-action — leftover dest skip is not open+close, logo from destinations, or New Chat`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S02 needs explicit evidence-needed (before/after, receipt, sequence)`;
    }
  }
  if (original.family === WORKBOOK_MODELS_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S05 must be test-action — leftover Fast-checked / inspect-only sheet is not Switch model or presets`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S05 needs explicit evidence-needed (before/after, receipt)`;
    }
  }
  if (original.family === WORKBOOK_OUTPUT_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S08 must be test-action — leftover conversation / extract-contains-15 is not generated-output coverage`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S08 needs explicit evidence-needed (generated output at a declared phase)`;
    }
    const outputKinds = new Set(original.evidenceNeeded.map((item) => item.kind));
    if (!outputKinds.has("receipt")) {
      return `${label} S08 needs a send TAP receipt — leftover 3*5 thread is not this original`;
    }
    if (!outputKinds.has("after")) {
      return `${label} S08 generated-output needs after evidence — no arithmetic/Markdown judge`;
    }
  }
  if (original.family === WORKBOOK_AUTH_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S01 must be test-action — leftover Cloudflare / weekly pause / grok-lab signed-in is not Sign Out, Continue with X, or Sign Up`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S01 needs explicit evidence-needed (isolated auth before/after, receipt, sequence)`;
    }
  }
  if (original.family === WORKBOOK_COMPOSER_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S03 must be test-action — leftover composer-focus inspect / send-hello paywall / multiline extract-15 is not type+send, expand, or typeahead persistence`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S03 needs explicit evidence-needed (send TAP, expanded composer view, typeahead persistence)`;
    }
  }
  if (original.family === WORKBOOK_AUTO_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S06 must be test-action — leftover Fast-checked / inspect-only model sheet / SuperGrok pricing TAP is not Auto Fast/Expert routing`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S06 needs explicit evidence-needed (Auto prompt TAP, Think harder / Quick answer routing)`;
    }
  }
  if (original.family === WORKBOOK_CHROME_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S07 must be test-action — leftover 3*5 toolbar expect-set / dest-end toolbar-existing / share clipboard-denied is not Response toolbar, follow-up chips, autoscroll, or Share`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S07 needs explicit evidence-needed (toolbar TAP, chip TAP, autoscroll sequence, share receipt)`;
    }
  }
  if (original.family === WORKBOOK_TOOLS_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S09 must be test-action — leftover 3*5 extract-15 / YAML sources/news unrecorded / plugins overlay / inspect-only Expert sheet is not Sources rail, Slack tools, or Latest news`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S09 needs explicit evidence-needed (sources-rail TAP, thinking-trace sequence, Latest news TAP)`;
    }
  }
  if (original.family === WORKBOOK_HEAVY_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S10 must be test-action — leftover 3*5 extract-15 / YAML sources/news unrecorded / inspect-only Expert or Heavy sheet / plugins overlay / finance dest-end / S09 single-agent Slack/news is not Heavy agents, Heavy Latest news, or Heavy investment`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S10 needs explicit evidence-needed (Heavy tool+web TAP, Agents-working sequence, Heavy Latest news TAP, Heavy investment TAP)`;
    }
  }
  if (original.family === WORKBOOK_IMAGE_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S11 must be test-action — leftover Imagine dest-end / iOS Imagine Unbound / UNRECORDED Heavy 5-image / logged-out Imagine judged is not image gen download, Make Video, five-image edit, Draw a puppy, or Draw a hat`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S11 needs explicit evidence-needed (generate TAP, download TAP, Make Video TAP, Heavy/Expert 5-image edit TAP)`;
    }
  }
  if (original.family === WORKBOOK_IMAGE_SEARCH_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S12 must be test-action — leftover Imagine dest-end / iOS Imagine Unbound / logged-out Imagine judged / leftover 3*5 / history Command Menu search / S11 image gen is not Image search`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S12 needs explicit evidence-needed (find-3-images TAP, similar follow-up TAP, similar-to-object TAP)`;
    }
  }
  if (original.family === WORKBOOK_HISTORY_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S13 must be test-action — leftover dest-end open-conversation / Command Menu search / history-collapse / draft delete is not open older conversation, History expand, search history, or delete persistence`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S13 needs explicit evidence-needed (open older conversation TAP + send, History expand TAP, search keyword TAP + clear, delete TAP + restart)`;
    }
  }
  if (original.id === 41 || original.id === 43) {
    if (original.requirementAction !== "test-action") {
      return `${label} S14 must be test-action — leftover Settings dest-end / inspect-only Language Selector / SuperGrok banner is not App Language mutate or SuperGrok row`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S14 needs explicit evidence-needed (App Language TAP + persist, SuperGrok row TAP + view)`;
    }
  }
  if (original.id === WORKBOOK_UPLOAD_ANALYSIS_ORIGINAL_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S04 GQA-053 must be test-action — leftover attach dest-end / compile-without-YAML / iOS Files-app compile-block / logged-out upload chip is not upload analysis`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S04 GQA-053 needs explicit evidence-needed (upload TAP + analysis send TAP + generated analysis)`;
    }
  }
  if (original.id === 7) {
    const switchKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!switchKinds.has(required)) {
        return `${label} GQA-007 causal TAP must change selection — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 44) {
    const signOutKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!signOutKinds.has(required)) {
        return `${label} GQA-044 Sign Out TAP must execute — leftover logged-out home is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 45 || original.id === 46) {
    const xKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!xKinds.has("receipt")) {
      return `${label} GQA-045/046 needs a Continue with X TAP receipt — weekly pause is not this original`;
    }
    if (!xKinds.has("sequence")) {
      return `${label} GQA-045/046 needs sequence evidence — one leftover sheet is not both X variants`;
    }
  }
  if (original.id === 1) {
    const sendKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!sendKinds.has(required)) {
        return `${label} GQA-001 send TAP must execute — leftover composer-focus / send-hello paywall is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 2) {
    const expandKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!expandKinds.has("receipt")) {
      return `${label} GQA-002 needs a multiline type TAP receipt — leftover composer-focus inspect is not this original`;
    }
  }
  if (original.id === 6) {
    const typeaheadKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!typeaheadKinds.has("receipt")) {
      return `${label} GQA-006 needs a typeahead select TAP receipt — leftover composer-focus inspect is not this original`;
    }
  }
  if (original.id === 28) {
    const autoFastKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!autoFastKinds.has(required)) {
        return `${label} GQA-028 Auto Fast routing TAP must execute — leftover Fast-checked / model-iterate / SuperGrok pricing is not this original — needs ${required} evidence`;
      }
    }
    const autoFastReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (autoFastReceipts.length < 2) {
      return `${label} GQA-028 needs send TAP and Think harder TAP receipts — leftover Fast-checked / model-iterate is not this original`;
    }
  }
  if (original.id === 29) {
    const autoExpertKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!autoExpertKinds.has(required)) {
        return `${label} GQA-029 Auto Expert routing TAP must execute — leftover Fast-checked / model-iterate / SuperGrok pricing is not this original — needs ${required} evidence`;
      }
    }
    const autoExpertReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (autoExpertReceipts.length < 2) {
      return `${label} GQA-029 needs send TAP and Quick answer TAP receipts — leftover Fast-checked / model-iterate is not this original`;
    }
  }
  if (original.id === 9) {
    const toolbarKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!toolbarKinds.has("receipt")) {
      return `${label} GQA-009 TAP More must execute — leftover 3*5 toolbar expect-set / dest-end toolbar-existing is not this original`;
    }
  }
  if (original.id === 10) {
    const chipKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!chipKinds.has(required)) {
        return `${label} GQA-010 follow-up chip TAP must execute — leftover 3*5 toolbar dest-end is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 12) {
    const autoscrollKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!autoscrollKinds.has("sequence")) {
      return `${label} GQA-012 needs sequence evidence — leftover 3*5 extract-15 / autoscroll-unmeasured is not this original`;
    }
  }
  if (original.id === 13) {
    const shareKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!shareKinds.has("receipt")) {
      return `${label} GQA-013 share TAP must execute — leftover 3*5 share toast / clipboard-denied / more-header chrome-only is not this original`;
    }
  }
  if (original.id === 11) {
    const sourcesKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!sourcesKinds.has("sequence")) {
      return `${label} GQA-011 needs sequence evidence — leftover 3*5 extract-15 / Search the web absent / inspect-only Expert sheet is not this original`;
    }
    const sourcesReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (sourcesReceipts.length < 2) {
      return `${label} GQA-011 needs send TAP and sources TAP receipts — leftover 3*5 extract-15 / toolbar dest-end is not this original`;
    }
  }
  if (original.id === 30) {
    const slackKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!slackKinds.has("sequence")) {
      return `${label} GQA-030 needs sequence evidence — leftover plugins overlay / Heavy GQA-031 is not this original`;
    }
    const slackReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (slackReceipts.length < 2) {
      return `${label} GQA-030 needs send TAP and thinking-trace expand TAP receipts — leftover plugins overlay is not this original`;
    }
  }
  if (original.id === 56) {
    const newsKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!newsKinds.has("sequence")) {
      return `${label} GQA-056 needs sequence evidence — leftover YAML news / think-harder YAML / Heavy GQA-057 is not this original`;
    }
    const newsReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (newsReceipts.length < 2) {
      return `${label} GQA-056 needs send TAP and sources TAP receipts — leftover 3*5 extract-15 is not this original`;
    }
  }
  if (original.id === 31) {
    const heavyKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!heavyKinds.has("sequence")) {
      return `${label} GQA-031 needs sequence evidence — leftover 3*5 extract-15 / inspect-only Heavy sheet / S09 GQA-030 Slack is not this original`;
    }
    const heavyReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (heavyReceipts.length < 2) {
      return `${label} GQA-031 needs send TAP and notes TAP receipts — leftover plugins overlay / inspect-only Heavy sheet is not this original`;
    }
  }
  if (original.id === 57) {
    const heavyNewsKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!heavyNewsKinds.has("sequence")) {
      return `${label} GQA-057 needs sequence evidence — leftover YAML news / think-harder YAML / S09 GQA-056 is not this original`;
    }
    const heavyNewsReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (heavyNewsReceipts.length < 2) {
      return `${label} GQA-057 needs send TAP and sources TAP receipts — leftover 3*5 extract-15 / S09 GQA-056 is not this original`;
    }
  }
  if (original.id === 58) {
    const investmentKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!investmentKinds.has("sequence")) {
      return `${label} GQA-058 needs sequence evidence — leftover finance dest-end / orig 50 Heavy 5-image is not this original`;
    }
    if (!investmentKinds.has("receipt")) {
      return `${label} GQA-058 needs a Heavy investment send TAP receipt — leftover finance dest-end (do not tap Add) is not this original`;
    }
  }
  if (original.id === 16) {
    const downloadKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!downloadKinds.has("receipt")) {
      return `${label} GQA-016 download TAP must execute — leftover Imagine dest-end / iOS Imagine Unbound is not this original`;
    }
    const downloadReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (downloadReceipts.length < 2) {
      return `${label} GQA-016 needs generate TAP and download TAP receipts — leftover Imagine dest-end / iOS Imagine Unbound is not this original`;
    }
  }
  if (original.id === 17) {
    const videoKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!videoKinds.has("after")) {
      return `${label} GQA-017 needs after evidence — leftover Imagine dest-end / GQA-008 Create Videos preset is not this original`;
    }
    const videoReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (videoReceipts.length < 2) {
      return `${label} GQA-017 needs generate TAP and Make Video TAP receipts — leftover Imagine dest-end / GQA-008 Create Videos preset is not this original`;
    }
  }
  if (original.id === 50) {
    const fiveImageKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!fiveImageKinds.has("after")) {
      return `${label} GQA-050 needs after evidence — leftover Imagine dest-end / UNRECORDED Heavy 5-image / Fast leftover is not this original`;
    }
    const fiveImageReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (fiveImageReceipts.length < 2) {
      return `${label} GQA-050 needs generate TAP and edit TAP receipts — leftover Imagine dest-end / UNRECORDED Heavy 5-image / Fast leftover is not this original`;
    }
  }
  if (original.id === 54) {
    const puppyKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!puppyKinds.has("receipt")) {
      return `${label} GQA-054 needs a Draw a puppy send TAP receipt — leftover Imagine dest-end / iOS Imagine Unbound is not this original`;
    }
  }
  if (original.id === 55) {
    const hatKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!hatKinds.has("receipt")) {
      return `${label} GQA-055 needs a Draw a hat send TAP receipt — leftover Imagine dest-end / orig 50 Heavy 5-image is not this original`;
    }
  }
  if (original.id === 49) {
    const searchKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!searchKinds.has("sequence")) {
      return `${label} GQA-049 needs sequence evidence — leftover Imagine dest-end / history Command Menu search / leftover 3*5 is not this original`;
    }
    const searchReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (searchReceipts.length < 3) {
      return `${label} GQA-049 needs find-3-images TAP, similar TAP, and similar-to-object TAP receipts — leftover Imagine dest-end / S11 Draw a puppy / history search is not this original`;
    }
  }
  if (original.id === 21) {
    const olderKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!olderKinds.has(required)) {
        return `${label} GQA-021 open older conversation TAP must execute — leftover dest-end open-conversation / older-chat compile-blocked is not this original — needs ${required} evidence`;
      }
    }
    const olderReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (olderReceipts.length < 2) {
      return `${label} GQA-021 needs open TAP and send TAP receipts — leftover dest-end open-conversation (no new prompt) is not this original`;
    }
  }
  if (original.id === 34) {
    const expandKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!expandKinds.has("receipt")) {
      return `${label} GQA-034 History expand TAP must execute — leftover sidebar dest-end / history-collapse Hide Conversation Previews is not this original`;
    }
    if (!expandKinds.has("view")) {
      return `${label} GQA-034 needs expanded History/Conversations view — leftover sidebar dest-end is not this original`;
    }
  }
  if (original.id === 38) {
    const historySearchKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!historySearchKinds.has(required)) {
        return `${label} GQA-038 history search TAP must execute — leftover Command Menu search / Android Search dest-end is not this original — needs ${required} evidence`;
      }
    }
    const historySearchReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (historySearchReceipts.length < 2) {
      return `${label} GQA-038 needs keyword TAP and clear TAP receipts — leftover Command Menu search / Android Search dest-end is not this original`;
    }
  }
  if (original.id === 39) {
    const deleteKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "restart", "after", "receipt"] as const) {
      if (!deleteKinds.has(required)) {
        return `${label} GQA-039 delete TAP must execute — leftover draft delete-wrong-chat is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 41) {
    const languageKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "restart", "after", "receipt"] as const) {
      if (!languageKinds.has(required)) {
        return `${label} GQA-041 App Language TAP must execute — leftover Settings dest-end / inspect-only Language Selector is not this original — needs ${required} evidence`;
      }
    }
    const languageReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (languageReceipts.length < 2) {
      return `${label} GQA-041 needs open TAP and confirm TAP receipts — leftover inspect-only Language Selector (do not tap a language) is not this original`;
    }
  }
  if (original.id === 43) {
    const subKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!subKinds.has("receipt")) {
      return `${label} GQA-043 SuperGrok row TAP must execute — leftover Settings dest-end / home banner / hide-upsell inspect is not this original`;
    }
    if (!subKinds.has("view")) {
      return `${label} GQA-043 needs SuperGrok subscription/upgrade view — leftover Settings dest-end / Unlock extended capabilities pill is not this original`;
    }
  }
  if (original.id === WORKBOOK_UPLOAD_ANALYSIS_ORIGINAL_ID) {
    const uploadKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!uploadKinds.has("receipt")) {
      return `${label} GQA-053 upload TAP must execute — leftover attach dest-end / 19z5.15/19z5.19 compile-without-YAML / iOS Files-app compile-block is not this original`;
    }
    if (!uploadKinds.has("after")) {
      return `${label} GQA-053 needs after evidence — chip-only dest-end / logged-out upload chip is not this original`;
    }
    const uploadReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (uploadReceipts.length < 2) {
      return `${label} GQA-053 needs upload TAP and analysis send TAP receipts — 19z5.15/19z5.19 Upload a file compiles without YAML / iOS Files-app compile-block / dest-end sample.pdf chip is not this original`;
    }
  }
  if (!original.evidenceNeeded) return undefined;
  const kinds = new Set(original.evidenceNeeded.map((item) => item.kind));
  for (const required of requiredEvidenceNeededKinds(original.evidencePacket)) {
    if (!kinds.has(required)) {
      return `${label} ${original.evidencePacket} packet needs ${required} evidence`;
    }
  }
  if (original.requirementAction === "test-action" && destEndViewPacketMayLeftoverSkip(original)) {
    return `${label} GQA-004/040 leftover skip cannot be test-action`;
  }
  return undefined;
}

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
