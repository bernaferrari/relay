import type {
  DiscoverySession,
  CanvasGraph,
  CanvasScreen,
  CanvasTransition,
  ObservedScreen,
  ObservedTransition,
} from "@relay/protocol";

export type DiscoveryAppMapImportWarningCode =
  | "missing-screen-fingerprint"
  | "missing-flow-start"
  | "missing-transition-source"
  | "missing-transition-destination"
  | "non-replayable-transition"
  | "conflicting-transition";

export type DiscoveryAppMapImportWarning = {
  code: DiscoveryAppMapImportWarningCode;
  message: string;
  sessionId: string;
  screenId?: string;
  transitionId?: string;
};

export type DiscoveryAppMapImportResult = {
  graph: CanvasGraph;
  warnings: DiscoveryAppMapImportWarning[];
};

const emptyGraph = (): CanvasGraph => ({
  schemaVersion: 1,
  screens: [],
  transitions: [],
  flows: [],
});

function cloneGraph(graph: CanvasGraph): CanvasGraph {
  return structuredClone(graph);
}

/**
 * Discovery fingerprints are the only stable screen identity available today.
 * Encoding the complete value keeps this mapping collision-free and makes a
 * later import match an earlier one without storing adapter-only metadata.
 */
export function canonicalDiscoveryScreenId(fingerprint: string): string {
  return `discovery-screen:${encodeURIComponent(fingerprint)}`;
}

function canonicalTransitionId(sessionId: string, transitionId: string): string {
  return `discovery-transition:${encodeURIComponent(sessionId)}:${encodeURIComponent(transitionId)}`;
}

function canonicalFlowId(sessionId: string): string {
  return `discovery-flow:${encodeURIComponent(sessionId)}`;
}

function compareObserved<T extends { id: string; capturedAt: number }>(left: T, right: T): number {
  return left.capturedAt - right.capturedAt || left.id.localeCompare(right.id);
}

function stableFingerprint(screen: ObservedScreen): string {
  return screen.identity?.fingerprint ?? screen.fingerprint;
}

function firstNonEmptyTitle(screens: ObservedScreen[]): string {
  for (const screen of screens) {
    const title = screen.title?.trim();
    if (title) return title;
  }
  return "Unnamed screen";
}

function transitionLabel(transition: ObservedTransition): string {
  const explicit = transition.label?.trim();
  if (explicit) return explicit;

  switch (transition.kind) {
    case "tap":
      return "Tap";
    case "type":
      return "Type";
    case "scroll":
      return transition.direction ? `Scroll ${transition.direction}` : "Scroll";
    case "back":
      return "Back";
    case "manual":
      return "Manual transition";
  }
}

function nonReplayableReason(transition: ObservedTransition): string | undefined {
  if (transition.kind === "manual") return "was observed manually";
  if ((transition.kind === "tap" || transition.kind === "type") && !transition.target)
    return `has no ${transition.kind} target`;
  if (transition.kind === "type" && transition.text === undefined) return "has no text value";
  if (transition.kind === "scroll" && !transition.direction) return "has no scroll direction";
  return undefined;
}

function sameTransition(left: CanvasTransition, right: CanvasTransition): boolean {
  return (
    left.fromScreenId === right.fromScreenId &&
    left.destination.kind === right.destination.kind &&
    (left.destination.kind === "end" ||
      (right.destination.kind === "screen" &&
        left.destination.screenId === right.destination.screenId)) &&
    left.label === right.label &&
    left.kind === right.kind
  );
}

/**
 * Convert a discovery observation into the canonical App Map topology.
 *
 * Observations deliberately become `needs-recording` edges with no recipe
 * step ids. Discovery can prove that a path was seen, but it cannot claim the
 * stable executable actions required by the Flow runner.
 */
export function importDiscoveryAppMap(
  session: DiscoverySession,
  existingGraph: CanvasGraph = emptyGraph(),
): DiscoveryAppMapImportResult {
  const graph = cloneGraph(existingGraph);
  const warnings: DiscoveryAppMapImportWarning[] = [];
  const observedById = new Map(session.screens.map((screen) => [screen.id, screen]));
  const validScreens = session.screens.filter((screen) => {
    if (stableFingerprint(screen).length > 0) return true;
    warnings.push({
      code: "missing-screen-fingerprint",
      message: `Screen "${screen.id}" has no stable fingerprint and was not imported.`,
      sessionId: session.id,
      screenId: screen.id,
    });
    return false;
  });

  const screensByFingerprint = new Map<string, ObservedScreen[]>();
  for (const screen of validScreens) {
    const fingerprint = stableFingerprint(screen);
    const duplicates = screensByFingerprint.get(fingerprint) ?? [];
    duplicates.push(screen);
    screensByFingerprint.set(fingerprint, duplicates);
  }

  const canonicalByObservedId = new Map<string, string>();
  const importedScreens: CanvasScreen[] = [];
  const existingByFingerprint = new Map(
    graph.screens.flatMap((screen) => {
      const fingerprints = [
        screen.identity?.fingerprint,
        ...(screen.identity?.aliases ?? []),
        ...(screen.observations ?? []).map((observation) => observation.fingerprint),
      ].filter((value): value is string => Boolean(value));
      return fingerprints.map((fingerprint) => [fingerprint, screen] as const);
    }),
  );
  for (const [fingerprint, observations] of [...screensByFingerprint].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const ordered = observations.toSorted(compareObserved);
    const known = existingByFingerprint.get(fingerprint);
    const existing = known
      ? (graph.screens.find((screen) => screen.id === known.id) ?? known)
      : undefined;
    const id = existing?.id ?? canonicalDiscoveryScreenId(fingerprint);
    for (const observation of observations) canonicalByObservedId.set(observation.id, id);
    const screenObservations = ordered.map((observation) => ({
      id: `discovery-observation:${encodeURIComponent(session.id)}:${encodeURIComponent(observation.id)}`,
      fingerprint: stableFingerprint(observation),
      capturedAt: observation.capturedAt,
      source: "discovery" as const,
      externalId: observation.id,
      sessionId: session.id,
      deviceId: session.targetId,
      ...(session.targetProfile?.platform ? { platform: session.targetProfile.platform } : {}),
      ...(observation.snapshotDigest ? { snapshotDigest: observation.snapshotDigest } : {}),
    }));
    if (existing) {
      const knownObservationIds = new Set(
        (existing.observations ?? []).map((observation) => observation.id),
      );
      const merged: CanvasScreen = {
        ...existing,
        identity: existing.identity ?? {
          schemaVersion: 1,
          fingerprint,
          ...(ordered[0]?.identity?.aliases?.length
            ? { aliases: [...ordered[0].identity.aliases].sort() }
            : {}),
        },
        observations: [
          ...(existing.observations ?? []),
          ...screenObservations.filter((observation) => !knownObservationIds.has(observation.id)),
        ],
        updatedAt: Math.max(existing.updatedAt, ordered.at(-1)!.capturedAt),
      };
      graph.screens = graph.screens.map((screen) => (screen.id === existing.id ? merged : screen));
      existingByFingerprint.set(fingerprint, merged);
      continue;
    }
    importedScreens.push({
      id,
      title: firstNonEmptyTitle(ordered),
      identity: {
        schemaVersion: 1,
        fingerprint,
        ...(ordered[0]?.identity?.aliases?.length
          ? { aliases: [...ordered[0].identity.aliases].sort() }
          : {}),
      },
      observations: screenObservations,
      createdAt: ordered[0]!.capturedAt,
      updatedAt: ordered.at(-1)!.capturedAt,
    });
  }

  const existingScreenIds = new Set(graph.screens.map((screen) => screen.id));
  for (const screen of importedScreens.toSorted(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )) {
    if (!existingScreenIds.has(screen.id)) {
      graph.screens.push(screen);
      existingScreenIds.add(screen.id);
    }
  }

  const orderedTransitions = session.transitions.toSorted(compareObserved);
  const acceptedTransitions: Array<{
    observed: ObservedTransition;
    fromScreenId: string;
    toScreenId: string;
  }> = [];

  for (const observed of orderedTransitions) {
    const sourceObservation = observedById.get(observed.fromScreenId);
    const fromScreenId = canonicalByObservedId.get(observed.fromScreenId);
    if (!sourceObservation || !fromScreenId) {
      warnings.push({
        code: "missing-transition-source",
        message: `Transition "${observed.id}" references a source screen that was not imported.`,
        sessionId: session.id,
        transitionId: observed.id,
        screenId: observed.fromScreenId,
      });
      continue;
    }

    if (!observed.toScreenId) {
      warnings.push({
        code: "missing-transition-destination",
        message: `Transition "${observed.id}" has no observed destination and was not imported.`,
        sessionId: session.id,
        transitionId: observed.id,
      });
      continue;
    }

    const toScreenId = canonicalByObservedId.get(observed.toScreenId);
    if (!toScreenId) {
      warnings.push({
        code: "missing-transition-destination",
        message: `Transition "${observed.id}" references a destination screen that was not imported.`,
        sessionId: session.id,
        transitionId: observed.id,
        screenId: observed.toScreenId,
      });
      continue;
    }

    acceptedTransitions.push({ observed, fromScreenId, toScreenId });
  }

  const seenDirectedPairs = new Set<string>();
  const existingTransitions = new Map(
    graph.transitions.map((transition) => [transition.id, transition]),
  );
  for (const { observed, fromScreenId, toScreenId } of acceptedTransitions) {
    const reason = nonReplayableReason(observed);
    if (reason) {
      warnings.push({
        code: "non-replayable-transition",
        message: `Transition "${observed.id}" ${reason}; import it as topology and record it before replay.`,
        sessionId: session.id,
        transitionId: observed.id,
      });
    }

    const reversePair = `${toScreenId}\u0000${fromScreenId}`;
    const transition: CanvasTransition = {
      id: canonicalTransitionId(session.id, observed.id),
      fromScreenId,
      destination: { kind: "screen", screenId: toScreenId },
      stepIds: [],
      mode: "interaction",
      provenance: { source: "discovery", externalId: observed.id, sessionId: session.id },
      label: transitionLabel(observed),
      state: "needs-recording",
      kind: observed.kind === "back" || seenDirectedPairs.has(reversePair) ? "return" : "forward",
      createdAt: observed.capturedAt,
      updatedAt: observed.capturedAt,
    };
    seenDirectedPairs.add(`${fromScreenId}\u0000${toScreenId}`);

    const existing = existingTransitions.get(transition.id);
    if (!existing) {
      graph.transitions.push(transition);
      existingTransitions.set(transition.id, transition);
    } else if (!sameTransition(existing, transition)) {
      warnings.push({
        code: "conflicting-transition",
        message: `Transition "${observed.id}" conflicts with an existing imported transition and was left unchanged.`,
        sessionId: session.id,
        transitionId: observed.id,
      });
    }
  }

  const firstObservedScreen = session.screens[0];
  const startScreenId = firstObservedScreen
    ? canonicalByObservedId.get(firstObservedScreen.id)
    : undefined;
  if (startScreenId) {
    const flowId = canonicalFlowId(session.id);
    if (!graph.flows.some((flow) => flow.id === flowId)) {
      graph.flows.push({
        id: flowId,
        name: session.name.trim() || "Discovery flow",
        screenId: startScreenId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
  } else if (session.screens.length > 0) {
    warnings.push({
      code: "missing-flow-start",
      message:
        "The first observed screen has no canonical identity, so no flow start was imported.",
      sessionId: session.id,
      ...(firstObservedScreen ? { screenId: firstObservedScreen.id } : {}),
    });
  }

  return { graph, warnings };
}

export const discoverySessionToCanvasGraph = importDiscoveryAppMap;
