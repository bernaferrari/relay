import { createEffect, createMemo, createSignal } from "solid-js";
import type { AppMap, DiscoverySession } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { agentTargetQueues, buildAgentWorkers, journeyWorkerOptions } from "./app-map-agent-plan";
import { deriveAppMapAreas } from "./app-map-browse";
import { useDiscoveryJourney } from "./use-discovery-journey";
import {
  AGENT_MODELS,
  type AgentState,
  type AgentStrategy,
  type AgentWorker,
} from "../components/app-map-agent-types";

const MAX_WORKERS = 12;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function useAppMapAgentExploration(appMap: () => AppMap | undefined) {
  const server = useServer();
  const [goal, setGoal] = createSignal(
    "Explore the important paths in this app and map distinct screens.",
  );
  const [minutes, setMinutes] = createSignal(5);
  const [actionBudget] = createSignal(60);
  const [strategy, setStrategy] = createSignal<AgentStrategy>("divide");
  const [targetIds, setTargetIds] = createSignal<string[]>(
    server.selectedDevice() ? [server.selectedDevice()!] : [],
  );
  const [modelIds, setModelIds] = createSignal<string[]>(["relay"]);
  const [state, setState] = createSignal<AgentState>("idle");
  const [stage, setStage] = createSignal("Ready to explore");
  const [workers, setWorkers] = createSignal<AgentWorker[]>([]);
  let runToken = 0;

  createEffect(() => {
    const selected = server.selectedDevice();
    if (selected && targetIds().length === 0) setTargetIds([selected]);
  });

  const selectedTargets = createMemo(() =>
    server
      .devices()
      .filter(
        (device) =>
          targetIds().includes(device.serial) &&
          device.connectionState !== "offline" &&
          device.connectionState !== "unauthorized",
      ),
  );
  const selectedModels = createMemo(() =>
    AGENT_MODELS.filter((model) => modelIds().includes(model.id)),
  );
  const workerCount = createMemo(() => selectedTargets().length * selectedModels().length);
  const liveProposals = createMemo(() => {
    const map = appMap();
    const sessionIds = new Set(
      workers()
        .map((worker) => worker.sessionId)
        .filter((id): id is string => Boolean(id)),
    );
    if (!map || sessionIds.size === 0) return [];
    return Object.values(map.proposals)
      .filter(
        (proposal) =>
          proposal.status === "pending" &&
          [...sessionIds].some((sessionId) => proposal.id.includes(`:${sessionId}:`)),
      )
      .sort((left, right) => right.createdAt - left.createdAt);
  });
  const proposalCount = createMemo(() => liveProposals().length);

  /** The worker worth watching: the live one, else the last that got a session. */
  const focusedWorker = createMemo(() => {
    const withSession = workers().filter((worker) => worker.sessionId);
    return withSession.find((worker) => worker.status === "running") ?? withSession.at(-1);
  });
  const journeyWorkers = createMemo(() => journeyWorkerOptions(workers()));
  /**
   * Which crawl the timeline shows. Under the divide strategy several workers
   * walk at once, so the panel follows whoever is live until a person pins a
   * worker; the pin then survives the next worker taking over.
   */
  const [pinnedJourneyWorkerId, setPinnedJourneyWorkerId] = createSignal<string | undefined>();
  const journeyWorker = createMemo(() => {
    const pinned = pinnedJourneyWorkerId();
    const withSession = workers().filter((worker) => worker.sessionId);
    return withSession.find((worker) => worker.id === pinned) ?? focusedWorker();
  });
  const journeyView = useDiscoveryJourney(
    () => journeyWorker()?.sessionId,
    () => state() === "running",
  );

  function updateWorker(id: string, patch: Partial<AgentWorker>): void {
    setWorkers((current) =>
      current.map((worker) => (worker.id === id ? { ...worker, ...patch } : worker)),
    );
  }

  async function freshest(id: string): Promise<DiscoverySession | null> {
    await server.refreshDiscoverySessions();
    return server.discoverySessions().find((session) => session.id === id) ?? null;
  }

  async function runWorker(worker: AgentWorker, token: number, runMap: AppMap): Promise<void> {
    updateWorker(worker.id, { status: "running", stage: "Starting explore" });
    try {
      const session = await server.createDiscoverySession({
        name: `${runMap.name} · ${worker.model.label} · ${worker.targetName}`,
        targetId: worker.targetId,
        agent: {
          workerId: worker.id,
          appMapId: runMap.id,
          goal: goal().trim(),
          ...(worker.focus ? { focus: worker.focus } : {}),
          provider: worker.model.provider,
          ...(worker.model.model ? { model: worker.model.model } : {}),
          source: "ui",
        },
        scope: {
          maxScreens: Math.max(24, worker.actionBudget),
          maxTransitions: worker.actionBudget,
          maxDurationMs: minutes() * 60_000,
          allowSensitiveControls: false,
        },
      });
      updateWorker(worker.id, { sessionId: session.id });
      await server.startDiscoveryExplore(session.id);
      while (token === runToken) {
        const latest = await freshest(session.id);
        if (!latest) throw new Error("The exploration record could not be reopened");
        updateWorker(worker.id, {
          stage:
            latest.status === "running"
              ? "Exploring the live app"
              : latest.status === "complete"
                ? "Ready for review"
                : latest.status,
          screens: latest.screens.length,
          interactions: latest.transitions.length,
        });
        await server.refreshAppMaps();
        const pending = liveProposals();
        if (pending[0]) updateWorker(worker.id, { proposalId: pending[0].id });
        if (latest.status !== "running" && latest.status !== "draft") break;
        await delay(800);
      }
      if (token !== runToken) {
        await server.cancelDiscoveryExplore(session.id).catch(() => undefined);
        updateWorker(worker.id, { status: "stopped", stage: "Stopped" });
        return;
      }
      const finished = await freshest(session.id);
      updateWorker(worker.id, {
        status: finished?.status === "stopped" ? "stopped" : "complete",
        stage: finished?.transitions.length ? "Ready for review" : "No new safe paths",
        screens: finished?.screens.length ?? 0,
        interactions: finished?.transitions.length ?? 0,
        proposalId: liveProposals()[0]?.id,
      });
    } catch (caught) {
      updateWorker(worker.id, {
        status: "error",
        stage: "Needs attention",
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  async function start(): Promise<void> {
    if (state() === "running") return;
    const runMap = appMap();
    if (!runMap) {
      toast("Open a map before starting exploration.", "warning");
      return;
    }
    if (!goal().trim() || !selectedTargets().length || !selectedModels().length) {
      toast("Add a goal, at least one target, and one agent perspective.", "warning");
      return;
    }
    if (workerCount() > MAX_WORKERS) {
      toast(`Choose at most ${MAX_WORKERS} target and perspective combinations.`, "warning");
      return;
    }

    const token = ++runToken;
    const areas = deriveAppMapAreas(runMap).map((area) => area.title);
    const plan = buildAgentWorkers(selectedTargets(), selectedModels(), {
      strategy: strategy(),
      areas,
      actionBudget: actionBudget(),
    });
    setWorkers(plan);
    setPinnedJourneyWorkerId(undefined);
    setState("running");
    setStage(
      plan.length === 1 ? "Exploring the app" : `${plan.length} agents are exploring the app`,
    );

    const targetQueues = agentTargetQueues(plan).map(async (queue) => {
      for (const worker of queue) {
        if (token !== runToken) break;
        await runWorker(worker, token, runMap);
      }
    });
    await Promise.allSettled(targetQueues);
    if (token !== runToken) return;
    await server.refreshAppMaps();
    const failed = workers().filter((worker) => worker.status === "error").length;
    const ready = liveProposals().length;
    setState(failed === workers().length ? "error" : "complete");
    setStage(
      ready
        ? `${ready} proposal${ready === 1 ? " is" : "s are"} ready for Keep`
        : failed
          ? "Exploration finished with issues"
          : "No new safe paths found",
    );
  }

  async function stop(): Promise<void> {
    if (state() !== "running") return;
    runToken += 1;
    setState("stopping");
    setStage("Stopping explore");
    const sessions = workers().flatMap((worker) => (worker.sessionId ? [worker.sessionId] : []));
    await Promise.allSettled(sessions.map((sessionId) => server.cancelDiscoveryExplore(sessionId)));
    setWorkers((current) =>
      current.map((worker) =>
        worker.status === "running" || worker.status === "queued"
          ? { ...worker, status: "stopped", stage: "Stopped" }
          : worker,
      ),
    );
    setState("idle");
    setStage("Exploration stopped");
  }

  async function retry(workerId: string): Promise<void> {
    if (state() === "running" || state() === "stopping") return;
    const runMap = appMap();
    const worker = workers().find((candidate) => candidate.id === workerId);
    if (!runMap || !worker) return;
    const token = ++runToken;
    updateWorker(worker.id, {
      status: "queued",
      stage: "Waiting for target",
      error: undefined,
      proposalId: undefined,
      sessionId: undefined,
      screens: 0,
      interactions: 0,
    });
    setState("running");
    setStage(`Retrying ${worker.model.shortLabel} on ${worker.targetName}`);
    await runWorker({ ...worker, status: "queued" }, token, runMap);
    if (token !== runToken) return;
    await server.refreshAppMaps();
    const updated = workers().find((candidate) => candidate.id === worker.id);
    setState(updated?.status === "error" ? "error" : "complete");
    setStage(
      updated?.proposalId ? "Proposal ready for Keep" : (updated?.stage ?? "Retry complete"),
    );
  }

  return {
    devices: server.devices,
    targetCount: () => selectedTargets().length,
    goal,
    minutes,
    strategy,
    targetIds,
    modelIds,
    state,
    stage,
    workers,
    workerCount,
    proposalCount,
    liveProposals,
    journey: journeyView.journey,
    exploreRun: journeyView.run,
    journeyLabel: () => journeyWorker()?.targetName,
    journeyWorkers,
    journeyWorkerId: () => journeyWorker()?.id,
    selectJourneyWorker: setPinnedJourneyWorkerId,
    setGoal,
    setMinutes,
    setStrategy,
    setTargetIds,
    setModelIds,
    start,
    stop,
    retry,
  };
}

export type AppMapAgentExploration = ReturnType<typeof useAppMapAgentExploration>;
