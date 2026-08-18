import type { DiscoverySession } from "@relay/protocol";
import { submitAppMapProposal } from "./app-map.js";
import { proposalFromObservedEdge } from "./app-map/observation-proposal.js";
import {
  proposeNavigationFromObservation,
  type ProposedNavigationEdge,
} from "./app-map/navigation-observation.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { readDiscoverySession, setDiscoveryStatus, suggestDiscoveryControl } from "./discovery.js";
import {
  controlToInteractInput,
  runDiscoveryCapture,
  runDiscoveryInteract,
} from "./discovery-interact.js";
import { currentOperationContext, runWithOperationContext } from "./operation-context.js";

const activeExploreJobs = new Map<string, { cancel: boolean; promise?: Promise<void> }>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function cancelled(sessionId: string): boolean {
  return activeExploreJobs.get(sessionId)?.cancel === true;
}

async function proposeObservedEdge(
  session: DiscoverySession,
  transitionId: string,
  edge: ProposedNavigationEdge,
): Promise<void> {
  const appMapId = session.agent?.appMapId;
  if (!appMapId) return;
  const latest = await readDiscoverySession(session.id);
  if (!latest) return;
  const transition = latest.transitions.find((item) => item.id === transitionId);
  if (!transition?.changedScreen || !transition.toScreenId) return;
  const map = await readAppMap(latest.projectId ?? "default", appMapId);
  if (!map) return;
  const proposal = proposalFromObservedEdge({
    map,
    session: latest,
    proposalId: `explore:${latest.id}:${transition.id}`,
    transitionId: transition.id,
    edge,
    at: Date.now(),
  });
  const operation = currentOperationContext();
  try {
    await mutateStoredAppMap(map.projectId, map.id, (current) =>
      submitAppMapProposal(current, proposal, {
        expectedRevision: current.revision,
        eventId: proposal.id,
        actorId: operation?.actorId ?? "agent:explore",
        actorKind: operation?.actorKind ?? "agent",
        at: Math.max(Date.now(), current.updatedAt),
      }),
    );
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).includes("already exists")) {
      throw error;
    }
  }
}

async function runExploreJob(sessionId: string): Promise<void> {
  try {
    let session = await readDiscoverySession(sessionId);
    if (!session) return;
    if (session.screens.length === 0) await runDiscoveryCapture(sessionId);
    const deadline = session.createdAt + session.scope.maxDurationMs;
    while (!cancelled(sessionId) && Date.now() < deadline) {
      session = await readDiscoverySession(sessionId);
      if (!session || session.status !== "running") break;
      if (session.transitions.length >= session.scope.maxTransitions) break;
      if (session.screens.length >= session.scope.maxScreens) break;
      const suggestion = suggestDiscoveryControl(session);
      if (!suggestion) {
        const rootId = session.screens[0]?.id;
        if (!session.currentScreenId || !rootId || session.currentScreenId === rootId) break;
        const back = await runDiscoveryInteract({
          sessionId,
          interaction: { kind: "key", key: "back" },
        });
        if (!back.changedIdentity) break;
        continue;
      }
      const interaction = controlToInteractInput(suggestion.control);
      const result = await runDiscoveryInteract({
        sessionId,
        interaction,
        decision: {
          mode: "semantic",
          provider: session.agent?.provider ?? "relay",
          model: session.agent?.model ?? "semantic-resolver-v1",
          selectedControlId: suggestion.control.id,
        },
      });
      if (result.changedIdentity) {
        const proposed = proposeNavigationFromObservation({
          before: result.beforeSnapshot,
          after: result.afterSnapshot,
          action: {
            kind: "tap",
            ...(suggestion.control.target.identifier
              ? { identifier: suggestion.control.target.identifier }
              : suggestion.control.target.ref
                ? { identifier: suggestion.control.target.ref }
                : {}),
            ...(suggestion.control.label ? { label: suggestion.control.label } : {}),
            ...(suggestion.control.role ? { role: suggestion.control.role } : {}),
          },
        });
        if (proposed.status === "proposed") {
          await proposeObservedEdge(session, result.transition.id, proposed.edge);
        }
      }
      await delay(250);
    }
    if (cancelled(sessionId)) {
      const latest = await readDiscoverySession(sessionId);
      if (latest && (latest.status === "running" || latest.status === "paused")) {
        await setDiscoveryStatus(sessionId, "stopped");
      }
      return;
    }
    const latest = await readDiscoverySession(sessionId);
    if (latest?.status === "running") await setDiscoveryStatus(sessionId, "complete");
  } catch {
    const latest = await readDiscoverySession(sessionId);
    if (latest && (latest.status === "running" || latest.status === "paused")) {
      await setDiscoveryStatus(sessionId, "stopped").catch(() => undefined);
    }
  } finally {
    activeExploreJobs.delete(sessionId);
  }
}

/** Start a server-owned explore crawl. The UI, CLI, and MCP all call this. */
export async function startDiscoveryExplore(id: string): Promise<DiscoverySession> {
  const session = await readDiscoverySession(id);
  if (!session) throw new Error("discovery session not found");
  if (session.status === "running" && activeExploreJobs.has(id)) return session;
  const interrupted = session.status === "running" && !activeExploreJobs.has(id);
  if (!interrupted && session.status !== "draft" && session.status !== "paused") {
    throw new Error(`cannot start discovery explore from ${session.status}`);
  }
  if (activeExploreJobs.has(id)) throw new Error("discovery explore is already active");
  const running = interrupted ? session : await setDiscoveryStatus(id, "running");
  activeExploreJobs.set(id, { cancel: false });
  const operation = currentOperationContext();
  const handle = activeExploreJobs.get(id)!;
  const crawl = () => runExploreJob(id);
  handle.promise = (operation ? runWithOperationContext(operation, crawl) : crawl()).catch(
    () => undefined,
  );
  return running;
}

export async function cancelDiscoveryExplore(id: string): Promise<DiscoverySession> {
  const active = activeExploreJobs.get(id);
  if (active) active.cancel = true;
  const session = await readDiscoverySession(id);
  if (!session) throw new Error("discovery session not found");
  if (session.status === "running" || session.status === "paused") {
    return setDiscoveryStatus(id, "stopped");
  }
  return session;
}

export function resetDiscoveryExploreJobsForTests(): void {
  activeExploreJobs.clear();
}
