import { createHash } from "node:crypto";
import type {
  AuthoringAction,
  AuthoringCaptureReview,
  AuthoringCommitDestination,
  AuthoringEvidence,
  AuthoringObservation,
  AuthoringTarget,
  ScreenIdentityObservation,
  TargetProfile,
} from "@relay/protocol";
import { hasCurrentAuthoringSemantics } from "../authoring-observation-proof.js";
import { observeScreenIdentity } from "../screen-identity.js";
import type { SnapshotNode } from "../device.js";
import type {
  ActionSpec,
  AppMap,
  AppMapMutationContext,
  Connection,
  Flow,
  Proposal,
  Screen,
  ScreenVariant,
} from "./model.js";
import type { AppMapScreenVariantCaptureInput } from "./screen-operations.js";
import { appMapFail } from "./errors.js";
import { mutateAppMap } from "./mutation.js";
import { attachRecordedTest } from "./recorded-test.js";
import { recordingSourceForCommit } from "./recording-source.js";
import { recordedSourceAnchor } from "./recording-source-anchor.js";

export type AppMapRecordingInput = {
  sessionId: string;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  destination?: AuthoringCommitDestination;
  target: AuthoringTarget;
  takeId: string;
  takeRevision: number;
  actions: AuthoringAction[];
  observations?: AuthoringObservation[];
  before?: AuthoringObservation;
  after?: AuthoringObservation;
  evidenceIds: string[];
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
  evidenceById?: Record<string, AuthoringEvidence>;
  /** Stable id prepared by the Authoring Session before its atomic commit. */
  testId?: string;
  /** Canonical reviewed Test name, required whenever testId is present. */
  testName?: string;
  /** Explicit package/bundle selected during recording setup. */
  originApplication?: string;
  /** Server-reviewed capture origin. It never changes the executable steps. */
  captureReview?: AuthoringCaptureReview;
  /** Frozen runtime identity. Browser recordings must include a case profile. */
  targetProfile?: TargetProfile;
};

export type AppMapRecordingResult = { appMap: AppMap; connectionId: string; testId?: string };

export type AppMapScreenCaptureInput = {
  target: AuthoringTarget;
  targetProfile?: TargetProfile;
  observation: AuthoringObservation;
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
  evidenceById?: Record<string, AuthoringEvidence>;
  title?: string;
  handoff?: NonNullable<Screen["handoff"]>;
  position?: { x: number; y: number };
};

export type AppMapScreenCaptureResult = {
  appMap: AppMap;
  screenId: string;
  variantId: string;
  created: boolean;
};

/** A changed semantic capture is kept outside the approved map until someone
 * compares its pixels and accessibility snapshot with the current variant. */
export type AppMapScreenCaptureReview = {
  proposal: Proposal;
  screenId: string;
  currentVariant: ScreenVariant;
  proposedVariant: ScreenVariant;
};

function stableId(prefix: string, seed: string): string {
  return `${prefix}-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

function entityScope(map: AppMap) {
  return { organizationId: map.organizationId, projectId: map.projectId, appMapId: map.id };
}

function findObservedScreen(map: AppMap, observation?: AuthoringObservation): Screen | undefined {
  const semantic =
    hasCurrentAuthoringSemantics(observation?.proof) && (observation?.nodes?.length ?? 0) >= 5
      ? semanticObservation(observation)?.fingerprint
      : undefined;
  const fingerprints = [observation?.screen.fingerprint, semantic].filter(
    (value): value is string => Boolean(value),
  );
  if (!fingerprints.length) return undefined;
  return Object.values(map.screens).find((screen) =>
    fingerprints.some(
      (fingerprint) =>
        screen.identity?.fingerprint === fingerprint ||
        screen.identity?.aliases?.includes(fingerprint),
    ),
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

function observationLikelyMatchesTitle(
  observation: AuthoringObservation | undefined,
  title: string,
): boolean {
  // A stale tree often contains the previous sheet's sidebar/title. It is
  // useful for diagnostics but must not merge a visually new capture into an
  // existing named screen.
  if (observation?.proof && !hasCurrentAuthoringSemantics(observation.proof)) return false;
  const words = title
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 4);
  if (!words.length) return false;
  const visibleText = (observation?.nodes ?? [])
    .filter((node) => node.visibleToUser !== false)
    .flatMap((node) => [node.label, node.identifier, node.value])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
  // An explicit title is useful to merge a new orientation into a known
  // screen, but only when the fresh observation itself supports that title.
  // This rejects stale iOS sidebar controls that remain in the tree after a
  // different sheet is visually on screen.
  return words.every((word) => visibleText.includes(word));
}

function hasAlternateOrientationVariant(
  map: AppMap,
  screen: Screen,
  profile: TargetProfile | undefined,
): boolean {
  const viewport = profile?.viewport;
  if (!viewport || !profile?.targetId || viewport.width === viewport.height) return false;
  const portrait = viewport.height > viewport.width;
  return screen.variantIds.some((variantId) => {
    const candidate = map.screenVariants[variantId]?.targetProfile;
    const candidateViewport = candidate?.viewport;
    return (
      candidate?.targetId === profile.targetId &&
      candidate?.platform === profile.platform &&
      candidateViewport !== undefined &&
      candidateViewport.width !== candidateViewport.height &&
      candidateViewport.height > candidateViewport.width !== portrait
    );
  });
}

export function findAppMapCaptureScreen(
  map: AppMap,
  input: AppMapScreenCaptureInput,
): Screen | undefined {
  // A title is user-facing annotation, not an identity key.  Reusing a screen
  // merely because a teach request named its desired destination allowed a
  // stale iOS accessibility control to overwrite the real Settings screen
  // with whatever transient surface happened to appear after the tap.
  const title = input.title?.trim();
  if (title) {
    const named = Object.values(map.screens).find((screen) => screen.title === title);
    // A pending destination created from a recording has no captured identity
    // yet. Its title is the explicit user intent, so the first capture should
    // fill it. Once a screen has identity evidence, however, a duplicate
    // title must never overwrite it.
    if (
      named &&
      (!named.identity ||
        observationLikelyMatchesTitle(input.observation, title) ||
        hasAlternateOrientationVariant(map, named, input.targetProfile))
    ) {
      return named;
    }
  }
  const observed = findObservedScreen(map, input.observation);
  if (observed) return observed;
  return undefined;
}

function semanticObservation(
  observation?: AuthoringObservation,
): ScreenIdentityObservation | undefined {
  // Snapshot evidence with an explicit stale/unavailable proof cannot become
  // a durable semantic identity or offline selector source. Older recordings
  // have no proof metadata and remain readable until a fresh capture exists.
  if (observation?.proof && !hasCurrentAuthoringSemantics(observation.proof)) return undefined;
  if (!observation?.nodes?.length) return undefined;
  return observeScreenIdentity(observation.nodes.slice(0, 256) as SnapshotNode[]);
}

function targetProfile(
  target: AuthoringTarget,
  at: number,
  supplied?: TargetProfile,
  observation?: AuthoringObservation,
): TargetProfile {
  const profile: TargetProfile = supplied
    ? {
        ...structuredClone(supplied),
        ...(!supplied.viewport && observation?.bounds
          ? { viewport: { ...observation.bounds } }
          : {}),
        observedAt: at,
      }
    : (() => {
        const source: TargetProfile["source"] = target.kind === "browser" ? "browser" : "device";
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
      })();
  if (target.kind === "browser" && !profile.browserCaseProfile) {
    appMapFail(
      "invalid-map",
      "Browser recordings must freeze a complete browser case profile before they can be saved",
    );
  }
  return profile;
}

function recordingCaptureFields(
  input: AppMapRecordingInput,
): Pick<
  AppMapScreenVariantCaptureInput,
  "target" | "targetProfile" | "evidenceUrisById" | "evidenceKindsById" | "evidenceById"
> {
  return {
    target: input.target,
    ...(input.targetProfile ? { targetProfile: input.targetProfile } : {}),
    ...(input.evidenceUrisById ? { evidenceUrisById: input.evidenceUrisById } : {}),
    ...(input.evidenceKindsById ? { evidenceKindsById: input.evidenceKindsById } : {}),
    ...(input.evidenceById ? { evidenceById: input.evidenceById } : {}),
  };
}

export function captureAppMapScreenVariant(
  input: AppMapScreenVariantCaptureInput,
): ScreenVariant | undefined {
  const { map, screen, observation, at } = input;
  if (!observation) return undefined;
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
  const rawAccessibilityTree =
    observation.proof && !hasCurrentAuthoringSemantics(observation.proof)
      ? undefined
      : observation.evidenceIds.flatMap((id) => {
          if (input.evidenceKindsById?.[id] !== "snapshot") return [];
          const uri = input.evidenceUrisById?.[id];
          const sha256 = uri?.match(/^relay-evidence:\/\/([a-f0-9]{64})$/u)?.[1];
          const evidence = input.evidenceById?.[id];
          return uri &&
            sha256 &&
            evidence?.uri === uri &&
            evidence.sha256 === sha256 &&
            evidence.mime === "application/json" &&
            typeof evidence.bytes === "number" &&
            Number.isSafeInteger(evidence.bytes) &&
            evidence.bytes > 0
            ? [
                {
                  id,
                  uri,
                  sha256,
                  mime: "application/json" as const,
                  bytes: evidence.bytes,
                  observationId: observation.id,
                  capturedAt: evidence.capturedAt,
                },
              ]
            : [];
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
    // A raw tree proves geometry only for the observation captured with it.
    // Keeping an old tree when a new observation arrived without a snapshot
    // would let offline preflight prove a stale dialog/row. Omit it instead:
    // validation then asks for one explicit recapture rather than guessing.
    ...(rawAccessibilityTree ? { rawAccessibilityTree } : {}),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(existing?.baseline ? { baseline: structuredClone(existing.baseline) } : {}),
  };
  return variant;
}

function observeScreen(input: {
  map: AppMap;
  screen: Screen;
  observation?: AuthoringObservation;
  target: AuthoringTarget;
  targetProfile?: TargetProfile;
  evidenceUrisById?: Record<string, string>;
  evidenceKindsById?: Record<string, "screenshot" | "snapshot" | "video">;
  evidenceById?: Record<string, AuthoringEvidence>;
  at: number;
}): void {
  const { map, screen } = input;
  if (/^(?:Start|Next screen|Known screen)$/u.test(screen.title)) {
    const title = capturedScreenTitle(input.observation);
    if (title) screen.title = title;
  }
  const variant = captureAppMapScreenVariant(input);
  if (!variant) return;
  map.screenVariants[variant.id] = variant;
  screen.variantIds = [...new Set([...screen.variantIds, variant.id])].sort();
}

/**
 * Build, but do not apply, the reviewable replacement for an existing target
 * variant. Exact semantic refreshes are deliberately not proposals: evidence
 * can accumulate without turning clocks or screenshot compression into work.
 */
export function reviewAppMapScreenCapture(
  map: AppMap,
  input: AppMapScreenCaptureInput,
  context: AppMapMutationContext,
): AppMapScreenCaptureReview | undefined {
  const screen = findAppMapCaptureScreen(map, input);
  if (!screen) return undefined;
  const profile = targetProfile(input.target, context.at, input.targetProfile, input.observation);
  const currentVariant = screen.variantIds
    .map((id) => map.screenVariants[id])
    .find((variant) => variant?.targetProfile.id === profile.id);
  if (!currentVariant) return undefined;

  const proposedVariant = captureAppMapScreenVariant({
    map,
    screen: structuredClone(screen),
    observation: input.observation,
    target: input.target,
    ...(input.targetProfile ? { targetProfile: input.targetProfile } : {}),
    ...(input.evidenceUrisById ? { evidenceUrisById: input.evidenceUrisById } : {}),
    ...(input.evidenceKindsById ? { evidenceKindsById: input.evidenceKindsById } : {}),
    ...(input.evidenceById ? { evidenceById: input.evidenceById } : {}),
    at: context.at,
  });
  if (!proposedVariant) return undefined;
  if (currentVariant.observation?.fingerprint === proposedVariant.observation?.fingerprint) {
    return undefined;
  }

  const proposal: Proposal = {
    ...entityScope(map),
    id: stableId(
      "proposal",
      `${map.id}:capture:${screen.id}:${currentVariant.id}:${proposedVariant.observation?.fingerprint ?? "unknown"}:${context.eventId}`,
    ),
    title: `Review updated screen “${screen.title}”`,
    description:
      "The visible accessibility structure changed. Compare the approved and new captures before replacing it.",
    status: "pending",
    baseRevision: map.revision,
    changes: [
      {
        kind: "screen.update",
        screenId: screen.id,
        input: { patch: {}, upsertVariants: [proposedVariant] },
      },
    ],
    createdAt: context.at,
    updatedAt: context.at,
  };
  return { proposal, screenId: screen.id, currentVariant, proposedVariant };
}

/** Persist one observed app state without inventing an executable transition.
 * This is the canonical boundary used by the canvas, CLI, and agents when
 * they save the current device screen to an App Map. */
export function commitAppMapScreenCapture(
  value: AppMap,
  input: AppMapScreenCaptureInput,
  context: AppMapMutationContext,
  options: { createInitialFlow?: boolean } = {},
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
      if (input.handoff) screen.handoff = structuredClone(input.handoff);
      observeScreen({
        map,
        screen,
        observation: input.observation,
        target: input.target,
        ...(input.targetProfile ? { targetProfile: input.targetProfile } : {}),
        ...(input.evidenceUrisById ? { evidenceUrisById: input.evidenceUrisById } : {}),
        ...(input.evidenceKindsById ? { evidenceKindsById: input.evidenceKindsById } : {}),
        ...(input.evidenceById ? { evidenceById: input.evidenceById } : {}),
        at: context.at,
      });
      if (options.createInitialFlow !== false && Object.keys(map.flows).length === 0) {
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

function capturedScreenTitle(observation?: AuthoringObservation): string | undefined {
  const candidates = (observation?.nodes ?? []).flatMap((node, index) => {
    const role = String(node.role ?? node.type ?? "");
    const identifier = typeof node.identifier === "string" ? node.identifier : "";
    const heading =
      /navigation\s*bar|header|heading/i.test(role) ||
      node.heading === true ||
      node.isHeading === true;
    const parent = observation?.nodes?.find((candidate) => candidate.index === node.parentIndex);
    const parentId = typeof parent?.identifier === "string" ? parent.identifier : "";
    const toolbar =
      /:id\/(?:collapsing_toolbar|(?:custom_)?toolbar_title|action_bar_title)$/u.test(identifier) ||
      /:id\/(?:toolbar|action_bar)$/u.test(parentId);
    if (!heading && !toolbar) return [];
    if (node.bundleId === "com.android.systemui" || node.visibleToUser === false) return [];
    const title = [node.label, node.text, node.value].find(
      (value) => typeof value === "string" && value.trim(),
    ) as string | undefined;
    if (!title || title.length > 120 || /^(?:back|navigate up)$/iu.test(title.trim())) return [];
    return [{ title: title.trim(), rank: toolbar ? 0 : heading ? 1 : 2, index }];
  });
  return candidates.sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.title;
}

function observedDestinationTitle(input: AppMapRecordingInput): string | undefined {
  const observed = capturedScreenTitle(input.after);
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
  if (actions[0]?.kind === "passive") {
    return input.actions.find((action) => action.label?.trim())?.label?.trim() ?? "Observe";
  }
  const active = input.actions.filter((action) => action.steps.length > 0);
  if (active.length === 1 && active[0]!.label?.trim()) return active[0]!.label!.trim();
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
  if (key?.kind === "key") {
    const title = observedDestinationTitle(input);
    if (key.key === "recents") return "Open recent apps";
    return key.key === "back" ? (title ? `Back to ${title}` : "Go back") : "Go home";
  }
  const app = reversed.find((step) => step.kind === "app");
  if (app?.kind === "app" && app.action === "open") return `Open ${app.app ?? "app"}`;
  const typed = reversed.find((step) => step.kind === "type");
  if (typed?.kind === "type") {
    const text = typeof typed.text === "string" ? typed.text.trim() : "";
    const field = [typed.target?.label, typed.target?.identifier, typed.target?.text]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    // Never echo what was typed into a secret field.
    if (!text || /pass|secret|token|otp|code|pin/i.test(field)) return "Type text";
    return `Type “${text.length > 48 ? `${text.slice(0, 47)}…` : text}”`;
  }
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
      const segments = recordingSegments(input);
      const connections: Connection[] = [];
      for (const [index, segment] of segments.entries()) {
        const previous = connections.at(-1);
        if (previous?.destination.kind === "screen")
          segment.sourceScreenId = previous.destination.screenId;
        connections.push(
          applyRecordedConnection(
            map,
            segment,
            context,
            index === 0
              ? connectionId
              : stableId("connection", `${value.id}:${input.sessionId}:${index}`),
          ),
        );
      }
      const connection = connections[0]!;
      const source = map.screens[connection.fromScreenId]!;
      if (input.testId) {
        if (!input.testName?.trim()) {
          appMapFail("invalid-map", "A canonical Test name is required with testId");
        }
        const destinationTitle =
          connection.destination.kind === "screen"
            ? (map.screens[connection.destination.screenId]?.title.trim() ?? "Next screen")
            : "Finish";
        attachRecordedTest({
          map,
          testId: input.testId,
          testName: input.testName,
          ...(input.originApplication ? { originApplication: input.originApplication } : {}),
          sessionId: input.sessionId,
          connection,
          connections,
          sourceTitle: source.title.trim() || "Start",
          destinationTitle,
          at: context.at,
        });
      }
    },
  );
  return { appMap, connectionId, ...(input.testId ? { testId: input.testId } : {}) };
}

function applyRecordedConnection(
  map: AppMap,
  input: AppMapRecordingInput,
  context: AppMapMutationContext,
  connectionId: string,
): Connection {
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
    ...recordingCaptureFields(input),
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
      ...recordingCaptureFields(input),
      at: context.at,
    });
    destination = { kind: "screen", screenId: screen.id };
  }

  const actions = recordedActions(input);
  const recordingSource = recordingSourceForCommit(input, actions);
  const sourceAnchor = recordedSourceAnchor(input);
  const connection: Connection = {
    ...entityScope(map),
    id: connectionId,
    fromScreenId: source.id,
    destination,
    label: pending?.label ?? recordedConnectionLabel(input, actions),
    state: "ready",
    actions,
    ...(sourceAnchor ? { sourceAnchor } : {}),
    ...(recordingSource ? { recordingSource } : {}),
    createdAt: pending?.createdAt ?? context.at,
    updatedAt: context.at,
  };
  map.connections[connection.id] = connection;
  attachToFlow(map, source.id, connection.id, context.at);
  return connection;
}

/** Keep the reviewed action order while retaining each observed transition.
 * Edited recordings without endpoint links retain their single reviewed path. */
function recordingSegments(input: AppMapRecordingInput): AppMapRecordingInput[] {
  if (
    !input.observations?.length ||
    input.pendingConnectionId ||
    input.actions.some((action) => !action.exitObservationId)
  )
    return [input];
  const observations = new Map(
    input.observations.map((observation) => [observation.id, observation]),
  );
  if (input.before) observations.set(input.before.id, input.before);
  if (input.after) observations.set(input.after.id, input.after);
  const segments: AppMapRecordingInput[] = [];
  for (const action of input.actions) {
    const after = observations.get(action.exitObservationId!);
    if (!after) return [input];
    const previous = segments.at(-1);
    if (!action.steps.length && previous) {
      previous.actions.push(action);
      previous.after = after;
      continue;
    }
    segments.push({
      ...input,
      sessionId: `${input.sessionId}:${segments.length}`,
      pendingConnectionId: undefined,
      destination: undefined,
      sourceScreenId: segments.length ? undefined : input.sourceScreenId,
      actions: [action],
      before: observations.get(action.entranceObservationId!) ?? input.before,
      after,
    });
  }
  if (!segments.length) return [input];
  segments.at(-1)!.destination = input.destination;
  segments.at(-1)!.after = input.after ?? segments.at(-1)!.after;
  return segments;
}
