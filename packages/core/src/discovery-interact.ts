import type { SnapshotNode } from "./device.js";
import { describeTargetUi } from "./explore.js";
import { landDiscoveryOnAppMap } from "./discovery-land.js";
import { profileHeaderAffordances, semanticTargetAtPoint } from "./discovery-semantic-tap.js";
import {
  captureFullSurfaceEvidence,
  paintVisitedRows,
  type DiscoveryVisitTarget,
} from "./discovery-surface.js";
import {
  fingerprintDiscoveryScreen,
  isSensitiveDiscoveryAction,
  readDiscoverySession,
  recordObservedScreen,
  recordObservedTransition,
  writeDiscoveryScreenAsset,
} from "./discovery.js";
import {
  captureSettledDiscoverySnapshot,
  waitDiscoverySettle,
  type DiscoverySettleKind,
} from "./discovery-verify.js";
import {
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  interact,
  type InteractInput,
  type SnapshotPayload,
} from "./workspace.js";
import type {
  DiscoveryControl,
  DiscoveryDecisionProvenance,
  ObservedScreen,
  ObservedTransition,
} from "@relay/protocol";
import { readFile, writeFile } from "node:fs/promises";
import { isSettingsChildTitle } from "./app-map/settings-screen-titles.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";

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
  // Grok header icons are unlabeled; prefer the relative point over a shared/empty id.
  if ((control.label === "Menu" || control.label === "Private") && control.target.point) {
    return { kind: "point", x: control.target.point.x, y: control.target.point.y };
  }
  if (control.target.identifier) {
    return { kind: "identifier", identifier: control.target.identifier };
  }
  if (control.target.ref) return { kind: "ref", ref: control.target.ref };
  if (control.target.point) {
    return { kind: "point", x: control.target.point.x, y: control.target.point.y };
  }
  if (control.target.label) return { kind: "label", label: control.target.label };
  throw new Error("Discovery control has no replayable target");
}

async function resolveLiveInteraction(
  serial: string,
  interaction: InteractInput,
  nodes: SnapshotNode[],
): Promise<{ interaction: InteractInput; recordTarget?: DiscoveryControl["target"] }> {
  if (
    interaction.kind === "label" &&
    (interaction.label === "Menu" || interaction.label === "Private")
  ) {
    const match = profileHeaderAffordances(nodes).find((item) => item.label === interaction.label);
    if (match?.target.identifier) {
      return {
        interaction: { kind: "identifier", identifier: match.target.identifier },
        recordTarget: { identifier: match.target.identifier },
      };
    }
    if (match?.target.point) {
      return {
        interaction: { kind: "point", x: match.target.point.x, y: match.target.point.y },
        recordTarget: { label: interaction.label },
      };
    }
  }
  if (interaction.kind === "point") {
    const semantic = semanticTargetAtPoint(nodes, { x: interaction.x, y: interaction.y });
    // Keep Menu/Private as points — never upgrade to a non-unique tree id.
    const menuish =
      semantic?.label === "Menu" ||
      semantic?.label === "Private" ||
      profileHeaderAffordances(nodes).some((item) => {
        const tip = item.target.point;
        return tip && Math.hypot(tip.x - interaction.x, tip.y - interaction.y) <= 36;
      });
    if (menuish) {
      return {
        interaction,
        recordTarget: semantic?.label
          ? { label: semantic.label, point: { x: interaction.x, y: interaction.y } }
          : { label: "Menu", point: { x: interaction.x, y: interaction.y } },
      };
    }
    if (semantic?.identifier) {
      const matches = nodes.filter((node) => node.identifier?.trim() === semantic.identifier);
      if (matches.length === 1) {
        return {
          interaction: { kind: "identifier", identifier: semantic.identifier },
          recordTarget: semantic,
        };
      }
      return { interaction, recordTarget: semantic };
    }
    if (semantic?.label) {
      const labelMatches = nodes.filter(
        (node) => (node.label ?? node.value ?? "").trim() === semantic.label,
      );
      if (labelMatches.length === 1) {
        return {
          interaction: { kind: "label", label: semantic.label },
          recordTarget: semantic,
        };
      }
      return { interaction, recordTarget: semantic };
    }
  }
  return { interaction };
}

export async function runDiscoveryCapture(
  sessionId: string,
  options?: {
    visited?: readonly DiscoveryVisitTarget[];
    fullSurface?: boolean;
  },
): Promise<{
  screen: ObservedScreen;
  isNew: boolean;
  snapshot: SnapshotPayload;
}> {
  const session = await readDiscoverySession(sessionId);
  if (!session) throw new Error("discovery session not found");
  const snapshot = await captureSnapshot({ serial: session.targetId });
  const shot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
  let screenshotPath = shot.path;
  let nodes = snapshot.nodes;
  try {
    if (options?.fullSurface) {
      const labels = nodes
        .map((node) => (node.label ?? node.value ?? "").trim())
        .filter(Boolean)
        .slice(0, 40);
      const surface = await captureFullSurfaceEvidence(
        session.targetId,
        session.screens[0]?.title ?? labels[0] ?? "Screen",
        labels,
      );
      if (surface) {
        screenshotPath = surface.pngPath;
        nodes = surface.nodes;
      }
    }
    if (options?.visited?.length) {
      const marked = paintVisitedRows(
        await readFile(screenshotPath),
        nodes,
        options.visited,
        snapshot.bounds,
      );
      await writeFile(screenshotPath, marked);
    }
    const captured = await recordObservedScreen({
      sessionId: session.id,
      nodes,
      screenshotPath,
      makeCurrent: true,
    });
    return { screen: captured.screen, isNew: captured.isNew, snapshot };
  } catch (error) {
    if (error instanceof IosMutationOutcomeUnknownError) {
      // The pre-survey PNG/tree were collected before the ambiguous scroll.
      // Persist that proven viewport so the typed recovery response can point
      // to concrete evidence without trying to restore or inspect by input.
      try {
        await recordObservedScreen({
          sessionId: session.id,
          nodes: snapshot.nodes,
          screenshotPath: shot.path,
          makeCurrent: true,
        });
      } catch (persistError) {
        console.error("discovery full-surface pre-action evidence failed", persistError);
      }
    }
    throw error;
  } finally {
    await cleanupScreenshot(shot.path);
  }
}

export async function refreshDiscoveryScreenShot(
  sessionId: string,
  screenId: string,
  visited?: readonly DiscoveryVisitTarget[],
): Promise<void> {
  const session = await readDiscoverySession(sessionId);
  if (!session) throw new Error("discovery session not found");
  const snapshot = await captureSnapshot({ serial: session.targetId });
  const shot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
  try {
    let png: Buffer = await readFile(shot.path);
    if (visited?.length) {
      png = paintVisitedRows(png, snapshot.nodes, visited, snapshot.bounds);
    }
    await writeDiscoveryScreenAsset(sessionId, screenId, png);
  } finally {
    await cleanupScreenshot(shot.path);
  }
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
  const beforeSnapshot = await captureSnapshot({ serial: session.targetId });
  const resolved = await resolveLiveInteraction(
    session.targetId,
    input.interaction,
    beforeSnapshot.nodes,
  );
  const observed = discoveryInteraction(resolved.interaction);
  if (resolved.recordTarget) {
    observed.target = resolved.recordTarget;
    if (resolved.recordTarget.label) observed.label = resolved.recordTarget.label;
    else if (resolved.recordTarget.identifier) observed.label = resolved.recordTarget.identifier;
  }
  if (!session.scope.allowSensitiveControls && isSensitiveDiscoveryAction(observed)) {
    throw new Error("discovery policy blocks sensitive controls");
  }

  // Reuse the current observed screen when the live tree still matches — avoids a
  // redundant screenshot + duplicate screen record on every tap.
  const current = session.currentScreenId
    ? session.screens.find((screen) => screen.id === session.currentScreenId)
    : undefined;
  const liveFingerprint = fingerprintDiscoveryScreen(beforeSnapshot.nodes);
  let before: { screen: ObservedScreen; isNew: boolean };
  if (current && current.fingerprint === liveFingerprint) {
    before = { screen: current, isNew: false };
  } else {
    const beforeShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
    before = await recordObservedScreen({
      sessionId: session.id,
      nodes: beforeSnapshot.nodes,
      screenshotPath: beforeShot.path,
      makeCurrent: true,
    }).finally(() => cleanupScreenshot(beforeShot.path));
  }

  await interact(resolved.interaction, { serial: session.targetId });
  // Back (and many sheet closes) animate — snapshotting immediately invents a
  // phantom screen titled like the child while the list is already underneath.
  const settleKind = observed.kind as DiscoverySettleKind;
  await waitDiscoverySettle(settleKind);
  const settled = await captureSettledDiscoverySnapshot({
    serial: session.targetId,
    beforeFingerprint: liveFingerprint,
    kind: settleKind,
    alreadySettled: true,
  });
  const afterSnapshot = settled.snapshot;
  const afterShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
  const preferredTitle =
    observed.label && isSettingsChildTitle(observed.label) ? observed.label.trim() : undefined;
  const after = await recordObservedScreen({
    sessionId: session.id,
    nodes: afterSnapshot.nodes,
    screenshotPath: afterShot.path,
    makeCurrent: true,
    ...(preferredTitle ? { title: preferredTitle } : {}),
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
  if (changedIdentity) {
    try {
      const foreground = (await describeTargetUi(session.targetId)).foregroundApp;
      const leftGrok =
        foreground &&
        foreground !== "ai.x.grok" &&
        foreground !== "ai.x.GrokApp" &&
        !foreground.includes("grok");
      if (!leftGrok) await landDiscoveryOnAppMap(session.id, transition.id);
      else console.error(`discovery interact skipped land — left app for ${foreground}`);
    } catch (error) {
      console.error(`discovery interact land failed`, error);
    }
  }
  return {
    transition,
    before: before.screen,
    after: after.screen,
    beforeSnapshot,
    afterSnapshot,
    changedIdentity,
  };
}
