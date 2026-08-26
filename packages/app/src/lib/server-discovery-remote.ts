import type { RelayClient } from "@relay/client";
import type {
  DiscoveryControl,
  DiscoveryDecisionProvenance,
  OperationInput,
  OperationOutput,
} from "@relay/protocol";
import {
  iosInteractionFailure,
  iosMutationOutcomeUnknownIntervention,
  type IosInteractionFailure,
  type IosMutationOutcomeUnknownIntervention,
} from "./ios-interaction-safety";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

export type DiscoveryInteractionReview = {
  /** The session and last pre-action observation are durable evidence. They
   * never assert that the unknown command did or did not change the device. */
  sessionId: string;
  sessionHref: string;
  lastProvenScreen?: {
    id: string;
    capturedAt: number;
    screenshotHref?: string;
  };
  /** An explicit observation request to make before considering any retry. */
  captureCurrent: { method: "POST"; href: string };
};

export type DiscoveryUnknownIosOutcome = {
  status: "ios-outcome-unknown";
  iosFailure: IosInteractionFailure;
  intervention: IosMutationOutcomeUnknownIntervention;
  review: DiscoveryInteractionReview;
};

export type DiscoveryApprovalOutcome = { status: "succeeded" } | DiscoveryUnknownIosOutcome;

export type DiscoveryBacktrackOutcome =
  | { status: "succeeded"; changedScreen: boolean }
  | DiscoveryUnknownIosOutcome;

function fallbackDiscoveryReview(sessionId: string): DiscoveryInteractionReview {
  const sessionHref = `/discovery/${encodeURIComponent(sessionId)}`;
  return {
    sessionId,
    sessionHref,
    captureCurrent: { method: "POST", href: `${sessionHref}/capture` },
  };
}

/** Read only a reviewed Discovery pointer from an error. A fallback still
 * offers a safe fresh-capture action when talking to an older server. */
function discoveryReviewFromError(error: unknown, sessionId: string): DiscoveryInteractionReview {
  const fallback = fallbackDiscoveryReview(sessionId);
  const raw = asRecord(asRecord(asRecord(error)?.body)?.discoveryReview);
  if (!raw || raw.sessionId !== sessionId || raw.sessionHref !== fallback.sessionHref) {
    return fallback;
  }
  const captureCurrent = asRecord(raw.captureCurrent);
  if (captureCurrent?.method !== "POST" || captureCurrent.href !== fallback.captureCurrent.href) {
    return fallback;
  }
  const lastProven = asRecord(raw.lastProvenScreen);
  return {
    ...fallback,
    ...(lastProven && typeof lastProven.id === "string" && typeof lastProven.capturedAt === "number"
      ? {
          lastProvenScreen: {
            id: lastProven.id,
            capturedAt: lastProven.capturedAt,
            ...(typeof lastProven.screenshotHref === "string"
              ? { screenshotHref: lastProven.screenshotHref }
              : {}),
          },
        }
      : {}),
  };
}

function unknownIosOutcome(
  error: unknown,
  sessionId: string,
  label: string,
): DiscoveryUnknownIosOutcome | undefined {
  const baseIntervention = iosMutationOutcomeUnknownIntervention(error, label);
  const iosFailure = iosInteractionFailure(error);
  if (!baseIntervention || !iosFailure) return undefined;
  return {
    status: "ios-outcome-unknown",
    iosFailure,
    // Discovery's pre-action screen is durable, but the current pixels have
    // not been recaptured. Keep the shared exact-once intervention while
    // making that evidence boundary explicit to callers.
    intervention: {
      ...baseIntervention,
      detail:
        "Relay sent one iOS command and did not retry it. Review the last proven screen, then capture the current screen before any next action.",
    },
    review: discoveryReviewFromError(error, sessionId),
  };
}

export function listDiscoverySessions(
  client: RelayClient,
): Promise<OperationOutput<"discovery.list">> {
  return client.invoke("discovery.list", {});
}

export async function createDiscoverySession(
  client: RelayClient,
  input: OperationInput<"discovery.create">,
): Promise<OperationOutput<"discovery.create">["session"]> {
  const data = await client.invoke("discovery.create", input);
  return data.session;
}

export async function setDiscoveryStatus(
  client: RelayClient,
  id: string,
  status: OperationInput<"discovery.status.update">["status"],
): Promise<OperationOutput<"discovery.status.update">["session"]> {
  const data = await client.invoke("discovery.status.update", { sessionId: id, status });
  return data.session;
}

export async function renameDiscoverySession(
  client: RelayClient,
  id: string,
  name: string,
): Promise<OperationOutput<"discovery.rename">["session"]> {
  const data = await client.invoke("discovery.rename", { sessionId: id, name });
  return data.session;
}

export async function captureDiscoveryScreen(
  client: RelayClient,
  id: string,
): Promise<OperationOutput<"discovery.capture">["session"]> {
  const data = await client.invoke(
    "discovery.capture",
    { sessionId: id },
    { signal: AbortSignal.timeout(30_000) },
  );
  return data.session;
}

export function discoveryScreenUrl(base: string, sessionId: string, screenId: string): string {
  return `${base}/discovery/${encodeURIComponent(sessionId)}/screens/${encodeURIComponent(screenId)}`;
}

export async function startDiscoveryExplore(
  client: RelayClient,
  id: string,
): Promise<OperationOutput<"discovery.start">["session"]> {
  const data = await client.invoke("discovery.start", { sessionId: id });
  return data.session;
}

export async function cancelDiscoveryExplore(
  client: RelayClient,
  id: string,
): Promise<OperationOutput<"discovery.cancel">["session"]> {
  const data = await client.invoke("discovery.cancel", { sessionId: id });
  return data.session;
}

export async function getDiscoverySuggestion(
  client: RelayClient,
  id: string,
): Promise<OperationOutput<"discovery.suggestion">["suggestion"]> {
  const data = await client.invoke("discovery.suggestion", { sessionId: id });
  return data.suggestion;
}

export async function getDiscoveryCoverage(
  client: RelayClient,
  id: string,
): Promise<OperationOutput<"discovery.coverage">["coverage"]> {
  const data = await client.invoke("discovery.coverage", { sessionId: id });
  return data.coverage;
}

export async function getDiscoveryExplorationTimeline(
  client: RelayClient,
  id: string,
): Promise<OperationOutput<"discovery.exploration-timeline">["explorationTimeline"]> {
  const data = await client.invoke("discovery.exploration-timeline", { sessionId: id });
  return data.explorationTimeline;
}

export async function approveDiscoverySuggestion(
  client: RelayClient,
  input: {
    sessionId: string;
    control: DiscoveryControl;
    decision?: DiscoveryDecisionProvenance;
  },
): Promise<DiscoveryApprovalOutcome> {
  const target = input.control.target;
  const action = target.identifier
    ? { kind: "identifier", identifier: target.identifier }
    : target.ref
      ? { kind: "ref", ref: target.ref }
      : target.label
        ? { kind: "label", label: target.label }
        : target.text
          ? { kind: "text-match", match: target.text }
          : target.point
            ? { kind: "point", x: target.point.x, y: target.point.y }
            : null;
  if (!action) throw new Error("suggestion has no executable target");
  try {
    await client.invoke("discovery.interact", {
      sessionId: input.sessionId,
      ...action,
      ...(input.decision ? { decision: input.decision } : {}),
    });
    return { status: "succeeded" };
  } catch (error) {
    const outcome = unknownIosOutcome(error, input.sessionId, `approve ${input.control.label}`);
    if (outcome) return outcome;
    throw error;
  }
}

/** Return to the previous screen while autonomous exploration backtracks. */
export async function backtrackDiscovery(
  client: RelayClient,
  sessionId: string,
): Promise<DiscoveryBacktrackOutcome> {
  try {
    const data = await client.invoke("discovery.interact", { sessionId, kind: "back" });
    return { status: "succeeded", changedScreen: data.transition.changedScreen };
  } catch (error) {
    const outcome = unknownIosOutcome(error, sessionId, "backtrack");
    if (outcome) return outcome;
    throw error;
  }
}
