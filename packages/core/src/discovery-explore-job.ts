import type { AppMapBatchChange, DiscoveryControl, DiscoverySession, Proposal } from "@relay/protocol";
import { commitAppMapChanges } from "./app-map.js";
import { proposalFromObservedEdge } from "./app-map/observation-proposal.js";
import {
  proposeNavigationFromObservation,
  type ProposedNavigationEdge,
} from "./app-map/navigation-observation.js";
import { mutateStoredAppMap, readAppMap } from "./collaboration.js";
import {
  discoveryControls,
  readDiscoverySession,
  replaceDiscoveryScreenControls,
  setDiscoveryStatus,
} from "./discovery.js";
import {
  controlToInteractInput,
  runDiscoveryCapture,
  runDiscoveryInteract,
} from "./discovery-interact.js";
import { createDevice, openApp } from "./device.js";
import { dismissTowardParent, describeTargetUi, scrollCollectControls } from "./explore.js";
import { currentOperationContext, runWithOperationContext } from "./operation-context.js";
import { runWithTargetContext } from "./target-context.js";
import { devicePlatformForSerial } from "./workspace.js";

const MAX_DEPTH = 5;
const activeExploreJobs = new Map<string, { cancel: boolean; promise?: Promise<void> }>();

type Frame = { screenId: string; queue: DiscoveryControl[] };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function cancelled(sessionId: string): boolean {
  return activeExploreJobs.get(sessionId)?.cancel === true;
}

function edgeKey(screenId: string, control: DiscoveryControl): string {
  return `${screenId}:${JSON.stringify(control.target)}`;
}

function batchFromProposal(proposal: Proposal): AppMapBatchChange[] {
  return proposal.changes.flatMap((change) => {
    if (change.kind === "connection.connect") {
      return [{ kind: "connection.create" as const, connection: change.connection }];
    }
    if (change.kind === "test.edit") return [];
    return [change];
  });
}

async function registerObservedEdge(
  session: DiscoverySession,
  transitionId: string,
  edge?: ProposedNavigationEdge,
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
    ...(edge ? { edge } : {}),
    at: Date.now(),
  });
  const operation = currentOperationContext();
  await mutateStoredAppMap(map.projectId, map.id, (current) =>
    commitAppMapChanges(
      current,
      batchFromProposal(proposal),
      undefined,
      {
        expectedRevision: current.revision,
        eventId: proposal.id,
        actorId: operation?.actorId ?? "agent:explore",
        actorKind: operation?.actorKind ?? "agent",
        at: Math.max(Date.now(), current.updatedAt),
      },
      proposal.title,
    ),
  );
}

async function collectVisibleControls(
  session: DiscoverySession,
  screenId: string,
): Promise<DiscoveryControl[]> {
  try {
    const scrolled = await scrollCollectControls({
      serial: session.targetId,
      maxScrolls: 5,
      extract: discoveryControls,
      keyOf: (control) => JSON.stringify(control.target),
    });
    if (scrolled.controls.length) {
      await replaceDiscoveryScreenControls(session.id, screenId, scrolled.controls);
      return scrolled.controls;
    }
  } catch (error) {
    console.error(`discovery explore ${session.id} scroll failed`, error);
  }
  const latest = await readDiscoverySession(session.id);
  return latest?.screens.find((screen) => screen.id === screenId)?.controls ?? [];
}

async function goBack(session: DiscoverySession, rootTitle?: string): Promise<void> {
  await dismissTowardParent({
    serial: session.targetId,
    parentTitles: [rootTitle, "Settings"].filter((title): title is string => Boolean(title)),
  });
  await runDiscoveryCapture(session.id);
}

async function stayInOriginApp(serial: string, originApp?: string): Promise<boolean> {
  if (!originApp) return true;
  const foreground = (await describeTargetUi(serial)).foregroundApp;
  if (!foreground || foreground === originApp) return true;
  const platform = (await devicePlatformForSerial(serial)) ?? "android";
  await runWithTargetContext({ kind: "device", platform, serial }, async () => {
    await openApp(createDevice(), originApp, { relaunch: true });
  });
  return false;
}

async function runExploreJob(sessionId: string): Promise<void> {
  try {
    let session = await readDiscoverySession(sessionId);
    if (!session) return;
    if (session.screens.length === 0) await runDiscoveryCapture(sessionId);
    session = (await readDiscoverySession(sessionId))!;
    const originApp = (await describeTargetUi(session.targetId)).foregroundApp;
    const root = session.screens[0];
    if (!root) return;
    const rootTitle = root.title;
    const explored = new Set<string>();
    const visited = new Set([root.id]);
    const stack: Frame[] = [
      { screenId: root.id, queue: [...(await collectVisibleControls(session, root.id))] },
    ];
    const deadline = session.createdAt + session.scope.maxDurationMs;

    while (!cancelled(sessionId) && Date.now() < deadline && stack.length) {
      session = (await readDiscoverySession(sessionId))!;
      if (!session || session.status !== "running") break;
      if (session.transitions.length >= session.scope.maxTransitions) break;
      if (session.screens.length >= session.scope.maxScreens) break;
      const frame = stack[stack.length - 1]!;
      if (stack.length > MAX_DEPTH || frame.queue.length === 0) {
        stack.pop();
        if (stack.length) {
          try {
            await goBack(session, rootTitle);
          } catch (error) {
            console.error(`discovery explore ${sessionId} back failed`, error);
            break;
          }
        }
        continue;
      }
      const control = frame.queue.shift()!;
      const key = edgeKey(frame.screenId, control);
      if (explored.has(key)) continue;
      explored.add(key);
      const beforeId = frame.screenId;
      let result: Awaited<ReturnType<typeof runDiscoveryInteract>>;
      try {
        result = await runDiscoveryInteract({
          sessionId,
          interaction: controlToInteractInput(control),
          decision: {
            mode: "semantic",
            provider: session.agent?.provider ?? "relay",
            model: session.agent?.model ?? "semantic-resolver-v1",
            selectedControlId: control.id,
          },
        });
      } catch (error) {
        console.error(`discovery explore ${sessionId} tap failed`, error);
        continue;
      }
      if (result.changedIdentity) {
        const stillInApp = await stayInOriginApp(session.targetId, originApp);
        if (!stillInApp) {
          await runDiscoveryCapture(sessionId);
          stack.splice(1);
          continue;
        }
        const action = {
          kind: "tap" as const,
          ...(control.target.identifier
            ? { identifier: control.target.identifier }
            : control.target.ref
              ? { identifier: control.target.ref }
              : {}),
          ...(control.label ? { label: control.label } : {}),
          ...(control.role ? { role: control.role } : {}),
        };
        const proposed = proposeNavigationFromObservation({
          before: result.beforeSnapshot,
          after: result.afterSnapshot,
          action,
        });
        try {
          await registerObservedEdge(
            session,
            result.transition.id,
            proposed.status === "proposed" ? proposed.edge : undefined,
          );
        } catch (error) {
          console.error(`discovery explore ${sessionId} register failed`, error);
          if (proposed.status === "proposed") {
            try {
              await registerObservedEdge(session, result.transition.id);
            } catch (fallbackError) {
              console.error(`discovery explore ${sessionId} draft register failed`, fallbackError);
            }
          }
        }
      }
      const afterId = result.after.id;
      if (afterId === beforeId) continue;
      if (visited.has(afterId) || stack.length >= MAX_DEPTH) {
        try {
          await goBack(session, rootTitle);
        } catch (error) {
          console.error(`discovery explore ${sessionId} return failed`, error);
          break;
        }
        continue;
      }
      visited.add(afterId);
      stack.push({
        screenId: afterId,
        queue: [...(await collectVisibleControls(session, afterId))],
      });
      await delay(150);
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
  } catch (error) {
    console.error(`discovery explore ${sessionId} failed`, error);
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
  if (!session.agent?.appMapId) {
    throw new Error("discovery explore needs an App Map to register screens");
  }
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
