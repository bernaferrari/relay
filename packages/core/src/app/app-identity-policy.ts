import type { SnapshotNode } from "../device/device.js";

/** Reviewed application pack for identity, auth, and dynamic-body policy. */
export type AppIdentityPolicy = {
  readonly id: string;
  readonly nativeImagineWorkspace?: {
    readonly packageName: string;
    readonly rootIdentifier: string;
    readonly headerIdentifier: string;
    readonly selectedTabLabel: string;
    readonly headerLabels: readonly string[];
    readonly inputType: string;
    readonly attachLabel: string;
    readonly focusedComposer: {
      readonly sendLabel: string;
      readonly countLabel: string;
      readonly speedLabel: string;
      readonly qualityLabel: RegExp;
    };
    readonly idleComposer: {
      readonly placeholderLabel: string;
      readonly settingsLabel: string;
      readonly favoritesLabel: string;
    };
    readonly qualityFallbackLabel: string;
    readonly imageCountFallbackLabel: string;
  };
  readonly nativeHomeWorkspace?: {
    readonly packageName: string;
    readonly rootIdentifier: string;
    readonly headerIdentifier: string;
    readonly selectedTabLabel: string;
    readonly headerLabels: readonly string[];
    readonly inputIdentifier: string;
    readonly composerLabels: readonly string[];
  };
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
    readonly inputIdentifier?: RegExp;
    readonly typeaheadChromeLabel?: RegExp;
  };
  readonly signIn?: {
    readonly signedInMarkers: readonly string[];
    readonly signedOutMarkers: readonly string[];
  };
};

export type AppIdentityPolicyResolver = (input: {
  appMapId?: string;
  browserTargetId?: string;
}) => AppIdentityPolicy | undefined;

const appIdentityPolicyResolvers: AppIdentityPolicyResolver[] = [];

/** Register product-owned identity policy. Generic inference never applies it implicitly. */
export function registerAppIdentityPolicyResolver(resolver: AppIdentityPolicyResolver): () => void {
  appIdentityPolicyResolvers.push(resolver);
  return () => {
    const index = appIdentityPolicyResolvers.indexOf(resolver);
    if (index >= 0) appIdentityPolicyResolvers.splice(index, 1);
  };
}

/** Resolve the reviewed application pack for a target. Without host policy, targets are generic. */
export function identityPolicyForTarget(input: {
  appMapId?: string;
  browserTargetId?: string;
}): AppIdentityPolicy | undefined {
  for (const resolver of appIdentityPolicyResolvers) {
    const policy = resolver(input);
    if (policy !== undefined) return policy;
  }
  return undefined;
}

export function nodeRole(node: SnapshotNode): string {
  return (node.role ?? node.type ?? "").trim().toLocaleLowerCase();
}
