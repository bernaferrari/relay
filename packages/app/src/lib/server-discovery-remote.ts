import type {
  DiscoveryAgentContext,
  DiscoveryControl,
  DiscoveryCoverageReport,
  DiscoveryDecisionProvenance,
  DiscoveryJourney,
  DiscoveryScope,
  DiscoverySession,
} from "@relay/protocol";
import type { RecipeInfo } from "./api-types";
import {
  iosInteractionFailure,
  iosMutationOutcomeUnknownIntervention,
  type IosInteractionFailure,
  type IosMutationOutcomeUnknownIntervention,
} from "./ios-interaction-safety";
import type { ServerRequest } from "./server-matrix-remote";

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
  request: ServerRequest,
): Promise<{ sessions: DiscoverySession[] }> {
  return request<{ sessions: DiscoverySession[] }>("/discovery");
}

export async function createDiscoverySession(
  request: ServerRequest,
  input: {
    name: string;
    targetId: string;
    scope?: Partial<DiscoveryScope>;
    agent?: Omit<DiscoveryAgentContext, "createdBy">;
  },
): Promise<DiscoverySession> {
  const data = await request<{ session: DiscoverySession }>("/discovery", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.session;
}

export async function setDiscoveryStatus(
  request: ServerRequest,
  id: string,
  status: DiscoverySession["status"],
): Promise<DiscoverySession> {
  const data = await request<{ session: DiscoverySession }>(
    `/discovery/${encodeURIComponent(id)}/status`,
    { method: "POST", body: JSON.stringify({ status }) },
  );
  return data.session;
}

export async function renameDiscoverySession(
  request: ServerRequest,
  id: string,
  name: string,
): Promise<DiscoverySession> {
  const data = await request<{ session: DiscoverySession }>(
    `/discovery/${encodeURIComponent(id)}/name`,
    { method: "POST", body: JSON.stringify({ name }) },
  );
  return data.session;
}

export async function captureDiscoveryScreen(
  request: ServerRequest,
  id: string,
): Promise<DiscoverySession> {
  const data = await request<{ session: DiscoverySession }>(
    `/discovery/${encodeURIComponent(id)}/capture`,
    { method: "POST", body: "{}" },
    30_000,
  );
  return data.session;
}

export function discoveryScreenUrl(base: string, sessionId: string, screenId: string): string {
  return `${base}/discovery/${encodeURIComponent(sessionId)}/screens/${encodeURIComponent(screenId)}`;
}

export async function startDiscoveryExplore(
  request: ServerRequest,
  id: string,
): Promise<DiscoverySession> {
  const data = await request<{ session: DiscoverySession }>(
    `/discovery/${encodeURIComponent(id)}/start`,
    { method: "POST", body: "{}" },
  );
  return data.session;
}

export async function cancelDiscoveryExplore(
  request: ServerRequest,
  id: string,
): Promise<DiscoverySession> {
  const data = await request<{ session: DiscoverySession }>(
    `/discovery/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: "{}" },
  );
  return data.session;
}

export async function promoteDiscoveryPath(
  request: ServerRequest,
  input: {
    sessionId: string;
    transitionIds: string[];
    recipeId: string;
    title: string;
    transitionLabels?: Record<string, string>;
  },
): Promise<{ recipe: RecipeInfo; warnings: string[] }> {
  return request<{ recipe: RecipeInfo; warnings: string[] }>(
    `/discovery/${encodeURIComponent(input.sessionId)}/promote`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function getDiscoverySuggestion(
  request: ServerRequest,
  id: string,
): Promise<{ screenId: string; control: DiscoveryControl } | null> {
  const data = await request<{
    suggestion: { screenId: string; control: DiscoveryControl } | null;
  }>(`/discovery/${encodeURIComponent(id)}/suggestion`);
  return data.suggestion;
}

export async function getDiscoveryCoverage(
  request: ServerRequest,
  id: string,
): Promise<DiscoveryCoverageReport> {
  const data = await request<{ coverage: DiscoveryCoverageReport }>(
    `/discovery/${encodeURIComponent(id)}/coverage`,
  );
  return data.coverage;
}

export async function getDiscoveryJourney(
  request: ServerRequest,
  id: string,
): Promise<DiscoveryJourney> {
  const data = await request<{ journey: DiscoveryJourney }>(
    `/discovery/${encodeURIComponent(id)}/journey`,
  );
  return data.journey;
}

export async function approveDiscoverySuggestion(
  request: ServerRequest,
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
    await request(`/discovery/${encodeURIComponent(input.sessionId)}/interact`, {
      method: "POST",
      body: JSON.stringify({ ...action, ...(input.decision ? { decision: input.decision } : {}) }),
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
  request: ServerRequest,
  sessionId: string,
): Promise<DiscoveryBacktrackOutcome> {
  try {
    const data = await request<{ transition: { changedScreen: boolean } }>(
      `/discovery/${encodeURIComponent(sessionId)}/interact`,
      { method: "POST", body: JSON.stringify({ kind: "back" }) },
    );
    return { status: "succeeded", changedScreen: data.transition.changedScreen };
  } catch (error) {
    const outcome = unknownIosOutcome(error, sessionId, "backtrack");
    if (outcome) return outcome;
    throw error;
  }
}
