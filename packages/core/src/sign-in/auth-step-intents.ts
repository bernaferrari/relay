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
