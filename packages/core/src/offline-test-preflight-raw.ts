import type {
  OfflineTestPreflightEvidenceSource,
  OfflineTestPreflightRawCandidate,
  StepTarget,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { relationAnchorMatches } from "./semantic-row-activation.js";

/** Immutable identity and optional parsed nodes for one frozen raw tree. */
export type OfflineTestPreflightRawSource = {
  /** Kept even when the source cannot be read, so recapture has an exact target. */
  source: OfflineTestPreflightEvidenceSource;
  /** Omitted only when the immutable byte/hash/JSON check failed. */
  nodes?: ReadonlyArray<SnapshotNode>;
};

/** Why a frozen source cannot safely prove a current selector offline. */
export type OfflineTestPreflightRawEvidenceStatus = "missing" | "unreadable" | "unbound";

/** Device-free inputs to preflight. Canonical sources keep bytes, identity, and
 * parsed nodes together; the parallel fields remain only for legacy callers. */
export type OfflineTestPreflightEvidence = {
  rawSourcesByScreenId?: Readonly<Record<string, ReadonlyArray<OfflineTestPreflightRawSource>>>;
  rawObservationsByScreenId?: Readonly<Record<string, ReadonlyArray<ReadonlyArray<SnapshotNode>>>>;
  rawEvidenceReferencesByScreenId?: Readonly<Record<string, ReadonlyArray<string>>>;
  rawEvidenceStatusByScreenId?: Readonly<Record<string, OfflineTestPreflightRawEvidenceStatus>>;
};

const RAW_CANDIDATE_LIMIT = 12;

function sourceOriginKey(source: OfflineTestPreflightEvidenceSource): string {
  if (!source.origin) return "";
  return source.origin.kind === "screen-variant"
    ? [source.origin.kind, source.origin.observationId ?? "", source.origin.capturedAt ?? ""].join(
        "\u0000",
      )
    : [
        source.origin.kind,
        source.origin.surfaceId,
        source.origin.captureId,
        source.origin.viewportIndex,
        source.origin.capturedAt,
      ].join("\u0000");
}

/** A CAS URI does not identify a selector source by itself: that same tree
 * may be frozen for two target/locale variants. Keep the source facts in both
 * deterministic ordering and de-duplication so a future compatibility pass
 * can never lose the distinction. */
function evidenceSourceKey(source: OfflineTestPreflightEvidenceSource): string {
  return [
    source.reference,
    source.evidenceId ?? "",
    source.sha256 ?? "",
    source.variant?.id ?? "",
    source.variant?.targetProfileId ?? "",
    source.variant?.targetId ?? "",
    source.variant?.platform ?? "",
    source.variant?.androidAvdName ?? "",
    source.variant?.viewport?.width ?? "",
    source.variant?.viewport?.height ?? "",
    source.variant?.browserCaseProfile ? JSON.stringify(source.variant.browserCaseProfile) : "",
    sourceOriginKey(source),
  ].join("\u0000");
}

function compareEvidenceSources(
  left: OfflineTestPreflightEvidenceSource,
  right: OfflineTestPreflightEvidenceSource,
): number {
  const leftKey = evidenceSourceKey(left);
  const rightKey = evidenceSourceKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function uniqueReferences(references: readonly string[]): string[] {
  return [...new Set(references.filter((reference) => reference.trim()))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export function uniqueEvidenceSources(
  sources: readonly OfflineTestPreflightEvidenceSource[],
): OfflineTestPreflightEvidenceSource[] {
  const seen = new Set<string>();
  return [...sources]
    .filter((source) => source.reference.trim())
    .sort(compareEvidenceSources)
    .filter((source) => {
      const key = evidenceSourceKey(source);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((source) => structuredClone(source));
}

export function rawSourcesForScreen(
  evidence: OfflineTestPreflightEvidence,
  screenId: string | undefined,
): OfflineTestPreflightRawSource[] {
  if (!screenId) return [];
  const explicit = evidence.rawSourcesByScreenId?.[screenId];
  if (explicit !== undefined) {
    return [...explicit]
      .sort((left, right) => compareEvidenceSources(left.source, right.source))
      .map((source) => ({
        source: structuredClone(source.source),
        ...(source.nodes ? { nodes: [...source.nodes] } : {}),
      }));
  }
  const legacy = evidence.rawObservationsByScreenId?.[screenId] ?? [];
  const references = uniqueReferences(evidence.rawEvidenceReferencesByScreenId?.[screenId] ?? []);
  return legacy.map((nodes, index) => ({
    source: {
      reference:
        references[index] ??
        references[0] ??
        `screen:${screenId}:raw-accessibility-tree:${index + 1}`,
    },
    nodes: [...nodes],
  }));
}

export function rawSourceMetadata(
  sources: readonly OfflineTestPreflightRawSource[],
  references: readonly string[],
): OfflineTestPreflightEvidenceSource[] {
  const exactSources = uniqueEvidenceSources(sources.map((source) => source.source));
  const representedReferences = new Set(exactSources.map((source) => source.reference));
  return uniqueEvidenceSources([
    ...exactSources,
    ...references
      .filter((reference) => !representedReferences.has(reference))
      .map((reference) => ({ reference })),
  ]);
}

export function rawSourceReferences(
  sources: readonly OfflineTestPreflightEvidenceSource[],
): string[] {
  return uniqueReferences(sources.map((source) => source.reference));
}

function sameBounds(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    Math.abs(left.x - right.x) <= 4 &&
    Math.abs(left.y - right.y) <= 4 &&
    Math.abs(left.width - right.width) <= 4 &&
    Math.abs(left.height - right.height) <= 4
  );
}

function rawNodeSummary(
  node: SnapshotNode,
  treeOrder: number,
): OfflineTestPreflightRawCandidate["node"] {
  return {
    treeOrder,
    ...(node.role || node.type ? { role: node.role ?? node.type } : {}),
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { value: node.value } : {}),
    ...(typeof node.index === "number" ? { index: node.index } : {}),
    ...(typeof node.parentIndex === "number" ? { parentIndex: node.parentIndex } : {}),
    ...(node.rect ? { bounds: { ...node.rect } } : {}),
    ...(node.hittable !== undefined ? { hittable: node.hittable } : {}),
    ...(node.enabled !== undefined ? { enabled: node.enabled } : {}),
    ...(node.visibleToUser !== undefined ? { visibleToUser: node.visibleToUser } : {}),
  };
}

function rawOwnerAtBounds(
  nodes: readonly SnapshotNode[],
  bounds: { x: number; y: number; width: number; height: number },
): OfflineTestPreflightRawCandidate["owner"] | undefined {
  const candidates = nodes
    .flatMap((node, treeOrder) =>
      node.rect && sameBounds(node.rect, bounds) ? [[node, treeOrder] as const] : [],
    )
    .sort(([left, leftOrder], [right, rightOrder]) => {
      const leftScore = (left.hittable === true ? 4 : 0) + (left.parentIndex !== undefined ? 1 : 0);
      const rightScore =
        (right.hittable === true ? 4 : 0) + (right.parentIndex !== undefined ? 1 : 0);
      return rightScore - leftScore || leftOrder - rightOrder;
    });
  const selected = candidates[0];
  if (!selected?.[0].rect) return undefined;
  const [node, treeOrder] = selected;
  const rect = node.rect;
  if (!rect) return undefined;
  return {
    treeOrder,
    ...(typeof node.index === "number" ? { index: node.index } : {}),
    ...(typeof node.parentIndex === "number" ? { parentIndex: node.parentIndex } : {}),
    bounds: { ...rect },
    ...(node.hittable !== undefined ? { hittable: node.hittable } : {}),
  };
}

function rawTargetMatches(node: SnapshotNode, target: StepTarget): boolean {
  const semantic = target.relation?.anchor ?? target;
  return relationAnchorMatches(node, { kind: "following-row", anchor: semantic });
}

function rawCandidatesForSource(input: {
  source: OfflineTestPreflightRawSource;
  target: StepTarget;
  resolution?: { bounds: { x: number; y: number; width: number; height: number } };
}): OfflineTestPreflightRawCandidate[] {
  const nodes = input.source.nodes ?? [];
  const matches = nodes.flatMap((node, treeOrder) =>
    rawTargetMatches(node, input.target) ? [[node, treeOrder] as const] : [],
  );
  const owner = input.resolution ? rawOwnerAtBounds(nodes, input.resolution.bounds) : undefined;
  if (input.target.relation) {
    const anchors = matches.map(([node, treeOrder]) => ({
      source: structuredClone(input.source.source),
      relation: "relation-anchor" as const,
      node: rawNodeSummary(node, treeOrder),
    }));
    if (!owner) return anchors;
    return [
      ...anchors,
      {
        source: structuredClone(input.source.source),
        relation: "following-row" as const,
        node: rawNodeSummary(nodes[owner.treeOrder] ?? {}, owner.treeOrder),
        owner,
      },
    ];
  }
  return [
    ...(owner
      ? [
          {
            source: structuredClone(input.source.source),
            relation: "activation-owner" as const,
            node: rawNodeSummary(nodes[owner.treeOrder] ?? {}, owner.treeOrder),
            owner,
          },
        ]
      : []),
    ...matches.map(([node, treeOrder]) => ({
      source: structuredClone(input.source.source),
      relation: "match" as const,
      node: rawNodeSummary(node, treeOrder),
    })),
  ];
}

export function rawCandidateLedger(input: {
  sources: readonly OfflineTestPreflightRawSource[];
  target: StepTarget;
  resolutions?: ReadonlyMap<
    OfflineTestPreflightRawSource,
    { bounds: { x: number; y: number; width: number; height: number } }
  >;
}): { candidates: OfflineTestPreflightRawCandidate[]; count: number } {
  const all = input.sources.flatMap((source) => {
    const resolution = input.resolutions?.get(source);
    return rawCandidatesForSource({
      source,
      target: input.target,
      ...(resolution ? { resolution } : {}),
    });
  });
  const relationOrder = {
    "relation-anchor": 0,
    "following-row": 1,
    "activation-owner": 2,
    match: 3,
  } as const;
  const unique = all
    .sort(
      (left, right) =>
        compareEvidenceSources(left.source, right.source) ||
        relationOrder[left.relation] - relationOrder[right.relation] ||
        (left.node.bounds?.y ?? Number.NEGATIVE_INFINITY) -
          (right.node.bounds?.y ?? Number.NEGATIVE_INFINITY) ||
        (left.node.bounds?.x ?? Number.NEGATIVE_INFINITY) -
          (right.node.bounds?.x ?? Number.NEGATIVE_INFINITY) ||
        left.node.treeOrder - right.node.treeOrder,
    )
    .filter(
      (candidate, index, candidates) =>
        candidates.findIndex(
          (other) =>
            evidenceSourceKey(other.source) === evidenceSourceKey(candidate.source) &&
            other.relation === candidate.relation &&
            other.node.treeOrder === candidate.node.treeOrder,
        ) === index,
    );
  return { candidates: unique.slice(0, RAW_CANDIDATE_LIMIT), count: unique.length };
}
