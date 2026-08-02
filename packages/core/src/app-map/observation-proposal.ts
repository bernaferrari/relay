import type {
  ActionSpec,
  AppMap,
  AppMapScope,
  DiscoverySession,
  ObservedTransition,
  Proposal,
  ProposalChange,
  ScreenVariant,
} from "@relay/protocol";

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

function matchingScreenId(map: AppMap, fingerprint: string): string | undefined {
  return Object.values(map.screens).find(
    (screen) =>
      screen.identity?.fingerprint === fingerprint ||
      screen.identity?.aliases?.includes(fingerprint),
  )?.id;
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

  const screenIds = new Map<string, string>();
  const changes: ProposalChange[] = [];
  for (const [index, screen] of session.screens.entries()) {
    const existingId = matchingScreenId(map, screen.fingerprint);
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
          title: screen.title?.trim() || `Observed screen ${index + 1}`,
          identity: screen.identity ?? { schemaVersion: 1, fingerprint: screen.fingerprint },
          position: { x: 80 + (index % 4) * 300, y: 100 + Math.floor(index / 4) * 420 },
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
    const value = {
      fromScreenId,
      destination: { kind: "screen" as const, screenId: destinationId },
      ...(transition.label?.trim() ? { label: transition.label.trim() } : {}),
      state: "draft" as const,
      actions: [actionFor(transition)],
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
    description: `${session.targetProfile?.name ?? session.targetId} observed ${transitions.length} transition${transitions.length === 1 ? "" : "s"}. Review before adding them to the map.`,
    status: "pending",
    baseRevision: map.revision,
    changes,
    createdAt: at,
    updatedAt: at,
  };
}
