/**
 * A selector miss should tell the agent what it could have meant: the
 * ambiguity the resolver saw, visible labels that nearly match, and the stable
 * prefix of a label that ticks ("Thinking for 26s" → "Thinking for").
 */
import type { SnapshotNode } from "./device-capabilities.js";
import {
  resolveNamedControlOutcome,
  tickingLabelStem,
  type NamedControlTarget,
} from "./device-target-resolution.js";

function comparable(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length])
    length += 1;
  return length;
}

/** Visible labels that share most of the requested text, closest first. */
export function nearMissLabels(nodes: SnapshotNode[], wanted: string, limit = 3): string[] {
  const query = comparable(wanted);
  if (query.length < 2) return [];
  const minimumPrefix = Math.min(8, Math.max(4, Math.ceil(query.length * 0.6)));
  const scored = new Map<string, number>();
  for (const node of nodes) {
    if (node.visibleToUser === false) continue;
    for (const raw of [node.label, node.value]) {
      const label = raw?.trim();
      if (!label || label.length > 120 || scored.has(label)) continue;
      const live = comparable(label);
      if (live === query) continue;
      const prefix = commonPrefixLength(live, query);
      const contains = live.includes(query) || (live.length >= 4 && query.includes(live));
      if (contains || prefix >= minimumPrefix)
        scored.set(label, contains ? 1_000 + prefix : prefix);
    }
  }
  return [...scored.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label]) => label);
}

export function namedControlMissHint(nodes: SnapshotNode[], target: NamedControlTarget): string {
  const parts: string[] = [];
  const outcome = resolveNamedControlOutcome(nodes, target);
  if (outcome.status !== "resolved" && outcome.status !== "absent")
    parts.push(`${outcome.detail}.`);
  const wanted = target.label ?? target.text;
  const near = wanted ? nearMissLabels(nodes, wanted) : [];
  if (near.length > 0) {
    parts.push(`Visible near matches: ${near.map((label) => JSON.stringify(label)).join(", ")}.`);
    const stem = near.map(tickingLabelStem).find(Boolean);
    if (stem) {
      parts.push(
        `For a label that ticks, use {"kind":"text-match","match":${JSON.stringify(stem)}}.`,
      );
    }
  }
  return parts.join(" ");
}

export class NamedControlMissError extends Error {
  override name = "NamedControlMissError";
  readonly hint: string;

  constructor(nodes: SnapshotNode[], target: NamedControlTarget) {
    const hint = namedControlMissHint(nodes, target);
    super(`no unique control matched identifier, label, text, or point${hint ? `. ${hint}` : ""}`);
    this.hint = hint;
  }
}
