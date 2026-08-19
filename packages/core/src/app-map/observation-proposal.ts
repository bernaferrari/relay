import { createHash } from "node:crypto";
import type {
  ActionSpec,
  AppMap,
  AppMapBatchChange,
  AppMapScope,
  ConnectionNavigationContract,
  ConnectionReturnContract,
  DiscoverySession,
  ObservedScreen,
  ObservedTransition,
  Proposal,
  ProposalChange,
  ScreenVariant,
} from "@relay/protocol";
import { canvasSlotAllocator } from "./canvas-slots.js";
import type { ProposedNavigationEdge } from "./navigation-observation.js";
import {
  isSettingsHubOrChildTitle,
  preferSettingsChildTitle,
  settingsScreenTitlesConflict,
} from "./settings-screen-titles.js";
import { isProfileAppTitle, isProfileWeakTitle } from "../discovery-app-profiles.js";

/** A title that cannot tell two screens apart, so it must not block a merge. */
function isWeakScreenTitle(value: string): boolean {
  return /^screen$/i.test(value) || isProfileWeakTitle(value);
}

/** A title no person would accept for a screen: chrome, brand, or a raw gesture. */
function isUnusableScreenTitle(value: string): boolean {
  return /^(screen|back|close|coordinate tap)$/i.test(value) || isProfileAppTitle(value);
}

function observedId(sessionId: string, kind: "screen" | "connection" | "variant", id: string) {
  return `observed:${sessionId}:${kind}:${id}`;
}

function actionFor(transition: ObservedTransition): ActionSpec {
  const id = `observed-action:${transition.id}`;
  if (transition.kind === "tap" && transition.target) {
    return { id, kind: "tap", target: structuredClone(transition.target) };
  }
  if (transition.kind === "type" && transition.text !== undefined) {
    return {
      id,
      kind: "text",
      text: transition.text,
      ...(transition.target ? { target: structuredClone(transition.target) } : {}),
    };
  }
  if (transition.kind === "scroll") {
    return {
      id,
      kind: "gesture",
      gesture: { kind: "scroll", direction: transition.direction ?? "down" },
    };
  }
  if (transition.kind === "back") return { id, kind: "back" };
  return { id, kind: "passive", reason: "observe-only" };
}

/** Resolve an observed screen onto an existing App Map node without collapsing
 * distinct Settings children that briefly share chrome fingerprints. */
export function matchingScreenId(
  map: AppMap,
  fingerprint: string,
  title?: string,
): string | undefined {
  const needle = canonicalFingerprint(fingerprint);
  const wanted = title?.trim();
  const byFingerprint = Object.values(map.screens).find((screen) => {
    const identity = screen.identity?.fingerprint;
    if (!identity) return false;
    const canonical = canonicalFingerprint(identity);
    const sameFp =
      canonical === needle ||
      screen.identity?.aliases?.some((alias) => canonicalFingerprint(alias) === needle) === true;
    if (!sameFp) return false;
    const existing = screen.title?.trim();
    // Do not merge distinct named pages that briefly share chrome structure.
    if (settingsScreenTitlesConflict(wanted, existing)) return false;
    if (
      wanted &&
      existing &&
      wanted !== existing &&
      !isWeakScreenTitle(wanted) &&
      !isWeakScreenTitle(existing)
    ) {
      return false;
    }
    return true;
  })?.id;
  if (byFingerprint) return byFingerprint;
  // List hubs change fingerprint as rows scroll into view — keep one screen per title.
  if (isSettingsHubOrChildTitle(wanted)) {
    return Object.values(map.screens).find((screen) => screen.title?.trim() === wanted)?.id;
  }
  return undefined;
}

function canonicalFingerprint(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/u.test(trimmed)) return trimmed;
  return createHash("sha256").update(trimmed).digest("hex");
}

function humanTitle(screen: ObservedScreen, fallback: string): string {
  const title = screen.title?.trim();
  const fallbackTitle = fallback.trim();
  const bad = isUnusableScreenTitle;
  const preferred = preferSettingsChildTitle(title, fallbackTitle);
  if (preferred && !bad(preferred) && !/^observed screen \d+$/i.test(preferred)) {
    return preferred;
  }
  if (fallbackTitle && !bad(fallbackTitle) && (!title || bad(title))) {
    return fallbackTitle;
  }
  if (title && !/^observed screen \d+$/i.test(title) && !bad(title)) return title;
  if (fallbackTitle && !bad(fallbackTitle)) return fallbackTitle;
  return "Screen";
}

function alreadyConnected(
  map: AppMap,
  fromScreenId: string,
  destinationId: string,
  label: string | undefined,
): boolean {
  return Object.values(map.connections).some(
    (connection) =>
      connection.fromScreenId === fromScreenId &&
      connection.destination.kind === "screen" &&
      connection.destination.screenId === destinationId &&
      (connection.label?.trim() || "") === (label?.trim() || ""),
  );
}

/** Draft screens and edges the crawl can commit in one revision. Keep/prove stays a later pass. */
export function discoveryLandChanges(input: {
  map: AppMap;
  session: DiscoverySession;
  transitionId?: string;
}): AppMapBatchChange[] {
  const { map, session } = input;
  const scope: AppMapScope = {
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
  };
  const transition = input.transitionId
    ? session.transitions.find((item) => item.id === input.transitionId)
    : undefined;
  const referenced = transition
    ? new Set(
        [transition.fromScreenId, transition.toScreenId].filter(
          (id): id is string => typeof id === "string",
        ),
      )
    : new Set(session.screens.slice(0, 1).map((screen) => screen.id));
  const changes: AppMapBatchChange[] = [];
  const screenIds = new Map<string, string>();
  const nextSlot = canvasSlotAllocator(map);
  const screens = session.screens.filter((screen) => referenced.has(screen.id));
  for (const screen of screens) {
    const fingerprint = canonicalFingerprint(screen.fingerprint);
    const title = humanTitle(
      screen,
      transition?.toScreenId === screen.id ? (transition.label ?? "") : "",
    );
    const existingId = matchingScreenId(map, fingerprint, title);
    const screenId = existingId ?? observedId(session.id, "screen", screen.id);
    screenIds.set(screen.id, screenId);
    if (existingId) continue;
    changes.push({
      kind: "screen.add",
      input: {
        screen: {
          ...scope,
          id: screenId,
          title,
          identity: { schemaVersion: 1, fingerprint },
          position: nextSlot(),
          variantIds: [],
          createdAt: screen.capturedAt,
          updatedAt: screen.capturedAt,
        },
      },
    });
  }
  if (!transition?.changedScreen || !transition.toScreenId) return changes;
  if (transition.kind === "back") return changes;
  const label = transition.label?.trim();
  if (!label || /^coordinate tap$/i.test(label)) return changes;
  const fromScreenId = screenIds.get(transition.fromScreenId);
  const destinationId = screenIds.get(transition.toScreenId);
  if (!fromScreenId || !destinationId) return changes;
  if (alreadyConnected(map, fromScreenId, destinationId, label)) return changes;
  const connectionId = observedId(session.id, "connection", transition.id);
  if (map.connections[connectionId]) return changes;
  changes.push({
    kind: "connection.create",
    connection: {
      ...scope,
      id: connectionId,
      fromScreenId,
      destination: { kind: "screen", screenId: destinationId },
      ...(label ? { label } : {}),
      state: "draft",
      actions: [actionFor(transition)],
      createdAt: transition.capturedAt,
      updatedAt: transition.capturedAt,
    },
  });
  return changes;
}

function screenEvidenceIds(session: DiscoverySession, screenId: string): string[] {
  return [`discovery:${session.id}:screen:${screenId}`];
}

function navigationFor(
  session: DiscoverySession,
  edge: ProposedNavigationEdge | undefined,
  fromObservedId: string,
  toObservedId: string | undefined,
  fromScreenId: string,
  destinationId: string,
): {
  navigation?: ConnectionNavigationContract;
  return?: ConnectionReturnContract;
} {
  if (!edge) return {};
  return {
    navigation: {
      targetAlternatives: structuredClone(edge.targetAlternatives),
      expectedDestination: {
        screenId: destinationId,
        identity: structuredClone(edge.destinationIdentity),
        evidenceIds: screenEvidenceIds(session, toObservedId ?? fromObservedId),
      },
    },
    ...(edge.returnBehavior
      ? {
          return: {
            kind: "back" as const,
            expectedDestination: {
              screenId: fromScreenId,
              identity: structuredClone(edge.returnBehavior.expectedDestination),
              evidenceIds: screenEvidenceIds(session, fromObservedId),
            },
          },
        }
      : {}),
  };
}

/** Convert an exploration record into a reviewable canonical proposal.
 * Observation is shareable, while identity merges and executable behavior stay
 * pending until a human explicitly approves the proposal. */
export function proposalFromDiscovery(input: {
  map: AppMap;
  session: DiscoverySession;
  proposalId: string;
  title?: string;
  transitionIds?: readonly string[];
  navigationByTransitionId?: Record<string, ProposedNavigationEdge>;
  at: number;
}): Proposal {
  const { map, session, at } = input;
  const scope: AppMapScope = {
    organizationId: map.organizationId,
    projectId: map.projectId,
    appMapId: map.id,
  };
  const selected = input.transitionIds?.length
    ? new Set(input.transitionIds)
    : new Set(session.transitions.map((transition) => transition.id));
  const transitions = session.transitions.filter((transition) => selected.has(transition.id));
  if (!transitions.length) throw new Error("Choose at least one observed transition");
  if (selected.size !== transitions.length) throw new Error("An observed transition was not found");
  const referenced = new Set(
    transitions.flatMap((transition) =>
      [transition.fromScreenId, transition.toScreenId].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  );

  const screenIds = new Map<string, string>();
  const changes: ProposalChange[] = [];
  const nextSlot = canvasSlotAllocator(map);
  const screens = session.screens.filter((screen) => referenced.has(screen.id));
  for (const [index, screen] of screens.entries()) {
    const title = humanTitle(screen, `Screen ${index + 1}`);
    const existingId = matchingScreenId(map, screen.fingerprint, title);
    const screenId = existingId ?? observedId(session.id, "screen", screen.id);
    screenIds.set(screen.id, screenId);
    const evidenceIds = screen.screenshotPath
      ? [`discovery:${session.id}:screen:${screen.id}`]
      : [];
    const variant: ScreenVariant | undefined = session.targetProfile
      ? {
          ...scope,
          id: observedId(session.id, "variant", screen.id),
          screenId,
          targetProfile: structuredClone(session.targetProfile),
          observation: {
            fingerprint: screen.fingerprint,
            nodes: [],
            volatileSignals: [],
          },
          evidenceIds,
          createdAt: screen.capturedAt,
          updatedAt: screen.capturedAt,
        }
      : undefined;
    if (existingId) {
      if (variant) {
        changes.push({
          kind: "screen.update",
          screenId,
          input: { patch: {}, upsertVariants: [variant] },
        });
      }
      continue;
    }
    changes.push({
      kind: "screen.add",
      input: {
        screen: {
          ...scope,
          id: screenId,
          title,
          identity: screen.identity ?? { schemaVersion: 1, fingerprint: screen.fingerprint },
          position: nextSlot(),
          variantIds: variant ? [variant.id] : [],
          createdAt: screen.capturedAt,
          updatedAt: screen.capturedAt,
        },
        ...(variant ? { variants: [variant] } : {}),
      },
    });
  }

  for (const transition of transitions) {
    const fromScreenId = screenIds.get(transition.fromScreenId);
    const destinationId = transition.toScreenId
      ? screenIds.get(transition.toScreenId)
      : fromScreenId;
    if (!fromScreenId || !destinationId) {
      throw new Error(`Observed transition ${transition.id} references an unknown screen`);
    }
    const connectionId = observedId(session.id, "connection", transition.id);
    const edge = input.navigationByTransitionId?.[transition.id];
    const value = {
      fromScreenId,
      destination: { kind: "screen" as const, screenId: destinationId },
      ...(transition.label?.trim() ? { label: transition.label.trim() } : {}),
      state: "draft" as const,
      actions: [actionFor(transition)],
      ...navigationFor(
        session,
        edge,
        transition.fromScreenId,
        transition.toScreenId,
        fromScreenId,
        destinationId,
      ),
    };
    const existing = map.connections[connectionId];
    changes.push(
      existing
        ? { kind: "connection.update", connectionId, patch: value }
        : {
            kind: "connection.connect",
            connection: {
              ...scope,
              id: connectionId,
              ...value,
              createdAt: transition.capturedAt,
              updatedAt: transition.capturedAt,
            },
          },
    );
  }

  if (!changes.length) throw new Error("These observations are already represented on the App Map");
  return {
    ...scope,
    id: input.proposalId,
    title: input.title?.trim() || `Observed path from ${session.name}`,
    description: `${session.targetProfile?.name ?? session.targetId} observed ${transitions.length} transition${transitions.length === 1 ? "" : "s"}. Keep to add ${transitions.length === 1 ? "this edge" : "these edges"} to the map.`,
    status: "pending",
    baseRevision: map.revision,
    changes,
    createdAt: at,
    updatedAt: at,
  };
}

/** One identity-changing interact becomes one reviewable Keep card. */
export function proposalFromObservedEdge(input: {
  map: AppMap;
  session: DiscoverySession;
  proposalId: string;
  transitionId: string;
  edge?: ProposedNavigationEdge;
  title?: string;
  at: number;
}): Proposal {
  const transition = input.session.transitions.find((item) => item.id === input.transitionId);
  return proposalFromDiscovery({
    map: input.map,
    session: input.session,
    proposalId: input.proposalId,
    title:
      input.title?.trim() ||
      transition?.label?.trim() ||
      input.edge?.action.label ||
      "Observed edge",
    transitionIds: [input.transitionId],
    ...(input.edge ? { navigationByTransitionId: { [input.transitionId]: input.edge } } : {}),
    at: input.at,
  });
}
