import type { SnapshotNode } from "./device.js";
import type { AppIdentityPolicy } from "./app-identity-policy.js";
import { nodeRole } from "./app-identity-policy.js";

function compactCopy(value: string | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function historyLabelKey(label: string): string {
  return label.toLocaleLowerCase("en-US");
}

function isHistoryLinkLabel(
  label: string,
  policy: NonNullable<AppIdentityPolicy["conversationHistory"]>,
): boolean {
  if (!label || label === "<placeholder>") return false;
  if (policy.keepNavPhrase.test(label)) return false;
  const words = label.split(" ").filter(Boolean);
  if (words.length >= policy.minWords) return true;
  return /[:/]/.test(label) && words.length >= 2;
}

/** Conversation titles from sidebar links, used to drop duplicate text nodes. */
export function conversationHistoryLabels(
  nodes: readonly SnapshotNode[],
  policy?: AppIdentityPolicy,
): Set<string> {
  const history = policy?.conversationHistory;
  const labels = new Set<string>();
  if (!history) return labels;
  for (const node of nodes) {
    if (node.identifier?.trim()) continue;
    if (!history.linkRole.test(nodeRole(node))) continue;
    const label = compactCopy(node.label);
    if (!isHistoryLinkLabel(label, history)) continue;
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
  policy?: AppIdentityPolicy,
): boolean {
  if (historyLabels.size === 0) return false;
  if (node.identifier?.trim()) return false;
  const copyRole = policy?.conversationHistory?.copyRole ?? /^(?:a|text)$/u;
  if (!copyRole.test(nodeRole(node))) return false;
  const label = compactCopy(node.label);
  return Boolean(label) && historyLabels.has(historyLabelKey(label));
}

export function composerBands(
  nodes: readonly SnapshotNode[],
  policy?: AppIdentityPolicy,
): Array<{ top: number; bottom: number }> {
  const composer = policy?.composer;
  if (!composer) return [];
  return nodes.flatMap((node) => {
    const rect = node.rect;
    if (!rect || !composer.role.test(nodeRole(node))) return [];
    return [
      {
        top: rect.y - composer.bandPx,
        bottom: rect.y + rect.height + composer.bandPx,
      },
    ];
  });
}

/**
 * Scrollable transcript, suggestion chips, and gallery tiles. Chrome is the
 * header, page title, side rail, and the composer cluster. Nodes without a
 * rect stay in identity so callers that omit geometry do not lose controls.
 */
export function isDynamicContentBody(
  node: SnapshotNode,
  bands: Array<{ top: number; bottom: number }>,
  conversationOpen = false,
  policy?: AppIdentityPolicy,
): boolean {
  const composer = policy?.composer;
  if (!composer) return false;
  const rect = node.rect;
  if (!rect || bands.length === 0) return false;
  const role = nodeRole(node);
  if (composer.pageTitleRole.test(role) || composer.role.test(role)) return false;
  if (isConversationChromeNode(node, policy)) return false;
  if (conversationOpen && composer.transcriptParagraphRole.test(role)) return true;
  if (conversationOpen && rect.y < 0) return true;
  if (rect.y < composer.headerMaxY) return false;
  if (rect.x < composer.navRailMaxX && rect.width < 280) return false;
  const mid = rect.y + rect.height / 2;
  if (bands.some((band) => mid >= band.top && mid <= band.bottom)) return false;
  return true;
}

/** Open-chat chrome: toolbar actions and message slots, never transcript text. */
export function isConversationChromeNode(node: SnapshotNode, policy?: AppIdentityPolicy): boolean {
  const composer = policy?.composer;
  if (!composer) return false;
  const identifier = (node.identifier ?? "").trim();
  if (composer.conversationSlotIdentifier.test(identifier)) return true;
  if (
    nodeRole(node) === "article" &&
    composer.conversationArticleLabel.test(compactCopy(node.label))
  ) {
    return true;
  }
  return composer.conversationChromeLabel.test(compactCopy(node.label));
}

/**
 * Keep the slot so an open chat is not empty home, but drop the reply copy so
 * two conversations stay one screen.
 */
export function redactConversationTranscript(
  node: SnapshotNode,
  policy?: AppIdentityPolicy,
): SnapshotNode {
  if (!isConversationChromeNode(node, policy)) return node;
  if (policy?.composer?.conversationChromeLabel.test(compactCopy(node.label))) return node;
  const next = { ...node };
  delete next.label;
  delete next.value;
  delete next.content;
  return next;
}
