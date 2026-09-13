import type { SnapshotNode } from "./device.js";

const HISTORY_LINK_ROLE = /^a$/u;
const HISTORY_COPY_ROLE = /^(?:a|text)$/u;
/** Nav phrases that are 3+ words but still chrome, not a conversation title. */
const KEEP_NAV_PHRASE = /^(?:skip to|switch to|go to|upload a file|add to project|enter voice mode)\b/iu;
const COMPOSER_ROLE = /^(?:textbox|textarea|searchbox)$/u;
const PAGE_TITLE_ROLE = /^(?:h1|heading)$/u;
const HEADER_MAX_Y = 100;
const NAV_RAIL_MAX_X = 88;
const COMPOSER_BAND_PX = 110;
/** Toolbar / message-slot chrome that means a chat is open, not its copy. */
const CONVERSATION_CHROME_LABEL =
  /^(?:copy response|create share link|regenerate|like|dislike)$/iu;
const CONVERSATION_SLOT_IDENTIFIER =
  /^(?:assistant-message|user-message|last-reply-container|response-.+)$/iu;
const CONVERSATION_ARTICLE_LABEL = /^(?:you|grok)$/iu;
const TRANSCRIPT_PARAGRAPH_ROLE = /^(?:p|paragraph)$/iu;

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

export function composerBands(
  nodes: readonly SnapshotNode[],
): Array<{ top: number; bottom: number }> {
  return nodes.flatMap((node) => {
    const rect = node.rect;
    if (!rect || !COMPOSER_ROLE.test(nodeRole(node))) return [];
    return [
      {
        top: rect.y - COMPOSER_BAND_PX,
        bottom: rect.y + rect.height + COMPOSER_BAND_PX,
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
): boolean {
  const rect = node.rect;
  if (!rect || bands.length === 0) return false;
  const role = nodeRole(node);
  if (PAGE_TITLE_ROLE.test(role) || COMPOSER_ROLE.test(role)) return false;
  if (isConversationChromeNode(node)) return false;
  if (conversationOpen && TRANSCRIPT_PARAGRAPH_ROLE.test(role)) return true;
  // Open-chat transcript can sit at negative y after scroll; that is not the
  // header band. Empty-home skip links at negative y stay chrome.
  if (conversationOpen && rect.y < 0) return true;
  if (rect.y < HEADER_MAX_Y) return false;
  if (rect.x < NAV_RAIL_MAX_X && rect.width < 280) return false;
  const mid = rect.y + rect.height / 2;
  if (bands.some((band) => mid >= band.top && mid <= band.bottom)) return false;
  return true;
}

/** Open-chat chrome: toolbar actions and message slots, never transcript text. */
export function isConversationChromeNode(node: SnapshotNode): boolean {
  const identifier = (node.identifier ?? "").trim();
  if (CONVERSATION_SLOT_IDENTIFIER.test(identifier)) return true;
  if (nodeRole(node) === "article" && CONVERSATION_ARTICLE_LABEL.test(compactCopy(node.label))) {
    return true;
  }
  return CONVERSATION_CHROME_LABEL.test(compactCopy(node.label));
}

/**
 * Keep the slot so an open chat is not empty home, but drop the reply copy so
 * two conversations stay one screen.
 */
export function redactConversationTranscript(node: SnapshotNode): SnapshotNode {
  if (!isConversationChromeNode(node)) return node;
  if (CONVERSATION_CHROME_LABEL.test(compactCopy(node.label))) return node;
  const next = { ...node };
  delete next.label;
  delete next.value;
  delete next.content;
  return next;
}
