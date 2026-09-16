/**
 * RC-09 / RC-13 coverage compiler. Coverage is only an explicit reviewed Test
 * binding. A similarly named Test, grok-ios-daily 12/12, or an Unbound Imagine
 * row never marks an original covered. Every original has a smallest-sufficient
 * evidence packet; that is not coverage.
 */

import { EXECUTION_QUEUES, type ExecutionQueue } from "./execution-queue.js";

export const WORKBOOK_COVERAGE_SCHEMA_VERSION = 1 as const;
export const WORKBOOK_ORIGINAL_COUNT = 58;
export const WORKBOOK_FAMILY_COUNT = 17;
export const WORKBOOK_ACTIVE_FAMILY_COUNT = 15;
export const WORKBOOK_EXCLUDED_FAMILY_IDS = ["S15", "S17"] as const;
export const WORKBOOK_GLOBAL_EXCLUSION_IDS = [5, 18, 19, 20, 42] as const;
export const WORKBOOK_SURVIVAL_FAMILY_ID = "S16";
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

export type WorkbookReviewedBinding = {
  kind: "reviewed";
  appMapId: string;
  testId: string;
  reviewedAt: string;
  note: string;
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
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be a string array`);
  }
  return value.map((item) => item.trim());
}

function intArr(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isInteger(item))) {
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
  return {
    kind: "reviewed",
    appMapId: text(raw.appMapId, `${label}.appMapId`),
    testId: text(raw.testId, `${label}.testId`),
    reviewedAt: text(raw.reviewedAt, `${label}.reviewedAt`),
    note: text(raw.note, `${label}.note`),
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
    throw new Error(`${label}.suggestedExecutionQueue must be fast-ui, live-output, or stateful-survival`);
  }
  const bindingsRaw = Array.isArray(raw.bindings) ? raw.bindings : [];
  const bindings = bindingsRaw.map((item, index) => parseBinding(item, `${label}.bindings[${index}]`));
  const status = statusRaw as WorkbookOriginalStatus;
  const exclusion = raw.exclusion === undefined ? undefined : parseExclusion(raw.exclusion, `${label}.exclusion`);
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
  if (raw.status !== "unresolved") throw new Error(`${label}.status must stay unresolved until the owner decides`);
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
      throw new Error(`active families must be ${WORKBOOK_ACTIVE_FAMILY_COUNT}, not ${activeFamilies.length}`);
    }
    const excludedFamilyIds = families.filter((family) => !family.active).map((family) => family.id);
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
    if (num(raw.counts.remainingBeforePlatformTierGates, "counts.remainingBeforePlatformTierGates") !== 53) {
      throw new Error("counts.remainingBeforePlatformTierGates must be 53");
    }
    for (const original of originals) {
      const policy = workbookEvidencePolicyError(original);
      if (policy) throw new Error(policy);
    }
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
      globallyExcludedOriginals: num(raw.counts.globallyExcludedOriginals, "counts.globallyExcludedOriginals"),
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
  return original.status === "bound" && original.bindings.some((binding) => binding.kind === "reviewed");
}

function distinctiveNeedles(original: WorkbookOriginal): readonly string[] {
  const fromName = original.name
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 5);
  const extra: string[] = [];
  if (original.id === 5) extra.push("connector", "connectors");
  if (original.id === 8) extra.push("preset", "presets", "customize");
  if (original.id === 37 || original.id === 16 || original.id === 17) extra.push("imagine");
  if (original.id === 42) extra.push("dictation");
  if (original.id === 50) extra.push("heavy", "expert");
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
  const unboundOriginalIds = manifest.originals.filter((item) => item.status === "unbound").map((item) => item.id);
  const excludedOriginalIds = manifest.originals.filter((item) => item.status === "excluded").map((item) => item.id);
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
          originalIsCovered(original) && original.bindings.some((binding) => pack.testIds.includes(binding.testId)),
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
    excludedFamilyIds: manifest.families.filter((family) => !family.active).map((family) => family.id),
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
  if (input.family === WORKBOOK_SURVIVAL_FAMILY_ID || input.family === "S01" || input.family === "S15") {
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
  if (input.family === "S06" || input.family === "S07" || input.family === "S17") return "live-output";
  return "fast-ui";
}

export function workbookEvidencePolicyError(
  original: Pick<
    WorkbookOriginal,
    "id" | "family" | "evidencePacket" | "suggestedExecutionQueue" | "status" | "exclusion" | "criteria"
  >,
): string | undefined {
  const label = `original ${original.id}`;
  if (!original.criteria.trim()) return `${label} must keep criteria text even when not auto-asserted`;
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
  if (original.id === WORKBOOK_DOWNLOAD_ORIGINAL_ID && original.evidencePacket !== "screenshot-receipt") {
    return `${label} S11 download needs screenshot+receipt`;
  }
  if (original.id === WORKBOOK_MATH_ORIGINAL_ID && original.evidencePacket !== "generated-output") {
    return `${label} S08 math stays generated-output for human review`;
  }
  if (original.evidencePacket === "generated-output" && original.suggestedExecutionQueue === "fast-ui") {
    return `${label} generated-output cannot suggest Fast UI`;
  }
  if (original.evidencePacket === "persistence" && original.suggestedExecutionQueue !== "stateful-survival") {
    return `${label} before/restart/after must suggest stateful-survival`;
  }
  const expected = suggestedExecutionQueueForOriginal(original);
  if (original.suggestedExecutionQueue !== expected) {
    return `${label} suggestedExecutionQueue must be ${expected} for packet ${original.evidencePacket}`;
  }
  return undefined;
}

export function countWorkbookEvidencePackets(
  originals: readonly Pick<WorkbookOriginal, "evidencePacket">[],
): Record<WorkbookEvidencePacket, number> {
  const counts = Object.fromEntries(WORKBOOK_EVIDENCE_PACKETS.map((packet) => [packet, 0])) as Record<
    WorkbookEvidencePacket,
    number
  >;
  for (const original of originals) counts[original.evidencePacket] += 1;
  return counts;
}

export function countWorkbookSuggestedQueues(
  originals: readonly Pick<WorkbookOriginal, "suggestedExecutionQueue">[],
): Record<ExecutionQueue, number> {
  const counts = Object.fromEntries(EXECUTION_QUEUES.map((queue) => [queue, 0])) as Record<ExecutionQueue, number>;
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
