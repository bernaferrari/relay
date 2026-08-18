import type {
  DiscoveryControl,
  DiscoveryDecisionProvenance,
  ObservedScreen,
  ObservedTransition,
} from "@relay/protocol";
import {
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  interact,
  type InteractInput,
  type SnapshotPayload,
} from "./workspace.js";
import {
  isSensitiveDiscoveryAction,
  readDiscoverySession,
  recordObservedScreen,
  recordObservedTransition,
} from "./discovery.js";

export function discoveryInteraction(input: InteractInput): {
  kind: "tap" | "type" | "scroll" | "back" | "manual";
  label?: string;
  target?: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
  text?: string;
  direction?: "up" | "down";
} {
  switch (input.kind) {
    case "identifier":
      return {
        kind: "tap",
        label: input.identifier,
        target: { identifier: input.identifier },
      };
    case "label":
      return { kind: "tap", label: input.label, target: { label: input.label } };
    case "ref":
      return { kind: "tap", label: input.ref, target: { ref: input.ref } };
    case "text-match":
      return { kind: "tap", label: input.match, target: { text: input.match } };
    case "find":
      return { kind: "tap", label: input.query, target: { text: input.query } };
    case "point":
      return {
        kind: "tap",
        label: "Coordinate tap",
        target: { point: { x: input.x, y: input.y } },
      };
    case "swipe":
      return {
        kind: "scroll",
        label: "Swipe",
        direction: input.to.y < input.from.y ? "down" : "up",
      };
    case "type":
      return { kind: "type", label: "Type text", text: input.text };
    case "replace":
      return {
        kind: "type",
        label: "Replace text",
        target: input.target,
        text: input.text,
      };
    case "key":
      return input.key === "back"
        ? { kind: "back", label: "Back" }
        : { kind: "manual", label: `Press ${input.key}` };
  }
}

export function controlToInteractInput(control: DiscoveryControl): InteractInput {
  if (control.target.identifier) {
    return { kind: "identifier", identifier: control.target.identifier };
  }
  if (control.target.ref) return { kind: "ref", ref: control.target.ref };
  if (control.target.label) return { kind: "label", label: control.target.label };
  throw new Error("Discovery control has no replayable target");
}

export async function runDiscoveryCapture(sessionId: string): Promise<{
  screen: ObservedScreen;
  isNew: boolean;
  snapshot: SnapshotPayload;
}> {
  const session = await readDiscoverySession(sessionId);
  if (!session) throw new Error("discovery session not found");
  const snapshot = await captureSnapshot({ serial: session.targetId });
  const shot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
  const captured = await recordObservedScreen({
    sessionId: session.id,
    nodes: snapshot.nodes,
    screenshotPath: shot.path,
    makeCurrent: true,
  }).finally(() => cleanupScreenshot(shot.path));
  return { screen: captured.screen, isNew: captured.isNew, snapshot };
}

export async function runDiscoveryInteract(input: {
  sessionId: string;
  interaction: InteractInput;
  decision?: DiscoveryDecisionProvenance;
}): Promise<{
  transition: ObservedTransition;
  before: ObservedScreen;
  after: ObservedScreen;
  beforeSnapshot: SnapshotPayload;
  afterSnapshot: SnapshotPayload;
  changedIdentity: boolean;
}> {
  const session = await readDiscoverySession(input.sessionId);
  if (!session) throw new Error("discovery session not found");
  if (session.status !== "running") {
    throw new Error("Start or resume this Discovery Map before interacting");
  }
  const observed = discoveryInteraction(input.interaction);
  if (!session.scope.allowSensitiveControls && isSensitiveDiscoveryAction(observed)) {
    throw new Error("discovery policy blocks sensitive controls");
  }
  const beforeSnapshot = await captureSnapshot({ serial: session.targetId });
  const beforeShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
  const before = await recordObservedScreen({
    sessionId: session.id,
    nodes: beforeSnapshot.nodes,
    screenshotPath: beforeShot.path,
    makeCurrent: true,
  }).finally(() => cleanupScreenshot(beforeShot.path));
  await interact(input.interaction, { serial: session.targetId });
  const afterSnapshot = await captureSnapshot({ serial: session.targetId });
  const afterShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
  const after = await recordObservedScreen({
    sessionId: session.id,
    nodes: afterSnapshot.nodes,
    screenshotPath: afterShot.path,
    makeCurrent: true,
  }).finally(() => cleanupScreenshot(afterShot.path));
  const changedIdentity = before.screen.id !== after.screen.id;
  const transition = await recordObservedTransition({
    sessionId: session.id,
    fromScreenId: before.screen.id,
    ...(changedIdentity ? { toScreenId: after.screen.id } : {}),
    ...observed,
    ...(input.decision ? { decision: input.decision } : {}),
    changedScreen: changedIdentity,
  });
  return {
    transition,
    before: before.screen,
    after: after.screen,
    beforeSnapshot,
    afterSnapshot,
    changedIdentity,
  };
}
