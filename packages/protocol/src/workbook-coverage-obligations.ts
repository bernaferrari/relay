/** Workbook obligations; coverage remains tied to explicit evidence. */
import { captureReviewSlotId, type CaptureReviewConfiguration } from "./capture-review.js";
import { type ExecutionQueue } from "./execution-queue.js";
import { type RequirementActionKind } from "./recipes.js";

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

export function originalIsCovered(original: WorkbookOriginal): boolean {
  return (
    original.status === "bound" && original.bindings.some((binding) => binding.kind === "reviewed")
  );
}
