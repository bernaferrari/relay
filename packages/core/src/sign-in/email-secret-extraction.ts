import type { TestInboxMessage } from "./imap-test-inbox.js";

const OTP = /(?<![A-Za-z0-9])(\d{6,8})(?![A-Za-z0-9])/gu;
const INTENT_WORD = /code|verification|one[-\s]?time|passcode|sign[-\s]?in|login|otp/iu;

export type ExtractedEmailCode = Readonly<{
  code: string;
  message: TestInboxMessage;
}>;

export class EmailSecretExtractionError extends Error {
  constructor(
    readonly code: "no-code" | "ambiguous-code",
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
  if (INTENT_WORD.test(window)) score += 10;
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
