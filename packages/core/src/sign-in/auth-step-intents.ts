import { savedSignInKeySchema } from "@relay/protocol";

export type SignInActAuth = Readonly<{
  type: "sign-in";
  accountKey?: string;
}>;

function normalizeIntent(intent: string): string {
  return intent
    .trim()
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[.!?。！？]+$/u, "")
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/** The compiler's deliberately narrow sign-in phrase contract. Near misses
 * remain ordinary plain-English act steps instead of acquiring credential
 * authority by accident. */
export function signInAuthForIntent(intent: string): SignInActAuth | undefined {
  const normalized = normalizeIntent(intent);
  const bare = "sign in with the saved account";
  if (normalized === bare) return Object.freeze({ type: "sign-in" });
  const match = /^sign in with the saved account "([^"]+)"$/u.exec(normalized);
  if (!match) return undefined;
  const key = savedSignInKeySchema.safeParse(match[1]);
  if (!key.success) return undefined;
  return Object.freeze({ type: "sign-in", accountKey: key.data });
}

export function intentHasSignInAuth(intent: string): boolean {
  return signInAuthForIntent(intent) !== undefined;
}

export type InboxStepIntent = Readonly<{ action: "type-code" | "open-link" }>;

/** Deliberately exact canonical inbox phrases. Near misses remain ordinary
 * act text and never acquire inbox authority by accident. */
export function inboxStepForIntent(intent: string): InboxStepIntent | undefined {
  const normalized = normalizeIntent(intent);
  if (normalized === "enter the code from the email") return Object.freeze({ action: "type-code" });
  if (normalized === "open the sign-in link from the email") {
    return Object.freeze({ action: "open-link" });
  }
  return undefined;
}
