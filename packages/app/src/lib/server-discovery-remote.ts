import type {
  DiscoveryAgentContext,
  DiscoveryControl,
  DiscoveryCoverageReport,
  DiscoveryDecisionProvenance,
  DiscoveryScope,
  DiscoverySession,
} from "@relay/protocol";
import type { RecipeInfo } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

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

export async function approveDiscoverySuggestion(
  request: ServerRequest,
  input: {
    sessionId: string;
    control: DiscoveryControl;
    decision?: DiscoveryDecisionProvenance;
  },
): Promise<void> {
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
  await request(`/discovery/${encodeURIComponent(input.sessionId)}/interact`, {
    method: "POST",
    body: JSON.stringify({ ...action, ...(input.decision ? { decision: input.decision } : {}) }),
  });
}

/** Return to the previous screen while autonomous exploration backtracks. */
export async function backtrackDiscovery(
  request: ServerRequest,
  sessionId: string,
): Promise<boolean> {
  const data = await request<{ transition: { changedScreen: boolean } }>(
    `/discovery/${encodeURIComponent(sessionId)}/interact`,
    { method: "POST", body: JSON.stringify({ kind: "back" }) },
  );
  return data.transition.changedScreen;
}
