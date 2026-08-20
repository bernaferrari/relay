import { createHash } from "node:crypto";
import type { AppMapCompiledTest, RawAccessibilityTreeEvidence } from "@relay/protocol";
import { readAuthoringEvidence } from "./authoring-evidence.js";
import type { SnapshotNode } from "./device.js";
import type {
  OfflineTestPreflightEvidence,
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

function source(reference: RawAccessibilityTreeEvidence): OfflineTestPreflightRawSource["source"] {
  return {
    reference: reference.uri,
    evidenceId: reference.id,
    sha256: reference.sha256,
  };
}

async function readSource(
  reference: RawAccessibilityTreeEvidence,
  readEvidence: ReadEvidence,
): Promise<OfflineTestPreflightRawSource> {
  const result: OfflineTestPreflightRawSource = { source: source(reference) };
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
  const rawEvidenceStatusByScreenId: Record<string, "missing" | "unreadable"> = {};
  for (const [screenId, rawTrees] of Object.entries(
    plan.rawAccessibilityTreesByScreenId ?? {},
  ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const trees = [...rawTrees].sort(compareReference);
    if (!trees.length) {
      rawEvidenceStatusByScreenId[screenId] = "missing";
      continue;
    }
    const sources = await Promise.all(trees.map((tree) => readSource(tree, readEvidence)));
    rawSourcesByScreenId[screenId] = sources;
    rawEvidenceReferencesByScreenId[screenId] = [...new Set(trees.map((tree) => tree.uri))].sort(
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    );
    if (sources.some((item) => !item.nodes?.length)) {
      rawEvidenceStatusByScreenId[screenId] = "unreadable";
    }
  }
  return {
    rawSourcesByScreenId,
    rawEvidenceReferencesByScreenId,
    rawEvidenceStatusByScreenId,
  };
}
