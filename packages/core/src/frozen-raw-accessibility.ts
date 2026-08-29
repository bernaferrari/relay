import { createHash } from "node:crypto";
import type {
  AppMapCompiledRawAccessibilitySource,
  AppMapCompiledTest,
  OfflineTestPreflightEvidenceSource,
  RawAccessibilityTreeEvidence,
} from "@relay/protocol";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import type { SnapshotNode } from "./device.js";
import type {
  OfflineTestPreflightEvidence,
  OfflineTestPreflightRawEvidenceStatus,
  OfflineTestPreflightRawSource,
} from "./offline-test-preflight-raw.js";

type ReadEvidence = (sha256: string) => Promise<Buffer | null>;

function isRawReference(value: RawAccessibilityTreeEvidence): boolean {
  return (
    typeof value.id === "string" &&
    Boolean(value.id.trim()) &&
    value.mime === "application/json" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    value.uri === `relay-evidence://${value.sha256}`
  );
}

function isSnapshotNode(value: unknown): value is SnapshotNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotNodes(value: unknown): SnapshotNode[] | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as { nodes?: unknown }).nodes)
  ) {
    return undefined;
  }
  const nodes = (value as { nodes: unknown[] }).nodes;
  return nodes.length > 0 && nodes.every(isSnapshotNode) ? (nodes as SnapshotNode[]) : undefined;
}

function compareReference(
  left: RawAccessibilityTreeEvidence,
  right: RawAccessibilityTreeEvidence,
): number {
  const leftKey = [left.uri, left.id, left.sha256].join("\u0000");
  const rightKey = [right.uri, right.id, right.sha256].join("\u0000");
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function source(
  reference: RawAccessibilityTreeEvidence,
  provenance?: Pick<AppMapCompiledRawAccessibilitySource, "variant" | "origin">,
): OfflineTestPreflightRawSource["source"] {
  return {
    reference: reference.uri,
    evidenceId: reference.id,
    sha256: reference.sha256,
    ...(provenance
      ? {
          variant: {
            id: provenance.variant.id,
            targetProfileId: provenance.variant.targetProfileId,
            targetId: provenance.variant.targetId,
            platform: provenance.variant.platform,
            ...(provenance.variant.viewport
              ? { viewport: { ...provenance.variant.viewport } }
              : {}),
            ...(provenance.variant.browserCaseProfile
              ? { browserCaseProfile: structuredClone(provenance.variant.browserCaseProfile) }
              : {}),
          },
          origin: structuredClone(provenance.origin),
        }
      : {}),
  };
}

async function readSource(
  reference: RawAccessibilityTreeEvidence,
  sourceMetadata: OfflineTestPreflightEvidenceSource,
  readEvidence: ReadEvidence,
): Promise<OfflineTestPreflightRawSource> {
  const result: OfflineTestPreflightRawSource = { source: structuredClone(sourceMetadata) };
  if (!isRawReference(reference)) return result;
  let bytes: Buffer | null;
  try {
    bytes = await readEvidence(reference.sha256);
  } catch {
    return result;
  }
  if (
    !bytes ||
    bytes.byteLength !== reference.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== reference.sha256
  ) {
    return result;
  }
  try {
    const nodes = snapshotNodes(JSON.parse(bytes.toString("utf8")));
    return nodes ? { ...result, nodes } : result;
  } catch {
    return result;
  }
}

function compareSource(
  left: AppMapCompiledRawAccessibilitySource,
  right: AppMapCompiledRawAccessibilitySource,
): number {
  const originKey = (source: AppMapCompiledRawAccessibilitySource): string =>
    source.origin.kind === "screen-variant"
      ? [
          source.origin.kind,
          source.origin.observationId ?? "",
          source.origin.capturedAt ?? "",
        ].join("\u0000")
      : [
          source.origin.kind,
          source.origin.surfaceId,
          source.origin.captureId,
          source.origin.viewportIndex,
          source.origin.capturedAt,
        ].join("\u0000");
  const key = (source: AppMapCompiledRawAccessibilitySource): string =>
    [
      source.screenId,
      source.variant.id,
      source.variant.targetProfileId,
      source.variant.targetId,
      source.variant.platform,
      originKey(source),
      source.tree.uri,
      source.tree.id,
      source.tree.sha256,
    ].join("\u0000");
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

type FrozenSource = {
  tree: RawAccessibilityTreeEvidence;
  source: OfflineTestPreflightEvidenceSource;
  observationBound: boolean;
};

/** Read the new source-aware ledger when present. Already-frozen plans using
 * the old tree-only ledger remain readable, but carry no variant provenance
 * and therefore cannot accidentally claim a new compatibility guarantee. */
function frozenSourcesByScreen(plan: AppMapCompiledTest): Record<string, FrozenSource[]> {
  if (plan.rawAccessibilitySourcesByScreenId !== undefined) {
    return Object.fromEntries(
      Object.entries(plan.rawAccessibilitySourcesByScreenId)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([screenId, sources]) => [
          screenId,
          [...sources].sort(compareSource).map((item) => ({
            tree: structuredClone(item.tree),
            source: source(item.tree, item),
            observationBound:
              item.origin.kind !== "screen-variant" ||
              (Boolean(item.origin.observationId) && item.origin.capturedAt !== undefined),
          })),
        ]),
    );
  }
  return Object.fromEntries(
    Object.entries(plan.rawAccessibilityTreesByScreenId ?? {})
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([screenId, trees]) => [
        screenId,
        [...trees].sort(compareReference).map((tree) => ({
          tree: structuredClone(tree),
          source: source(tree),
          // Legacy compiled plans do not say which normalized observation
          // their tree accompanied. They remain readable enough to produce
          // an exact, safe recapture request, never a selector pass.
          observationBound: false,
        })),
      ]),
  );
}

/**
 * Materialize only the content-addressed trees already frozen into a compiled
 * Test. This is deliberately a read-only integrity boundary: it neither looks
 * at a current Screen Variant nor asks a device for a replacement snapshot.
 *
 * A screen is usable only when every frozen source validates. Accepting the
 * surviving half of a mixed source set would turn a damaged compile artifact
 * into a misleading pass for a different locale, dialog, or scroll viewport.
 */
export async function loadFrozenRawAccessibilityEvidence(
  plan: AppMapCompiledTest,
  options: { readEvidence?: ReadEvidence } = {},
): Promise<OfflineTestPreflightEvidence> {
  const readEvidence = options.readEvidence ?? readAuthoringEvidence;
  const rawSourcesByScreenId: Record<string, OfflineTestPreflightRawSource[]> = {};
  const rawEvidenceReferencesByScreenId: Record<string, string[]> = {};
  const rawEvidenceStatusByScreenId: Record<string, OfflineTestPreflightRawEvidenceStatus> = {};
  for (const [screenId, frozenSources] of Object.entries(frozenSourcesByScreen(plan))) {
    if (!frozenSources.length) {
      rawEvidenceStatusByScreenId[screenId] = "missing";
      continue;
    }
    const sources = await Promise.all(
      frozenSources.map((item) => readSource(item.tree, item.source, readEvidence)),
    );
    rawSourcesByScreenId[screenId] = sources;
    rawEvidenceReferencesByScreenId[screenId] = [
      ...new Set(frozenSources.map((item) => item.tree.uri)),
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    if (sources.some((item) => !item.nodes?.length))
      rawEvidenceStatusByScreenId[screenId] = "unreadable";
    else if (frozenSources.some((item) => !item.observationBound)) {
      rawEvidenceStatusByScreenId[screenId] = "unbound";
    }
  }
  return {
    rawSourcesByScreenId,
    rawEvidenceReferencesByScreenId,
    rawEvidenceStatusByScreenId,
  };
}
