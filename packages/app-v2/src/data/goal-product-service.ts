import type {
  GoalExplorationRecord,
  GoalExplorationResult,
  GoalSessionRecord,
  GoalSessionResult,
} from "@relay/protocol";
import type { AuthorTestSnapshot } from "@relay/workflows";
import type { Platform } from "../platform/types";

export type GoalStartInput = {
  goal: string;
  startUrl: string;
  maxSteps?: number;
  maxDurationMs?: number;
  agents: number;
  confirmControl: true;
};

export type GoalRunResult = GoalSessionResult | GoalExplorationResult;

export type GoalPromotionInput = {
  sessionId: string;
  title?: string;
  appMapId?: string;
  confirmControl: true;
};

export type GoalProductService = {
  start(input: GoalStartInput): Promise<GoalRunResult>;
  inspectSession(sessionId: string): Promise<GoalSessionRecord>;
  inspectExploration(explorationId: string): Promise<GoalExplorationRecord>;
  reproduceSession(sessionId: string): Promise<GoalSessionResult>;
  promoteSession(input: GoalPromotionInput): Promise<AuthorTestSnapshot>;
};

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return `Relay could not complete the goal request (${status}).`;
}

export function createGoalProductService(platform: Platform): GoalProductService {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const connection = platform.getServerConnection
      ? await platform.getServerConnection()
      : {
          url: await platform.getServerUrl(),
          auth: { type: "none" as const },
          organizationId: "local",
          projectId: "default",
          actorId: "human:goal-ui",
          actorKind: "human" as const,
        };
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-Organization-Id", connection.organizationId);
    headers.set("X-Project-Id", connection.projectId);
    headers.set("X-Relay-Actor-Id", connection.actorId);
    headers.set("X-Relay-Actor-Kind", connection.actorKind);
    if (connection.auth.type !== "none") {
      headers.set("Authorization", `Bearer ${connection.auth.token}`);
    }
    const fetcher = platform.fetch ?? fetch;
    const response = await fetcher(`${connection.url.replace(/\/+$/u, "")}${path}`, {
      ...init,
      headers,
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(errorMessage(body, response.status));
    return body as T;
  }

  return {
    start(input) {
      const { agents, ...body } = input;
      return request<GoalRunResult>(agents > 1 ? "/explore" : "/goal", {
        method: "POST",
        body: JSON.stringify({ ...body, ...(agents > 1 ? { agents } : {}) }),
      });
    },
    inspectSession(sessionId) {
      return request<GoalSessionRecord>(`/goal/${encodeURIComponent(sessionId)}`);
    },
    inspectExploration(explorationId) {
      return request<GoalExplorationRecord>(`/explore/${encodeURIComponent(explorationId)}`);
    },
    reproduceSession(sessionId) {
      return request<GoalSessionResult>(`/goal/${encodeURIComponent(sessionId)}/reproduce`, {
        method: "POST",
        body: JSON.stringify({ confirmControl: true }),
      });
    },
    promoteSession(input) {
      return request<AuthorTestSnapshot>(`/goal/${encodeURIComponent(input.sessionId)}/promote`, {
        method: "POST",
        body: JSON.stringify({
          ...(input.title?.trim() ? { title: input.title.trim() } : {}),
          ...(input.appMapId?.trim() ? { appMapId: input.appMapId.trim() } : {}),
          confirmControl: true,
        }),
      });
    },
  };
}
