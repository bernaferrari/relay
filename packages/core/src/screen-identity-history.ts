import type { SnapshotNode } from "./device.js";

const HISTORY_LINK_ROLE = /^a$/u;
const HISTORY_COPY_ROLE = /^(?:a|text)$/u;
/** Nav phrases that are 3+ words but still chrome, not a conversation title. */
const KEEP_NAV_PHRASE = /^(?:skip to|switch to|go to|upload a file|add to project|enter voice mode)\b/iu;

function nodeRole(node: SnapshotNode): string {
  return (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
}

function compactCopy(value: string | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function historyLabelKey(label: string): string {
  return label.toLocaleLowerCase("en-US");
}

function isHistoryLinkLabel(label: string): boolean {
  if (!label || label === "<placeholder>") return false;
  if (KEEP_NAV_PHRASE.test(label)) return false;
  const words = label.split(" ").filter(Boolean);
  // grok.com sidebar chats are often 3 words ("3x5 equals 15"). 1–2 word
  // links stay chrome (Library, Imagine, Home page, Automations).
  if (words.length >= 3) return true;
  return /[:/]/.test(label) && words.length >= 2;
}

/** Conversation titles from sidebar links, used to drop duplicate text nodes. */
export function conversationHistoryLabels(nodes: readonly SnapshotNode[]): Set<string> {
  const labels = new Set<string>();
  for (const node of nodes) {
    if (node.identifier?.trim()) continue;
    if (!HISTORY_LINK_ROLE.test(nodeRole(node))) continue;
    const label = compactCopy(node.label);
    if (!isHistoryLinkLabel(label)) continue;
    labels.add(historyLabelKey(label));
  }
  return labels;
}

/**
 * Sidebar conversation titles (and their duplicate text nodes). Chrome nav,
 * skip links, and 1–2 word destinations stay in identity even without rects.
 */
export function isConversationHistoryNode(
  node: SnapshotNode,
  historyLabels: ReadonlySet<string>,
): boolean {
  if (historyLabels.size === 0) return false;
  if (node.identifier?.trim()) return false;
  if (!HISTORY_COPY_ROLE.test(nodeRole(node))) return false;
  const label = compactCopy(node.label);
  return Boolean(label) && historyLabels.has(historyLabelKey(label));
}
