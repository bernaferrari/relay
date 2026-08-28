import { createHash } from "node:crypto";
import type {
  AppMap,
  AppMapScenarioTestStep,
  Connection,
  GraphExplorationControl,
  GraphExplorationClassification,
  GraphExplorationDecision,
  GraphExplorationObservation,
  GraphExplorationProposal,
  ExplorationAction,
  ExplorationFrontierFactors,
  LogicalScrollSurface,
  NormalizedSemanticNode,
  StateFixture,
  StepTarget,
} from "@relay/protocol";
import { evaluateExplorationActionPolicy, rankExplorationFrontier } from "./exploration-policy.js";
import { semanticTargetKey, semanticTargetMatches } from "./scroll-surface-semantic-index.js";

const DESTRUCTIVE =
  /\b(delete|erase|remove account|sign out|log out|purchase|subscribe|buy|reset|deactivate|clear all)\b/iu;
const EXTERNAL =
  /\b(open in (?:browser|chrome|safari)|website|app language|system settings|play store|app store)\b/iu;
const STATEFUL_ROLE = /switch|toggle|checkbox|radio|slider|seekbar|stepper/iu;

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16)}`;
}

function targetLabel(target: StepTarget): string {
  return target.label ?? target.text ?? target.identifier?.split(/[:/]/u).at(-1) ?? "Control";
}

function targetForNode(node: NormalizedSemanticNode): StepTarget | undefined {
  if (node.identifier?.trim()) return { identifier: node.identifier.trim() };
  if (node.label?.trim()) return { label: node.label.trim() };
  if (node.value?.trim()) return { text: node.value.trim() };
  return undefined;
}

function connectionTargets(connection: Connection): StepTarget[] {
  return connection.actions.flatMap((action) => {
    if (action.kind === "tap" || action.kind === "reveal") return [action.target];
    if (action.kind !== "steps") return [];
    return action.steps.flatMap((step) =>
      step.kind === "tap" || step.kind === "reveal" ? [step.target] : [],
    );
  });
}

function matchingReadyConnection(
  map: AppMap,
  sourceScreenId: string,
  target: StepTarget,
): Connection | undefined {
  return Object.values(map.connections)
    .filter(
      (connection) =>
        connection.state === "ready" &&
        connection.fromScreenId === sourceScreenId &&
        connectionTargets(connection).some((candidate) => semanticTargetMatches(candidate, target)),
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0];
}

function cleanupIsProven(
  map: AppMap,
  destinationScreenId: string,
  sourceScreenId: string,
  connectionIds: readonly string[] | undefined,
): boolean {
  if (!connectionIds?.length) return false;
  let cursor = destinationScreenId;
  for (const id of connectionIds) {
    const connection = map.connections[id];
    if (
      !connection ||
      connection.state !== "ready" ||
      connection.fromScreenId !== cursor ||
      connection.destination.kind !== "screen"
    ) {
      return false;
    }
    cursor = connection.destination.screenId;
  }
  return cursor === sourceScreenId;
}

export function classifyGraphExplorationControl(input: {
  control: GraphExplorationControl;
  existingConnection?: Connection;
  destinationIsExternal?: boolean;
  observation?: GraphExplorationObservation["outcome"];
  cleanupProven?: boolean;
  returnProven?: boolean;
}): Pick<GraphExplorationDecision, "classification" | "decision" | "reason"> {
  const { control, existingConnection, observation } = input;
  const semantic = `${control.label} ${control.role ?? ""}`;
  if (DESTRUCTIVE.test(semantic)) {
    return {
      classification: "destructive",
      decision: "defer",
      reason: "Destructive controls require explicit human intent and are never auto-explored.",
    };
  }
  if (observation?.kind === "external" || input.destinationIsExternal || EXTERNAL.test(semantic)) {
    return {
      classification: "external",
      decision: "defer",
      reason:
        "This control leaves the product-owned graph and requires an explicit handoff review.",
    };
  }
  if (observation?.kind === "no-op") {
    return { classification: "no-op", decision: "skip", reason: observation.reason };
  }
  const stateful = STATEFUL_ROLE.test(control.role ?? "");
  if (stateful) {
    if (existingConnection?.return || input.cleanupProven || input.returnProven) {
      return {
        classification: "reversible",
        decision: existingConnection || observation?.kind === "screen" ? "skip" : "explore",
        reason: existingConnection
          ? "The state change and its reviewed return are already proven."
          : observation?.kind === "screen"
            ? "The observed state change and its complete cleanup path are ready for review."
            : "The state change has a complete reviewed cleanup path.",
      };
    }
    return {
      classification: "unknown",
      decision: "defer",
      reason: "State-changing controls need a reviewed cleanup path before exploration.",
    };
  }
  if (observation?.kind === "screen") {
    if (!input.cleanupProven) {
      return {
        classification: "navigation",
        decision: "defer",
        reason: "The observed destination needs a complete reviewed return path before scheduling.",
      };
    }
    return {
      classification: "navigation",
      decision: "skip",
      reason: "The observed navigation and return path are captured for review.",
    };
  }
  if (existingConnection) {
    const selfLoop =
      existingConnection.destination.kind === "screen" &&
      existingConnection.destination.screenId === existingConnection.fromScreenId;
    return selfLoop
      ? {
          classification: "no-op",
          decision: "skip",
          reason: "A reviewed same-screen outcome already records this control.",
        }
      : input.returnProven
        ? {
            classification: "navigation",
            decision: "skip",
            reason: "This navigation edge and its return are proven and reusable by the Test.",
          }
        : {
            classification: "navigation",
            decision: "defer",
            reason: "The navigation edge is proven, but its return path is not reviewed.",
          };
  }
  return {
    classification: "unknown",
    decision: "defer",
    reason:
      "An unreviewed control cannot prove navigation or the absence of external effects from its label and role.",
  };
}

function selectedSurface(input: {
  map: AppMap;
  sourceScreenId: string;
  variantId?: string;
  surfaceId?: string;
  captureId?: string;
}): { variantId: string; surface: LogicalScrollSurface; nodes: NormalizedSemanticNode[] } {
  const screen = input.map.screens[input.sourceScreenId];
  if (!screen) throw new Error(`Screen ${input.sourceScreenId} does not exist`);
  const variants = screen.variantIds
    .map((id) => input.map.screenVariants[id])
    .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant))
    .filter((variant) => !input.variantId || variant.id === input.variantId);
  const candidates = variants.flatMap((variant) =>
    (variant.scrollSurfaces ?? [])
      .filter(
        (surface) =>
          surface.status === "completed" &&
          Boolean(surface.semanticIndex) &&
          (!input.surfaceId || surface.id === input.surfaceId) &&
          (!input.captureId || surface.captureId === input.captureId),
      )
      .map((surface) => ({ variant, surface })),
  );
  const selected = candidates.sort(
    (left, right) =>
      right.surface.capturedAt - left.surface.capturedAt ||
      left.surface.captureId.localeCompare(right.surface.captureId),
  )[0];
  if (!selected) {
    throw new Error(`Screen ${input.sourceScreenId} has no completed semantic scroll surface`);
  }
  return {
    variantId: selected.variant.id,
    surface: selected.surface,
    nodes: selected.variant.observation?.nodes ?? [],
  };
}

function controlsFromSurface(
  surface: LogicalScrollSurface,
  nodes: readonly NormalizedSemanticNode[],
): GraphExplorationControl[] {
  const nodeByTarget = new Map<string, NormalizedSemanticNode>();
  for (const node of nodes) {
    const target = targetForNode(node);
    const key = target ? semanticTargetKey(target) : undefined;
    if (key && !nodeByTarget.has(key)) nodeByTarget.set(key, node);
  }
  return [...surface.semanticIndex!.anchors]
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.documentY - right.documentY ||
        (semanticTargetKey(left.target) ?? "").localeCompare(semanticTargetKey(right.target) ?? ""),
    )
    .map((anchor) => {
      const key = semanticTargetKey(anchor.target)!;
      const node = nodeByTarget.get(key);
      const role = anchor.role ?? node?.role;
      const value = anchor.value ?? node?.value;
      const enabled = anchor.enabled ?? node?.enabled;
      const selected = anchor.selected ?? node?.selected;
      return {
        key,
        label: anchor.label?.trim() || node?.label?.trim() || targetLabel(anchor.target),
        target: structuredClone(anchor.target),
        ...(role ? { role } : {}),
        ...(value ? { value } : {}),
        ...(enabled === undefined ? {} : { enabled }),
        ...(selected === undefined ? {} : { selected }),
        documentOrder: anchor.order,
        documentY: anchor.documentY,
      };
    });
}

function proposedConnection(input: {
  map: AppMap;
  sourceScreenId: string;
  control: GraphExplorationControl;
  destinationScreenId: string;
  at: number;
}): Connection {
  const id = stableId(
    "explore",
    input.map.id,
    input.sourceScreenId,
    input.control.key,
    input.destinationScreenId,
  );
  return {
    organizationId: input.map.organizationId,
    projectId: input.map.projectId,
    appMapId: input.map.id,
    id,
    fromScreenId: input.sourceScreenId,
    destination: { kind: "screen", screenId: input.destinationScreenId },
    label: input.control.label,
    state: "draft",
    actions: [
      {
        id: `${id}-reveal`,
        kind: "reveal",
        target: structuredClone(input.control.target),
        direction: "auto",
        maxAttempts: 4,
      },
      { id: `${id}-tap`, kind: "tap", target: structuredClone(input.control.target) },
    ],
    createdAt: input.at,
    updatedAt: input.at,
  };
}

function explorationPolicyAction(
  control: GraphExplorationControl,
  classification: GraphExplorationClassification,
): ExplorationAction {
  const destructiveKind = /\b(purchase|subscribe|buy)\b/iu.test(control.label)
    ? "purchase"
    : /\b(remove account|sign out|log out|deactivate)\b/iu.test(control.label)
      ? "account-mutation"
      : "data-deletion";
  const kind =
    classification === "navigation"
      ? "navigate"
      : classification === "reversible"
        ? "state-change"
        : classification === "destructive"
          ? destructiveKind
          : classification === "external"
            ? "external-app"
            : classification === "no-op"
              ? "observe"
              : "unknown";
  return {
    id: control.key,
    kind,
    requiredScopes:
      kind === "state-change"
        ? [
            /\b(language|locale)\b/iu.test(control.label)
              ? "locale"
              : /\b(theme|dark mode|light mode)\b/iu.test(control.label)
                ? "theme"
                : /\bpermission\b/iu.test(control.label)
                  ? "permission"
                  : /\bnetwork|wi-?fi\b/iu.test(control.label)
                    ? "network"
                    : /\baccount\b/iu.test(control.label)
                      ? "account"
                      : "app",
          ]
        : [],
    declaredExternalEffects: [],
  };
}

function defaultFrontierFactors(input: {
  classification: GraphExplorationClassification;
  existing: boolean;
  observed: boolean;
}): ExplorationFrontierFactors {
  return {
    novelty: input.existing ? 0 : 100,
    coverageValue: input.existing ? 20 : input.observed ? 70 : 100,
    changedCodeRelevance: 0,
    uncertaintyReduction:
      input.classification === "unknown"
        ? 25
        : input.classification === "no-op"
          ? 0
          : input.observed
            ? 35
            : 75,
    executionCost:
      input.classification === "no-op"
        ? 5
        : input.classification === "navigation"
          ? 35
          : input.classification === "reversible"
            ? 60
            : 85,
  };
}

/** Build a deterministic, Android-first exploration proposal from immutable
 * App Map evidence. This function never reads a device and never mutates the
 * supplied map. */
export function proposeGraphExploration(input: {
  map: AppMap;
  sourceScreenId: string;
  testId: string;
  testName?: string;
  actorId: string;
  at: number;
  variantId?: string;
  surfaceId?: string;
  captureId?: string;
  observations?: readonly GraphExplorationObservation[];
  stateFixture?: StateFixture;
  frontier?: ReadonlyArray<{ controlKey: string; factors: ExplorationFrontierFactors }>;
}): GraphExplorationProposal {
  const selected = selectedSurface(input);
  const controls = controlsFromSurface(selected.surface, selected.nodes);
  if (controls.length > 200) {
    throw new Error(
      "Semantic surface has more than 200 controls; split it before proposing a Test",
    );
  }
  const observations = new Map<string, GraphExplorationObservation>();
  for (const observation of input.observations ?? []) {
    if (observations.has(observation.controlKey)) {
      throw new Error(`Duplicate exploration observation for ${observation.controlKey}`);
    }
    observations.set(observation.controlKey, observation);
  }
  const controlKeys = new Set(controls.map((control) => control.key));
  for (const key of observations.keys()) {
    if (!controlKeys.has(key))
      throw new Error(`Exploration observation ${key} is not on the surface`);
  }
  const frontierFactors = new Map<string, ExplorationFrontierFactors>();
  for (const item of input.frontier ?? []) {
    if (frontierFactors.has(item.controlKey)) {
      throw new Error(`Duplicate exploration frontier factors for ${item.controlKey}`);
    }
    if (!controlKeys.has(item.controlKey)) {
      throw new Error(`Exploration frontier action ${item.controlKey} is not on the surface`);
    }
    frontierFactors.set(item.controlKey, item.factors);
  }
  const decisions: GraphExplorationDecision[] = [];
  const frontierCandidates: Array<{
    action: ExplorationAction;
    fixture?: StateFixture;
    factors: ExplorationFrontierFactors;
  }> = [];
  const proposedConnections: Connection[] = [];
  const steps: AppMapScenarioTestStep[] = [];
  for (const control of controls) {
    const observation = observations.get(control.key)?.outcome;
    const existing = matchingReadyConnection(input.map, input.sourceScreenId, control.target);
    const observedDestination =
      observation?.kind === "screen" ? observation.destinationScreenId : undefined;
    if (observedDestination && !input.map.screens[observedDestination]) {
      throw new Error(`Observed destination ${observedDestination} does not exist`);
    }
    const destinationId =
      existing?.destination.kind === "screen" ? existing.destination.screenId : observedDestination;
    const cleanupConnectionIds =
      observation?.kind === "screen" ? observation.cleanupConnectionIds : undefined;
    const cleanupProven =
      Boolean(destinationId) &&
      cleanupIsProven(input.map, destinationId!, input.sourceScreenId, cleanupConnectionIds);
    const returnProven =
      Boolean(existing?.return) ||
      (Boolean(destinationId) &&
        Object.values(input.map.connections).some(
          (connection) =>
            connection.state === "ready" &&
            connection.fromScreenId === destinationId &&
            connection.destination.kind === "screen" &&
            connection.destination.screenId === input.sourceScreenId,
        ));
    const classified = classifyGraphExplorationControl({
      control,
      ...(existing ? { existingConnection: existing } : {}),
      ...(destinationId && input.map.screens[destinationId]?.handoff
        ? { destinationIsExternal: true }
        : {}),
      ...(observation ? { observation } : {}),
      cleanupProven,
      returnProven,
    });
    const action = explorationPolicyAction(control, classified.classification);
    const stateFixture = action.requiredScopes.length ? input.stateFixture : undefined;
    const policy = evaluateExplorationActionPolicy({
      schemaVersion: 1,
      action,
      ...(stateFixture ? { fixture: stateFixture } : {}),
    });
    const effectiveDecision =
      classified.decision === "explore" && policy.level !== "safe"
        ? ("defer" as const)
        : classified.decision;
    const effectiveReason =
      effectiveDecision !== classified.decision
        ? (policy.reasons[0]?.explanation ?? classified.reason)
        : classified.reason;
    frontierCandidates.push({
      action,
      ...(stateFixture ? { fixture: stateFixture } : {}),
      factors:
        frontierFactors.get(control.key) ??
        defaultFrontierFactors({
          classification: classified.classification,
          existing: Boolean(existing),
          observed: Boolean(observation),
        }),
    });
    let proposed: Connection | undefined;
    if (
      observedDestination &&
      !existing &&
      (classified.classification === "navigation" || classified.classification === "reversible")
    ) {
      proposed = proposedConnection({
        map: input.map,
        sourceScreenId: input.sourceScreenId,
        control,
        destinationScreenId: observedDestination,
        at: input.at,
      });
      proposedConnections.push(proposed);
    }
    decisions.push({
      control,
      ...classified,
      decision: effectiveDecision,
      reason: effectiveReason,
      policy,
      ...(existing ? { existingConnectionId: existing.id } : {}),
      ...(proposed ? { proposedConnectionId: proposed.id } : {}),
      ...(cleanupConnectionIds?.length ? { cleanupConnectionIds: [...cleanupConnectionIds] } : {}),
    });
    const stepId = stableId("explore-step", input.sourceScreenId, control.key);
    const connectionId = existing?.id ?? proposed?.id;
    const disabled = effectiveDecision === "defer" || classified.classification === "no-op";
    steps.push({
      id: stepId,
      kind: "instruction",
      intent: `Explore ${control.label}`,
      capture: !disabled,
      binding:
        existing && connectionId
          ? { status: "resolved", kind: "connections", connectionIds: [connectionId] }
          : {
              status: "unresolved",
              reason: proposed
                ? "Review and prove the proposed connection before this check can run."
                : effectiveReason,
              ...(connectionId
                ? { candidates: [{ kind: "connection", id: connectionId, label: control.label }] }
                : {}),
            },
      ...(disabled
        ? {
            execution: {
              status: "disabled" as const,
              reason: effectiveReason,
              repairTargetId: `explore:${control.key}`,
              decidedBy: input.actorId,
              decidedAt: input.at,
            },
          }
        : {}),
    });
  }
  const test = {
    organizationId: input.map.organizationId,
    projectId: input.map.projectId,
    appMapId: input.map.id,
    id: input.testId,
    name: input.testName?.trim() || `${input.map.screens[input.sourceScreenId]!.title} exploration`,
    kind: "scenario" as const,
    intentSchemaVersion: 1 as const,
    steps,
    surfaceBindings: [
      {
        screenId: input.sourceScreenId,
        variantId: selected.variantId,
        captureMode: "full-surface" as const,
        reason: "Stable semantic document order for graph-native exploration",
        surfaceId: selected.surface.id,
        baselineCaptureId: selected.surface.captureId,
        compare: "visual-and-semantic" as const,
        repair: "propose-recapture" as const,
      },
    ],
    createdAt: input.at,
    updatedAt: input.at,
  };
  return {
    schemaVersion: 1,
    status: "review-required",
    appMapId: input.map.id,
    baseRevision: input.map.revision,
    sourceScreenId: input.sourceScreenId,
    sourceVariantId: selected.variantId,
    surface: { id: selected.surface.id, captureId: selected.surface.captureId },
    decisions,
    proposedConnections,
    proposedTest: test,
    frontier: rankExplorationFrontier({ schemaVersion: 1, candidates: frontierCandidates }),
    summary: {
      controls: decisions.length,
      explore: decisions.filter((decision) => decision.decision === "explore").length,
      skipped: decisions.filter((decision) => decision.decision === "skip").length,
      deferred: decisions.filter((decision) => decision.decision === "defer").length,
      proposedConnections: proposedConnections.length,
    },
  };
}
