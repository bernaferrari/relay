import {
  registerAppIdentityPolicyResolver,
  type AppIdentityPolicy,
} from "./app-identity-policy.js";
import { registerBrowserAccountIdentityExclusion } from "../browser/browser-auth-health.js";

/**
 * Test-local host packs for internal identity heuristics. These are not the
 * registered production extension boundary; product policy lives in @relay/grok-qa.
 */
export const GROK_WEB_APP_TEST_POLICY: AppIdentityPolicy = {
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
    inputIdentifier: /^chat-input$/u,
    typeaheadChromeLabel: /^(?:explore\?|fast|imagine|chat|auto|expert|heavy|build)$/iu,
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

export const GROK_ANDROID_APP_TEST_POLICY: AppIdentityPolicy = {
  id: "grok-android",
  nativeImagineWorkspace: {
    packageName: "ai.x.grok",
    rootIdentifier: "action_bar_root",
    headerIdentifier: "conversation_top_bar",
    selectedTabLabel: "Imagine",
    headerLabels: ["Ask", "Build", "Show navigation drawer", "Refresh"],
    inputType: "android.widget.EditText",
    attachLabel: "Attach media",
    focusedComposer: {
      sendLabel: "Send prompt",
      countLabel: "Image count",
      speedLabel: "Speed",
      qualityLabel: /^Quality(?:\s|$)/iu,
    },
    idleComposer: {
      placeholderLabel: "Type to imagine",
      settingsLabel: "Imagine settings",
      favoritesLabel: "Favorites",
    },
    qualityFallbackLabel: "Quality",
    imageCountFallbackLabel: "Model image count",
  },
  nativeHomeWorkspace: {
    packageName: "ai.x.grok",
    rootIdentifier: "action_bar_root",
    headerIdentifier: "conversation_top_bar",
    selectedTabLabel: "Ask",
    headerLabels: ["Imagine", "Build", "Show navigation drawer", "Private Chat"],
    inputIdentifier: "chat_text_input",
    composerLabels: [
      "Launch gallery selector",
      "Ask anything",
      "Start dictation",
      "Start Grok Voice",
    ],
  },
};

const GROK_TEST_ACCOUNT_IDENTITY_STAND_INS = new Set([
  "super grok",
  "supergrok",
  "grok-lab",
  "grok-daily",
  "grok-daily-b",
  "grok-daily-c",
  "grok-daily-d",
  "grok-daily-e",
  "grok-daily-f",
  "grok-daily-g",
  "grok-daily-h",
  "grok-auth-email",
  "grok-auth-gmail",
  "grok-auth-x",
  "grok-auth-x-out",
  "new chat",
  "imagine",
]);

/** Register the test host pack through the same extension points used by production plug-ins. */
export function registerGrokIdentityTestPolicies(): () => void {
  const unregister = [
    registerAppIdentityPolicyResolver((input) => {
      const tokens = `${input.appMapId ?? ""} ${input.browserTargetId ?? ""}`.toLocaleLowerCase();
      if (/(?:^|\s)(?:grok-web|grok-com)(?:\s|$)/u.test(tokens)) return GROK_WEB_APP_TEST_POLICY;
      if (/(?:^|\s)grok-android(?:\s|$)/u.test(tokens)) return GROK_ANDROID_APP_TEST_POLICY;
      return undefined;
    }),
    registerBrowserAccountIdentityExclusion(
      (key) => GROK_TEST_ACCOUNT_IDENTITY_STAND_INS.has(key) || key.startsWith("grok-"),
    ),
  ];
  return () => {
    for (const undo of unregister.splice(0)) undo();
  };
}
