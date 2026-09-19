import type {
  GoalExplorationRecord,
  GoalExplorationResult,
  GoalExplorationStartInput,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStartInput,
} from "@relay/protocol";
import { ApiError } from "./api-error.js";

export type GoalControlOptions = {
  confirmControl: true;
  signal?: AbortSignal;
  requestId?: string;
  idempotencyKey?: string;
};

export type GoalPromotionInput = {
  sessionId: string;
  title?: string;
  appMapId?: string;
};

/** The authoring snapshot is intentionally opaque to @relay/client. */
export type GoalPromotionResult = {
  kind: "author-test";
  [key: string]: unknown;
};

export type GoalRequestOptions = Pick<
  GoalControlOptions,
  "signal" | "requestId" | "idempotencyKey"
>;

export type GoalRequest = <T>(
  path: string,
  init?: RequestInit,
  options?: GoalRequestOptions,
) => Promise<T>;

export type GoalClientTransport = { goalRequest: GoalRequest };

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(502, `${label} returned an invalid response`, value);
  }
  return value as Record<string, unknown>;
}

function parseGoalSessionResponse<T extends GoalSessionRecord | GoalSessionResult>(
  value: unknown,
  label: string,
): T {
  const record = requireObject(value, label);
  const id = record.sessionId ?? record.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new ApiError(502, `${label} returned a response without a session id`, value);
  }
  if (typeof record.status !== "string") {
    throw new ApiError(502, `${label} returned a response without a status`, value);
  }
  if (!Array.isArray(record.actions) || !Array.isArray(record.observations)) {
    throw new ApiError(502, `${label} returned an incomplete session response`, value);
  }
  return value as T;
}

function parseGoalExplorationResponse<T extends GoalExplorationRecord | GoalExplorationResult>(
  value: unknown,
  label: string,
): T {
  const record = requireObject(value, label);
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new ApiError(502, `${label} returned a response without an exploration id`, value);
  }
  if (typeof record.status !== "string" || !Array.isArray(record.workers)) {
    throw new ApiError(502, `${label} returned an incomplete exploration response`, value);
  }
  return value as T;
}

function parseGoalPromotionResponse(value: unknown): GoalPromotionResult {
  const record = requireObject(value, "Goal promotion");
  if (record.kind !== "author-test") {
    throw new ApiError(502, "Goal promotion returned an unexpected result", value);
  }
  return value as GoalPromotionResult;
}

export async function startGoal(
  transport: GoalClientTransport,
  input: GoalSessionStartInput,
  options: GoalControlOptions,
): Promise<GoalSessionResult> {
  const body = await transport.goalRequest<unknown>(
    "/goal",
    {
      method: "POST",
      body: JSON.stringify({ ...input, confirmControl: options.confirmControl }),
    },
    options,
  );
  return parseGoalSessionResponse(body, "Goal start");
}

export async function startExploration(
  transport: GoalClientTransport,
  input: GoalExplorationStartInput,
  options: GoalControlOptions,
): Promise<GoalExplorationResult> {
  const body = await transport.goalRequest<unknown>(
    "/explore",
    {
      method: "POST",
      body: JSON.stringify({ ...input, confirmControl: options.confirmControl }),
    },
    options,
  );
  return parseGoalExplorationResponse(body, "Goal exploration start");
}

export function inspectGoal(
  transport: GoalClientTransport,
  sessionId: string,
  signal?: AbortSignal,
): Promise<GoalSessionRecord> {
  return transport
    .goalRequest<unknown>(`/goal/${encodeURIComponent(sessionId)}`, { signal })
    .then((body) => parseGoalSessionResponse(body, "Goal inspection"));
}

export function inspectExploration(
  transport: GoalClientTransport,
  explorationId: string,
  signal?: AbortSignal,
): Promise<GoalExplorationRecord> {
  return transport
    .goalRequest<unknown>(`/explore/${encodeURIComponent(explorationId)}`, { signal })
    .then((body) => parseGoalExplorationResponse(body, "Goal exploration inspection"));
}

export async function resumeGoal(
  transport: GoalClientTransport,
  sessionId: string,
  options: GoalControlOptions,
): Promise<GoalSessionResult> {
  const body = await transport.goalRequest<unknown>(
    `/goal/${encodeURIComponent(sessionId)}/resume`,
    { method: "POST", body: JSON.stringify({ confirmControl: options.confirmControl }) },
    options,
  );
  return parseGoalSessionResponse(body, "Goal resume");
}

export async function resumeExploration(
  transport: GoalClientTransport,
  explorationId: string,
  options: GoalControlOptions,
): Promise<GoalExplorationResult> {
  const body = await transport.goalRequest<unknown>(
    `/explore/${encodeURIComponent(explorationId)}/resume`,
    { method: "POST", body: JSON.stringify({ confirmControl: options.confirmControl }) },
    options,
  );
  return parseGoalExplorationResponse(body, "Goal exploration resume");
}

export async function reproduceGoal(
  transport: GoalClientTransport,
  sessionId: string,
  options: GoalControlOptions,
): Promise<GoalSessionResult> {
  const body = await transport.goalRequest<unknown>(
    `/goal/${encodeURIComponent(sessionId)}/reproduce`,
    { method: "POST", body: JSON.stringify({ confirmControl: options.confirmControl }) },
    options,
  );
  return parseGoalSessionResponse(body, "Goal reproduction");
}

export async function promoteGoal(
  transport: GoalClientTransport,
  input: GoalPromotionInput,
  options: GoalControlOptions,
): Promise<GoalPromotionResult> {
  const body = await transport.goalRequest<unknown>(
    `/goal/${encodeURIComponent(input.sessionId)}/promote`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.appMapId?.trim() ? { appMapId: input.appMapId.trim() } : {}),
        confirmControl: options.confirmControl,
      }),
    },
    options,
  );
  return parseGoalPromotionResponse(body);
}
