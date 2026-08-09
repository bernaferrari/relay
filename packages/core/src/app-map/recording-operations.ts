import { createHash } from "node:crypto";
import type {
  AuthoringAction,
  AuthoringCommitDestination,
  AuthoringObservation,
  AuthoringTarget,
  ScreenIdentityObservation,
  TargetProfile,
} from "@relay/protocol";
import { observeScreenIdentity } from "../screen-identity.js";
import type { SnapshotNode } from "../device.js";
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

export type AppMapScreenCaptureInput = {
  target: AuthoringTarget;
  targetProfile?: TargetProfile;
  observation: AuthoringObservation;
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
  title?: string;
  position?: { x: number; y: number };
};

export type AppMapScreenCaptureResult = {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  created: boolean;
};

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

function screenOwnsFingerprint(map: AppMap, fingerprint: string, screenId: string): boolean {
  const owner = Object.values(map.screens).find(
    (screen) =>
      screen.identity?.fingerprint === fingerprint ||
      screen.identity?.aliases?.includes(fingerprint),
  );
  return !owner || owner.id === screenId;
}

export function findAppMapCaptureScreen(
  map: AppMap,
  input: AppMapScreenCaptureInput,
): Screen | undefined {
  const title = input.title?.trim();
  if (title) {
    const named = Object.values(map.screens).find((screen) => screen.title === title);
    if (named) return named;
  }
  return findObservedScreen(map, input.observation);
}

function semanticObservation(
  observation?: AuthoringObservation,
): ScreenIdentityObservation | undefined {
  if (!observation?.nodes?.length) return undefined;
  return observeScreenIdentity(observation.nodes.slice(0, 256) as SnapshotNode[]);
}

function targetProfile(
  target: AuthoringTarget,
  at: number,
  supplied?: TargetProfile,
  observation?: AuthoringObservation,
): TargetProfile {
  if (supplied) {
    return {
      ...structuredClone(supplied),
      ...(!supplied.viewport && observation?.bounds ? { viewport: { ...observation.bounds } } : {}),
      observedAt: at,
    };
  }
  const source = target.kind === "browser" ? "browser" : "device";
  return {
    id: `${source}:${target.targetId}`,
    targetId: target.targetId,
    source,
    platform: target.platform,
    name: target.targetId,
    capabilities: [],
    ...(observation?.bounds ? { viewport: { ...observation.bounds } } : {}),
    observedAt: at,
  };
}

function observeScreen(input: {
  map: AppMap;
  screen: Screen;
  observation?: AuthoringObservation;
  target: AuthoringTarget;
  targetProfile?: TargetProfile;
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
  at: number;
}): void {
  const { map, screen, observation, at } = input;
  if (!observation) return;
  const fingerprint = observation.screen.fingerprint;
  const semanticFingerprint = semanticObservation(observation)?.fingerprint;
  const aliases = new Set(screen.identity?.aliases ?? []);
  for (const candidate of [fingerprint, semanticFingerprint]) {
    if (!candidate || !screenOwnsFingerprint(map, candidate, screen.id)) continue;
    if (!screen.identity) {
      screen.identity = { schemaVersion: 1, fingerprint: candidate };
      continue;
    }
    if (screen.identity.fingerprint !== candidate) aliases.add(candidate);
  }
  if (screen.identity && aliases.size) screen.identity.aliases = [...aliases].sort();
  screen.updatedAt = at;

  const profile = targetProfile(input.target, at, input.targetProfile, observation);
  const existing = screen.variantIds
    .map((id) => map.screenVariants[id])
    .find((variant) => variant?.targetProfile.id === profile.id);
  const variantId = existing?.id ?? stableId("variant", `${screen.id}:${profile.id}`);
  const evidenceIds = [...new Set([...(existing?.evidenceIds ?? []), ...observation.evidenceIds])];
  const evidenceUris = [
    ...new Set([
      ...(existing?.evidenceUris ?? []),
      ...observation.evidenceIds.flatMap((id) => {
        const uri = input.evidenceUrisById?.[id];
        return uri ? [uri] : [];
      }),
    ]),
  ];
  const screenshotUri = observation.evidenceIds.flatMap((id) => {
    if (input.evidenceKindsById?.[id] !== "screenshot") return [];
    const uri = input.evidenceUrisById?.[id];
    return uri ? [uri] : [];
  })[0];
  const semantics = semanticObservation(observation);
  const variant: ScreenVariant = {
    ...entityScope(map),
    id: variantId,
    screenId: screen.id,
    targetProfile: profile,
    observation: {
      fingerprint: semantics?.fingerprint ?? fingerprint,
      nodes: semantics?.nodes ?? [],
      volatileSignals: semantics?.volatileSignals ?? [],
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

/** Persist one observed app state without inventing an executable transition.
 * This is the canonical boundary used by the canvas, CLI, and agents when
 * they save the current device screen to an App Map. */
export function commitAppMapScreenCapture(
  value: AppMap,
  input: AppMapScreenCaptureInput,
  context: AppMapMutationContext,
): AppMapScreenCaptureResult {
  const existing = findAppMapCaptureScreen(value, input);
  const screenId =
    existing?.id ?? stableId("screen", `${value.id}:${input.observation.screen.fingerprint}`);
  const created = !existing;
  const appMap = mutateAppMap(
    value,
    context,
    {
      eventType: created ? "screen.added" : "screen.updated",
      subject: { kind: "screen", id: screenId },
      summary: created ? "Captured a screen" : "Refreshed a captured screen",
    },
    (map) => {
      const screen =
        map.screens[screenId] ??
        createScreen(
          map,
          screenId,
          input.title?.trim() ||
            (Object.keys(map.screens).length === 0
              ? "Start"
              : `Screen ${Object.keys(map.screens).length + 1}`),
          context.at,
        );
      if (created && input.position) screen.position = structuredClone(input.position);
      observeScreen({
        map,
        screen,
        observation: input.observation,
        target: input.target,
        ...(input.targetProfile ? { targetProfile: input.targetProfile } : {}),
        ...(input.evidenceUrisById ? { evidenceUrisById: input.evidenceUrisById } : {}),
        ...(input.evidenceKindsById ? { evidenceKindsById: input.evidenceKindsById } : {}),
        at: context.at,
      });
      if (Object.keys(map.flows).length === 0) {
        const flowId = stableId("flow", `${map.id}:main`);
        map.flows[flowId] = {
          ...entityScope(map),
          id: flowId,
          name: "Main flow",
          startScreenId: screen.id,
          connectionIds: [],
          createdAt: context.at,
          updatedAt: context.at,
        };
      }
    },
  );
  const screen = appMap.screens[screenId]!;
  const profile = targetProfile(input.target, context.at, input.targetProfile);
  const variantId = screen.variantIds.find(
    (id) => appMap.screenVariants[id]?.targetProfile.id === profile.id,
  );
  if (!variantId) appMapFail("invalid-map", `Captured screen ${screenId} has no target variant`);
  return { appMap, screenId, variantId, created };
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

function humanizeIdentifier(identifier: string): string {
  const ignored = new Set(["ask", "toolbar", "button", "view", "control", "action"]);
  const words = identifier
    .split(/[._-]+/)
    .filter((word) => word && !ignored.has(word.toLowerCase()));
  const phrase = words.at(-1) ?? identifier;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function recordedConnectionLabel(input: AppMapRecordingInput, actions: ActionSpec[]): string {
  if (actions[0]?.kind === "passive") return "Observe";
  const steps = input.actions.flatMap((action) => action.steps);
  const reversed = [...steps].reverse();
  const tap = reversed.find((step) => step.kind === "tap");
  if (tap?.kind === "tap") {
    const target = tap.target.label ?? tap.target.text ?? tap.target.identifier;
    if (target) {
      if (/send(?:[._-]|$)/i.test(target)) return "Send message";
      return tap.target.identifier && target === tap.target.identifier
        ? humanizeIdentifier(target)
        : target;
    }
  }
  const key = reversed.find((step) => step.kind === "key");
  if (key?.kind === "key") return key.key === "back" ? "Go back" : "Go home";
  const app = reversed.find((step) => step.kind === "app");
  if (app?.kind === "app" && app.action === "open") return `Open ${app.app ?? "app"}`;
  if (steps.some((step) => step.kind === "type")) return "Enter text";
  if (steps.some((step) => step.kind === "swipe" || step.kind === "scroll")) return "Scroll";
  return "Continue";
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
        target: input.target,
        evidenceUrisById: input.evidenceUrisById,
        evidenceKindsById: input.evidenceKindsById,
        at: context.at,
      });

      const requestedDestination = input.destination;
      let destination: Connection["destination"];
      if (requestedDestination?.kind === "end") {
        destination = { kind: "end" };
      } else {
        const forceNewScreen = requestedDestination?.kind === "new-screen";
        const requestedDestinationId =
          requestedDestination?.kind === "screen"
            ? requestedDestination.screenId
            : !forceNewScreen && pending?.destination.kind === "screen"
              ? pending.destination.screenId
              : undefined;
        // new-screen is an explicit operator decision: do not merge into a
        // parent that is still visible behind a sheet or overlay.
        let screen = requestedDestinationId
          ? map.screens[requestedDestinationId]
          : forceNewScreen
            ? undefined
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
        observeScreen({
          map,
          screen,
          observation: input.after,
          target: input.target,
          evidenceUrisById: input.evidenceUrisById,
          evidenceKindsById: input.evidenceKindsById,
          at: context.at,
        });
        destination = { kind: "screen", screenId: screen.id };
      }

      const actions = recordedActions(input);
      const connection: Connection = {
        ...entityScope(map),
        id: connectionId,
        fromScreenId: source.id,
        destination,
        label: pending?.label ?? recordedConnectionLabel(input, actions),
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
