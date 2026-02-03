import type { SnapshotNode } from './snapshot.ts';

export type FindLocator = 'any' | 'text' | 'label' | 'value' | 'role' | 'id';

export type FindMatchOptions = {
  requireRect?: boolean;
};

export function findNodeByLocator(
  nodes: SnapshotNode[],
  locator: FindLocator,
  query: string,
  options: FindMatchOptions = {},
): SnapshotNode | null {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;
  let best: { node: SnapshotNode; score: number } | null = null;
  for (const node of nodes) {
    if (options.requireRect && !node.rect) continue;
    const score = matchNode(node, locator, normalizedQuery);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { node, score };
      if (score >= 2) {
        // exact match, keep first exact match
        break;
      }
    }
  }
  return best?.node ?? null;
}

function matchNode(node: SnapshotNode, locator: FindLocator, query: string): number {
  switch (locator) {
    case 'role':
      return matchRole(node.type, query);
    case 'label':
      return matchText(node.label, query);
    case 'value':
      return matchText(node.value, query);
    case 'id':
      return matchText(node.identifier, query);
    case 'text':
    case 'any':
    default:
      return Math.max(
        matchText(node.label, query),
        matchText(node.value, query),
        matchText(node.identifier, query),
      );
  }
}

function matchText(value: string | undefined, query: string): number {
  const normalized = normalizeText(value ?? '');
  if (!normalized) return 0;
  if (normalized === query) return 2;
  if (normalized.includes(query)) return 1;
  return 0;
}

function matchRole(value: string | undefined, query: string): number {
  const normalized = normalizeRole(value ?? '');
  if (!normalized) return 0;
  if (normalized === query) return 2;
  if (normalized.includes(query)) return 1;
  return 0;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeRole(value: string): string {
  let normalized = value.trim();
  if (!normalized) return '';
  const lastSegment = normalized.split('.').pop() ?? normalized;
  normalized = lastSegment.replace(/XCUIElementType/gi, '').toLowerCase();
  if (normalized.startsWith('ax')) {
    normalized = normalized.replace(/^ax/, '');
  }
  return normalized;
}
