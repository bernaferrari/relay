import type { SnapshotNode } from "./device.js";

/** Reviewed App pack for identity, auth, and dynamic-body policy. Not a plugin host. */
export type AppIdentityPolicy = {
  readonly id: string;
  readonly conversationHistory?: {
    readonly linkRole: RegExp;
    readonly copyRole: RegExp;
    readonly keepNavPhrase: RegExp;
    readonly minWords: number;
  };
  readonly composer?: {
    readonly role: RegExp;
    readonly bandPx: number;
    readonly pageTitleRole: RegExp;
    readonly headerMaxY: number;
    readonly navRailMaxX: number;
    readonly conversationChromeLabel: RegExp;
    readonly conversationSlotIdentifier: RegExp;
    readonly conversationArticleLabel: RegExp;
    readonly transcriptParagraphRole: RegExp;
    readonly placeholderHint?: RegExp;
  };
  readonly signIn?: {
    readonly signedInMarkers: readonly string[];
    readonly signedOutMarkers: string[];
  };
};

/** Explicit grok.com pack. Generic inference never applies these selectors. */
export const GROK_WEB_APP_POLICY: AppIdentityPolicy = {
  id: "grok-web",
  conversationHistory: {
    linkRole: /^a$/u,
    copyRole: /^(?:a|text)$/u,
    keepNavPhrase: /^(?:skip to|switch to|go to|upload a file|add to project|enter voice mode)\b/iu,
    minWords: 3,
  },
  composer: {
    role: /^(?:textbox|textarea|searchbox)$/u,
    bandPx: 110,
    pageTitleRole: /^(?:h1|heading)$/u,
    headerMaxY: 100,
    navRailMaxX: 88,
    conversationChromeLabel: /^(?:copy response|create share link|regenerate|like|dislike)$/iu,
    conversationSlotIdentifier:
      /^(?:assistant-message|user-message|last-reply-container|response-.+)$/iu,
    conversationArticleLabel: /^(?:you|grok)$/iu,
    transcriptParagraphRole: /^(?:p|paragraph)$/u,
    placeholderHint:
      /\b(?:type [@/#] to [a-z0-9 ]+|type to (?:imagine|grok)\b|drag and drop [a-z0-9 ]+|switch to (?:build|ask) mode(?: to [a-z0-9 ]*)?|ask grok anything)\b/giu,
  },
  signIn: {
    signedInMarkers: ["ask grok anything", "ask anything", "imagine", "speak", "new chat"],
    signedOutMarkers: [
      "sign in",
      "sign up",
      "log in",
      "continue with google",
      "continue with x",
      "continue with apple",
    ],
  },
};

export function isGrokWebPolicy(policy: AppIdentityPolicy | undefined): boolean {
  return policy?.id === GROK_WEB_APP_POLICY.id;
}

/** Reviewed catalog: grok.com only. Generic maps and other apps get no pack. */
export function identityPolicyForTarget(input: {
  appMapId?: string;
  browserTargetId?: string;
}): AppIdentityPolicy | undefined {
  const tokens = `${input.appMapId ?? ""} ${input.browserTargetId ?? ""}`.toLocaleLowerCase();
  if (/(?:^|\s)(?:grok-web|grok-com)(?:\s|$)/u.test(tokens)) return GROK_WEB_APP_POLICY;
  return undefined;
}

export function nodeRole(node: SnapshotNode): string {
  return (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
}
