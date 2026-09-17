/** Workbook parser; coverage remains tied to explicit evidence. */
import { EXECUTION_QUEUES, type ExecutionQueue } from "./execution-queue.js";
import { isRequirementActionKind, type RequirementActionKind } from "./recipes.js";
import {
  WORKBOOK_COVERAGE_SCHEMA_VERSION,
  WORKBOOK_ORIGINAL_COUNT,
  WORKBOOK_FAMILY_COUNT,
  WORKBOOK_ACTIVE_FAMILY_COUNT,
  WORKBOOK_EXCLUDED_FAMILY_IDS,
  WORKBOOK_GLOBAL_EXCLUSION_IDS,
  WORKBOOK_EVIDENCE_PACKETS,
  type WorkbookEvidencePacket,
  WORKBOOK_RC23_PLATFORMS,
  WORKBOOK_EVIDENCE_NEEDED_KINDS,
  type WorkbookEvidenceNeededKind,
  type WorkbookEvidenceNeededItem,
  WORKBOOK_ORIGINAL_STATUSES,
  type WorkbookOriginalStatus,
  WORKBOOK_EXCLUSION_KINDS,
  type WorkbookExclusionKind,
  WORKBOOK_QUEUES,
  type WorkbookQueue,
  type WorkbookRc23Platform,
  type WorkbookReviewedBinding,
  type WorkbookExclusion,
  type WorkbookConflict,
  type WorkbookOriginal,
  type WorkbookFamily,
  type WorkbookNotCoveragePack,
  type WorkbookCoverageManifest,
} from "./workbook-coverage-obligations.js";
import {
  workbookRc23BindingError,
  workbookEvidencePolicyError,
} from "./workbook-coverage-policy.js";

const PACKET = new Set<string>(WORKBOOK_EVIDENCE_PACKETS);
const STATUS = new Set<string>(WORKBOOK_ORIGINAL_STATUSES);
const QUEUE = new Set<string>(WORKBOOK_QUEUES);
const SUGGESTED_QUEUE = new Set<string>(EXECUTION_QUEUES);
const RC23_PLATFORM = new Set<string>(WORKBOOK_RC23_PLATFORMS);
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
