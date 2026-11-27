import { INBOX_CODE_REFERENCE, type ActiveInboxCodeSecrets } from "../sign-in/secret-references.js";
import { PRIVATE_INPUT } from "../input/private-inputs.js";
import type { ActCandidate, ActDecision } from "./recipe-runner-act.js";

export function inboxCodePromptLines(inboxKey: string): string[] {
  return [
    `This is a sign-in code step using connected test inbox ${JSON.stringify(inboxKey)}.`,
    `When typing the code, output exactly ${INBOX_CODE_REFERENCE}; never invent, infer, or repeat the real code.`,
    "Choose the visible code/verification/OTP input. Do not open email or use unrelated account settings.",
  ];
}

export function assertInboxCodeActDecision(
  decision: ActDecision,
  candidates: ActCandidate[],
): void {
  if (decision.action !== "type") return;
  if (decision.text !== INBOX_CODE_REFERENCE) {
    throw new Error("Test inbox code may be typed only through its opaque secret reference");
  }
  if (decision.candidateId) {
    const candidate = candidates.find((item) => item.id === decision.candidateId);
    if (!candidate?.editable) {
      throw new Error("Test inbox code may be typed only into an editable candidate");
    }
  }
}

export function scrubInboxCodeText(value: string, active: ActiveInboxCodeSecrets): string {
  return value.split(active.code).join(PRIVATE_INPUT);
}

export function scrubInboxCodeCandidates(
  candidates: ActCandidate[],
  active: ActiveInboxCodeSecrets,
): ActCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    ...(candidate.label ? { label: scrubInboxCodeText(candidate.label, active) } : {}),
    ...(candidate.identifier
      ? { identifier: scrubInboxCodeText(candidate.identifier, active) }
      : {}),
  }));
}
