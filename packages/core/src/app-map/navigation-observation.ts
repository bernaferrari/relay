import type { ConnectionNavigationTarget, ScreenIdentity } from "@relay/protocol";
import type { SnapshotNode } from "../device.js";
import { observeScreenIdentity } from "../screen-identity.js";
import type { SnapshotPayload } from "../workspace-capture.js";

const DESTRUCTIVE =
  /\b(?:delete|uninstall|erase|wipe|factory\s*reset|remove account|clear(?: all)? data|reset (?:phone|tablet|device)|destroy|permanently)\b/iu;

export type NavigationObservationAction = {
  kind: "tap";
  identifier?: string;
  label?: string;
  role?: string;
};

export type ProposedNavigationEdge = {
  action: NavigationObservationAction;
  targetAlternatives: ConnectionNavigationTarget[];
  sourceIdentity: ScreenIdentity;
  destinationIdentity: ScreenIdentity;
  returnBehavior?: { kind: "back"; expectedDestination: ScreenIdentity };
  confidence: number;
  reasons: string[];
};

export type NavigationObservationResult =
  | { status: "proposed"; edge: ProposedNavigationEdge }
  | { status: "unresolved"; reason: string };

function visible(nodes: readonly SnapshotNode[]): SnapshotNode[] {
  return nodes.filter((node) => node.visibleToUser !== false);
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function matchesTarget(node: SnapshotNode, action: NavigationObservationAction): boolean {
  const identifier = normalized(action.identifier);
  const label = normalized(action.label);
  if (identifier) {
    return normalized(node.identifier) === identifier || normalized(node.ref) === identifier;
  }
  return Boolean(label) && normalized(node.label) === label;
}

/** Infer a reviewable navigation edge from before/after observations.
 * Nothing is persisted; destructive and ambiguous controls stay unresolved. */
export function proposeNavigationFromObservation(input: {
  before: SnapshotPayload;
  after: SnapshotPayload;
  action: NavigationObservationAction;
}): NavigationObservationResult {
  const spoken = normalized(input.action.label) ?? normalized(input.action.identifier) ?? "";
  if (DESTRUCTIVE.test(spoken)) {
    return {
      status: "unresolved",
      reason: "Destructive controls stay unresolved until a person reviews them.",
    };
  }
  const matches = visible(input.before.nodes).filter((node) => matchesTarget(node, input.action));
  if (matches.length !== 1) {
    return {
      status: "unresolved",
      reason:
        matches.length === 0
          ? "The tapped control was not found in the before tree."
          : "Ambiguous controls stay unresolved until a person chooses one.",
    };
  }
  const control = matches[0]!;
  if (
    DESTRUCTIVE.test(normalized(control.label) ?? "") ||
    DESTRUCTIVE.test(normalized(control.value) ?? "")
  ) {
    return {
      status: "unresolved",
      reason: "Destructive controls stay unresolved until a person reviews them.",
    };
  }
  const source = observeScreenIdentity(input.before.nodes);
  const destination = observeScreenIdentity(input.after.nodes);
  if (!source.fingerprint || !destination.fingerprint) {
    return {
      status: "unresolved",
      reason: "Screen identity was insufficient to propose an edge.",
    };
  }
  if (source.fingerprint === destination.fingerprint) {
    return {
      status: "unresolved",
      reason: "The tap did not change screen identity, so no navigation edge is proposed.",
    };
  }
  const targetAlternatives: ConnectionNavigationTarget[] = [];
  const identifier = normalized(control.identifier) ?? normalized(control.ref);
  if (identifier) targetAlternatives.push({ kind: "identifier", identifier });
  const accessibilityLabel = normalized(control.label);
  if (accessibilityLabel) {
    const role = normalized(control.role ?? control.type);
    targetAlternatives.push({
      kind: "accessibility",
      label: accessibilityLabel,
      ...(role ? { role } : {}),
    });
  }
  if (!targetAlternatives.length) {
    return {
      status: "unresolved",
      reason: "The control has no identifier or label to replay.",
    };
  }
  const hasBack = visible(input.after.nodes).some((node) =>
    /^(back|close|cancel)$/iu.test(normalized(node.label) ?? ""),
  );
  const reasons = [
    "Before and after accessibility identities differ.",
    "The control is unique and non-destructive.",
  ];
  return {
    status: "proposed",
    edge: {
      action: input.action,
      targetAlternatives,
      sourceIdentity: { schemaVersion: 1, fingerprint: source.fingerprint },
      destinationIdentity: { schemaVersion: 1, fingerprint: destination.fingerprint },
      ...(hasBack
        ? {
            returnBehavior: {
              kind: "back" as const,
              expectedDestination: { schemaVersion: 1, fingerprint: source.fingerprint },
            },
          }
        : {}),
      confidence: identifier ? 0.86 : 0.72,
      reasons: hasBack
        ? [...reasons, "Destination exposes a Back, Close, or Cancel control."]
        : reasons,
    },
  };
}
