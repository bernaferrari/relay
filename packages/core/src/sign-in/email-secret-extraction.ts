import type { TestInboxMessage } from "./imap-test-inbox.js";

const OTP = /(?<![A-Za-z0-9])(\d{6,8})(?![A-Za-z0-9])/gu;
const OTP_INTENT_WORD = /code|verification|one[-\s]?time|passcode|sign[-\s]?in|login|otp/iu;
const TEXT_URL = /https?:\/\/[^\s<>"'`]+/giu;
const ANCHOR = /<a\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/a>/giu;
const LINK_INTENT_WORD =
  /sign[-\s]?in|log[-\s]?in|login|verify|verification|magic|continue|confirm/iu;
const LINK_INTENT_PATH = /sign[-_]?in|log[-_]?in|login|verify|verification|magic|confirm|auth/iu;
const UNRELATED_COPY =
  /unsubscribe|opt[-\s]?out|privacy(?:\s+policy)?|terms(?:\s+of\s+(?:service|use))?|cookie(?:\s+policy)?|(?:manage|email)\s+preferences|view\s+in\s+browser|web\s+version/iu;
const UNRELATED_PATH =
  /(?:^|\/)(?:unsubscribe|opt-out|optout|preferences|privacy(?:-policy)?|terms(?:-of-(?:service|use))?|cookies?|legal|help|support|contact|about|blog)(?:\/|$)/iu;
const UNRELATED_URL_TOKEN = /unsubscribe|opt[-_]out|(?:^|[/?&_-])privacy(?:[/?&=._-]|$)/iu;
const ASSET_PATH = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?)$/iu;
const TRACKING_PIXEL_PATH =
  /(?:^|\/)(?:pixel|beacon|tracking-pixel|track-open|open-tracking)(?:\/|$)/iu;

export type ExtractedEmailCode = Readonly<{
  code: string;
  message: TestInboxMessage;
}>;

export type ExtractedEmailLink = Readonly<{
  url: string;
  message: TestInboxMessage;
}>;

export class EmailSecretExtractionError extends Error {
  constructor(
    readonly code: "no-code" | "ambiguous-code" | "no-link" | "ambiguous-link",
    message: string,
  ) {
    super(message);
    this.name = "EmailSecretExtractionError";
  }
}

function candidateScore(text: string, index: number): number {
  const window = text
    .slice(Math.max(0, index - 80), Math.min(text.length, index + 88))
    .toLowerCase();
  let score = 0;
  if (OTP_INTENT_WORD.test(window)) score += 10;
  if (/is\s*$/.test(text.slice(Math.max(0, index - 24), index).toLowerCase())) score += 2;
  if (/^\s*[:：]/.test(text.slice(index, index + 4))) score += 1;
  return score;
}

function codeCandidates(text: string): { code: string; score: number }[] {
  const out: { code: string; score: number }[] = [];
  for (const match of text.matchAll(OTP)) {
    out.push({ code: match[1]!, score: candidateScore(text, match.index ?? 0) });
  }
  return out;
}

/** Extract exactly one plausible OTP from the best message. The best message
 * is the newest message after baseline/recipient filtering, already ordered by
 * the inbox port. Two equally plausible best codes are terminal; Relay never
 * guesses which one the product meant. */
export function extractEmailCode(messages: readonly TestInboxMessage[]): ExtractedEmailCode {
  const message = messages[0];
  if (!message)
    throw new EmailSecretExtractionError("no-code", "No email contained a usable sign-in code");
  const candidates = codeCandidates(`${message.subject ?? ""}\n${message.bodyText}`);
  if (!candidates.length) {
    throw new EmailSecretExtractionError(
      "no-code",
      "The newest matching email did not contain a sign-in code",
    );
  }
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  const distinct = [...new Set(best.map((candidate) => candidate.code))];
  if (best.length > 1 && distinct.length > 1) {
    throw new EmailSecretExtractionError(
      "ambiguous-code",
      "The newest matching email contained two equally plausible sign-in codes",
    );
  }
  return Object.freeze({ code: best[0]!.code, message });
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu,
    (raw, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : raw;
      }
      if (lower.startsWith("#")) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : raw;
      }
      return named[lower] ?? raw;
    },
  );
}

function attributeValue(source: string, name: "href" | "alt"): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(
    source,
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeHtmlEntities(value);
}

function htmlText(html: string): string {
  const withoutProgrammaticContent = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ");
  const withAltText = withoutProgrammaticContent.replace(/<img\b[^>]*>/giu, (tag) => {
    const alt = attributeValue(tag, "alt");
    return alt ? ` ${alt} ` : " ";
  });
  return decodeHtmlEntities(withAltText.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanUrl(value: string): string {
  let url = decodeHtmlEntities(value).trim();
  while (url && /[.,;:!?)\]}'"`]$/u.test(url)) url = url.slice(0, -1);
  return url;
}

function parsedHttpUrl(value: string): URL | undefined {
  const cleaned = cleanUrl(value);
  if (!cleaned || /\s/u.test(cleaned)) return undefined;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

type LinkCandidate = Readonly<{
  url: string;
  context: string;
  label?: string;
}>;

function anchorCandidates(html: string): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  for (const match of html.matchAll(ANCHOR)) {
    const attrs = match.groups?.attrs ?? "";
    const href = attributeValue(attrs, "href");
    if (!href) continue;
    const index = match.index ?? 0;
    const element = match[0];
    const before = htmlText(html.slice(Math.max(0, index - 240), index));
    const label = htmlText(match.groups?.body ?? "");
    const after = htmlText(html.slice(index + element.length, index + element.length + 240));
    out.push({
      url: href,
      context: [before, label, after].filter(Boolean).join(" "),
      ...(label ? { label } : {}),
    });
  }
  return out;
}

function textCandidates(text: string): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  for (const match of text.matchAll(TEXT_URL)) {
    const index = match.index ?? 0;
    out.push({
      url: match[0],
      context: text
        .slice(Math.max(0, index - 120), Math.min(text.length, index + match[0].length + 120))
        .replace(/\s+/gu, " ")
        .trim(),
    });
  }
  return out;
}

/** Footer, legal, preference, pixel, and asset links are operational chrome,
 * not candidates for authentication. The filter is deliberately narrow: anchor
 * copy such as "unsubscribe" or "privacy policy", paths under those nouns,
 * static image/asset extensions, and explicit pixel/beacon paths are removed.
 * Click-tracking sign-in links are not unwrapped or discarded merely because
 * their host is a tracker; their visible anchor still supplies the intent. */
function clearlyUnrelated(candidate: LinkCandidate, parsed: URL): boolean {
  const path = parsed.pathname.toLowerCase();
  if (ASSET_PATH.test(path) || TRACKING_PIXEL_PATH.test(path) || UNRELATED_PATH.test(path)) {
    return true;
  }
  if (UNRELATED_URL_TOKEN.test(parsed.href.toLowerCase())) return true;
  if (candidate.label) {
    return UNRELATED_COPY.test(candidate.label) && !LINK_INTENT_WORD.test(candidate.label);
  }
  return UNRELATED_COPY.test(candidate.context) && !LINK_INTENT_WORD.test(candidate.context);
}

function linkScore(candidate: LinkCandidate, parsed: URL): number {
  let score = 0;
  if (candidate.label && LINK_INTENT_WORD.test(candidate.label)) score += 12;
  else if (LINK_INTENT_WORD.test(candidate.context)) score += 8;
  if (LINK_INTENT_PATH.test(`${parsed.pathname} ${parsed.search}`)) score += 2;
  if (candidate.label) score += 1;
  return score;
}

function messageLinkCandidates(message: TestInboxMessage): LinkCandidate[] {
  return [
    ...textCandidates(message.bodyText),
    ...(message.bodyHtml ? anchorCandidates(message.bodyHtml) : []),
  ];
}

/** Extract exactly one plausible HTTP(S) sign-in link from the newest matching
 * message. Plaintext URLs and HTML anchor hrefs are candidates; exact
 * duplicates are one candidate. Context is scored locally and never shown to a
 * model. As with codes, equal best distinct URLs are terminal rather than a
 * guess. A unique best candidate may win without intent copy because the
 * newest sign-in email is already the scoped input, but operational chrome is
 * filtered before scoring. */
export function extractEmailLink(messages: readonly TestInboxMessage[]): ExtractedEmailLink {
  const message = messages[0];
  if (!message) {
    throw new EmailSecretExtractionError("no-link", "No email contained a usable sign-in link");
  }
  const candidates = new Map<string, { score: number }>();
  for (const candidate of messageLinkCandidates(message)) {
    const cleaned = cleanUrl(candidate.url);
    const parsed = parsedHttpUrl(cleaned);
    if (!parsed || clearlyUnrelated({ ...candidate, url: cleaned }, parsed)) continue;
    const score = linkScore(candidate, parsed);
    const existing = candidates.get(cleaned);
    if (!existing || score > existing.score) candidates.set(cleaned, { score });
  }
  if (!candidates.size) {
    throw new EmailSecretExtractionError(
      "no-link",
      "The newest matching email did not contain a usable sign-in link",
    );
  }
  const bestScore = Math.max(...[...candidates.values()].map((candidate) => candidate.score));
  const best = [...candidates.keys()].filter((url) => candidates.get(url)?.score === bestScore);
  if (best.length > 1) {
    throw new EmailSecretExtractionError(
      "ambiguous-link",
      "The newest matching email contained two equally plausible sign-in links",
    );
  }
  return Object.freeze({ url: best[0]!, message });
}
