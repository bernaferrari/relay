import { createHash } from "node:crypto";
import type {
  AuthoringAction,
  AuthoringCommitDestination,
  AuthoringObservation,
  AuthoringTarget,
  NormalizedSemanticNode,
  TargetProfile,
} from "@relay/protocol";
import type {
  ActionSpec,
  AppMap,
  AppMapMutationContext,
  Connection,
  Flow,
  Screen,
  ScreenVariant,
} from "./model.js";
import { appMapFail } from "./errors.js";
import { mutateAppMap } from "./mutation.js";

export type AppMapRecordingInput = {
  sessionId: string;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  destination?: AuthoringCommitDestination;
  target: AuthoringTarget;
  takeId: string;
  takeRevision: number;
  actions: AuthoringAction[];
  before?: AuthoringObservation;
  after?: AuthoringObservation;
  evidenceIds: string[];
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
};

export type AppMapRecordingResult = { appMap: AppMap; connectionId: string };

function stableId(prefix: string, seed: string): string {
  return `${prefix}-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function entityScope(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
}

function findObservedScreen(map: AppMap, observation?: AuthoringObservation): Screen | undefined {
  const fingerprint = observation?.screen.fingerprint;
  if (!fingerprint) return undefined;
  return Object.values(map.screens).find(
    (screen) =>
      screen.identity?.fingerprint === fingerprint ||
      screen.identity?.aliases?.includes(fingerprint),
  );
}

function semanticNodes(observation?: AuthoringObservation): NormalizedSemanticNode[] {
  return (observation?.nodes ?? []).slice(0, 256).map((value) => ({
    role: typeof value.role === "string" && value.role.trim() ? value.role : "unknown",
    ...(typeof value.label === "string" ? { label: value.label } : {}),
    ...(typeof value.value === "string" ? { value: value.value } : {}),
    ...(typeof value.identifier === "string" ? { identifier: value.identifier } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(typeof value.selected === "boolean" ? { selected: value.selected } : {}),
    ...(typeof value.focused === "boolean" ? { focused: value.focused } : {}),
    ...(typeof value.hittable === "boolean" ? { hittable: value.hittable } : {}),
    ...(typeof value.depth === "number" && Number.isFinite(value.depth)
      ? { depth: value.depth }
      : {}),
  }));
}

function targetProfile(input: AppMapRecordingInput, at: number): TargetProfile {
  const source = input.target.kind === "browser" ? "browser" : "device";
  return {
    id: stableId("target", `${input.target.platform}:${input.target.targetId}`),
    targetId: input.target.targetId,
    source,
    platform: input.target.platform,
    name: input.target.targetId,
    capabilities: [],
    observedAt: at,
  };
}

function observeScreen(input: {
  map: AppMap;
  screen: Screen;
  observation?: AuthoringObservation;
  recording: AppMapRecordingInput;
  at: number;
}): void {
  const { map, screen, observation, recording, at } = input;
  if (!observation) return;
  const fingerprint = observation.screen.fingerprint;
  const aliases = new Set(screen.identity?.aliases ?? []);
  if (screen.identity && screen.identity.fingerprint !== fingerprint) aliases.add(fingerprint);
  screen.identity = screen.identity ?? { schemaVersion: 1, fingerprint };
  if (aliases.size) screen.identity.aliases = [...aliases].sort();
  screen.updatedAt = at;

  const profile = targetProfile(recording, at);
  const existing = screen.variantIds
    .map((id) => map.screenVariants[id])
    .find((variant) => variant?.targetProfile.id === profile.id);
  const variantId = existing?.id ?? stableId("variant", `${screen.id}:${profile.id}`);
  const evidenceIds = [...new Set([...(existing?.evidenceIds ?? []), ...observation.evidenceIds])];
  const evidenceUris = [
    ...new Set([
      ...(existing?.evidenceUris ?? []),
      ...observation.evidenceIds.flatMap((id) => {
        const uri = recording.evidenceUrisById?.[id];
        return uri ? [uri] : [];
      }),
    ]),
  ];
  const screenshotUri = observation.evidenceIds.flatMap((id) => {
    if (recording.evidenceKindsById?.[id] !== "screenshot") return [];
    const uri = recording.evidenceUrisById?.[id];
    return uri ? [uri] : [];
  })[0];
  const variant: ScreenVariant = {
    ...entityScope(map),
    id: variantId,
    screenId: screen.id,
    targetProfile: profile,
    observation: {
      fingerprint,
      nodes: semanticNodes(observation),
      volatileSignals: [],
    },
    evidenceIds,
    ...(evidenceUris.length ? { evidenceUris } : {}),
    ...(screenshotUri || existing?.screenshotUri
      ? { screenshotUri: screenshotUri ?? existing!.screenshotUri }
      : {}),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(existing?.baseline ? { baseline: structuredClone(existing.baseline) } : {}),
  };
  map.screenVariants[variant.id] = variant;
  screen.variantIds = [...new Set([...screen.variantIds, variant.id])].sort();
}

function createScreen(map: AppMap, id: string, title: string, at: number): Screen {
  const screen: Screen = {
    ...entityScope(map),
    id,
    title,
    variantIds: [],
    createdAt: at,
    updatedAt: at,
  };
  map.screens[id] = screen;
  return screen;
}

function observedDestinationTitle(input: AppMapRecordingInput): string | undefined {
  const navigationTitles = (input.after?.nodes ?? [])
    .flatMap((node, index) => {
      const role =
        typeof node.role === "string" ? node.role : typeof node.type === "string" ? node.type : "";
      if (!/navigation\s*bar|header/i.test(role)) return [];
      const depth = typeof node.depth === "number" && Number.isFinite(node.depth) ? node.depth : 0;
      const title =
        typeof node.identifier === "string" && node.identifier.trim()
          ? node.identifier.trim()
          : typeof node.label === "string" && node.label.trim()
            ? node.label.trim()
            : undefined;
      return title ? [{ title, depth, index }] : [];
    })
    .sort((left, right) => right.depth - left.depth || right.index - left.index);
  const observed = navigationTitles[0]?.title;
  if (observed) return observed;

  for (const action of [...input.actions].reverse()) {
    for (const step of [...action.steps].reverse()) {
      if (step.kind !== "tap") continue;
      const title = step.target.label?.trim() || step.target.text?.trim();
      if (title) return title;
    }
  }
  return undefined;
}

function flowTerminal(map: AppMap, flow: Flow): string | "end" {
  let terminal: string | "end" = flow.startScreenId;
  for (const connectionId of flow.connectionIds) {
    const destination = map.connections[connectionId]!.destination;
    terminal = destination.kind === "end" ? "end" : destination.screenId;
  }
  return terminal;
}

function flowPrefixToScreen(map: AppMap, flow: Flow, screenId: string): string[] | null {
  if (flow.startScreenId === screenId) return [];
  const prefix: string[] = [];
  for (const connectionId of flow.connectionIds) {
    const connection = map.connections[connectionId];
    if (!connection) return null;
    prefix.push(connectionId);
    if (connection.destination.kind === "end") return null;
    if (connection.destination.screenId === screenId) return prefix;
  }
  return null;
}

function attachToFlow(map: AppMap, sourceScreenId: string, connectionId: string, at: number): void {
  const existing = Object.values(map.flows).find((flow) =>
    flow.connectionIds.includes(connectionId),
  );
  if (existing) return;
  const continuable = Object.values(map.flows).filter(
    (flow) => flowTerminal(map, flow) === sourceScreenId,
  );
  const flow = continuable.length === 1 ? continuable[0] : undefined;
  if (flow) {
    flow.connectionIds.push(connectionId);
    flow.updatedAt = at;
    return;
  }
  const parent = Object.values(map.flows)
    .flatMap((candidate) => {
      const prefix = flowPrefixToScreen(map, candidate, sourceScreenId);
      return prefix ? [{ flow: candidate, prefix }] : [];
    })
    .sort(
      (left, right) =>
        left.flow.createdAt - right.flow.createdAt || left.flow.id.localeCompare(right.flow.id),
    )[0];
  const id = stableId("flow", `${connectionId}:${sourceScreenId}`);
  map.flows[id] = {
    ...entityScope(map),
    id,
    name:
      Object.keys(map.flows).length === 0
        ? "Main flow"
        : `Flow ${Object.keys(map.flows).length + 1}`,
    startScreenId: parent?.flow.startScreenId ?? sourceScreenId,
    connectionIds: [...(parent?.prefix ?? []), connectionId],
    createdAt: at,
    updatedAt: at,
  };
}

function recordedActions(input: AppMapRecordingInput): ActionSpec[] {
  const steps = input.actions
    .flatMap((action) => action.steps)
    .map((step) => structuredClone(step));
  if (steps.length === 0) {
    return [{ id: `passive-${input.takeId}`, kind: "passive", reason: "observe-only" }];
  }
  return [
    {
      id: `recording-${input.takeId}`,
      kind: "recorded",
      takeId: input.takeId,
      takeRevision: input.takeRevision,
      steps,
      evidenceIds: [...new Set(input.evidenceIds)],
    },
  ];
}

export function commitAppMapRecording(
  value: AppMap,
  input: AppMapRecordingInput,
  context: AppMapMutationContext,
): AppMapRecordingResult {
  const connectionId =
    input.pendingConnectionId ?? stableId("connection", `${value.id}:${input.sessionId}`);
  const appMap = mutateAppMap(
    value,
    context,
    {
      eventType: "recording.committed",
      subject: { kind: "connection", id: connectionId },
      summary: "Committed a reviewed recording",
    },
    (map) => {
      const pending = input.pendingConnectionId
        ? map.connections[input.pendingConnectionId]
        : undefined;
      if (input.pendingConnectionId && !pending) {
        appMapFail("missing-reference", "Pending connection no longer exists");
      }
      const requestedSourceId = input.sourceScreenId ?? pending?.fromScreenId;
      let source = requestedSourceId
        ? map.screens[requestedSourceId]
        : findObservedScreen(map, input.before);
      if (requestedSourceId && !source) {
        appMapFail("missing-reference", "Source screen no longer exists");
      }
      source ??= createScreen(
        map,
        stableId("screen", `${input.sessionId}:source`),
        "Start",
        context.at,
      );
      observeScreen({
        map,
        screen: source,
        observation: input.before,
        recording: input,
        at: context.at,
      });

      const requestedDestination = input.destination;
      let destination: Connection["destination"];
      if (requestedDestination?.kind === "end") {
        destination = { kind: "end" };
      } else {
        const requestedDestinationId =
          requestedDestination?.kind === "screen"
            ? requestedDestination.screenId
            : pending?.destination.kind === "screen"
              ? pending.destination.screenId
              : undefined;
        let screen = requestedDestinationId
          ? map.screens[requestedDestinationId]
          : findObservedScreen(map, input.after);
        if (requestedDestinationId && !screen) {
          appMapFail("missing-reference", "Destination screen no longer exists");
        }
        if (!screen) {
          screen = createScreen(
            map,
            stableId("screen", `${input.sessionId}:destination`),
            requestedDestination?.kind === "new-screen" && requestedDestination.title?.trim()
              ? requestedDestination.title.trim()
              : (observedDestinationTitle(input) ?? "Next screen"),
            context.at,
          );
          const sourceGroup = Object.values(map.groups).find((group) =>
            group.screenIds.includes(source.id),
          );
          if (sourceGroup) {
            sourceGroup.screenIds = [...new Set([...sourceGroup.screenIds, screen.id])];
            sourceGroup.updatedAt = context.at;
          }
        }
        observeScreen({ map, screen, observation: input.after, recording: input, at: context.at });
        destination = { kind: "screen", screenId: screen.id };
      }

      const actions = recordedActions(input);
      const connection: Connection = {
        ...entityScope(map),
        id: connectionId,
        fromScreenId: source.id,
        destination,
        label: pending?.label ?? (actions[0]?.kind === "passive" ? "Observe" : "Continue"),
        state: "ready",
        actions,
        createdAt: pending?.createdAt ?? context.at,
        updatedAt: context.at,
      };
      map.connections[connection.id] = connection;
      attachToFlow(map, source.id, connection.id, context.at);
    },
  );
  return { appMap, connectionId };
}
