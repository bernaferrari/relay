import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type {
  AppMap,
  DiscoveryControl,
  DiscoveryDecisionProvenance,
  DiscoverySession,
} from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { agentTargetQueues, buildAgentWorkers } from "./app-map-agent-plan";
import {
  AGENT_MODELS,
  type AgentModelOption,
  type AgentState,
  type AgentWorker,
} from "../components/app-map-agent-types";

const MAX_WORKERS = 12;

export function useAppMapAgentExploration(appMap: () => AppMap | undefined) {
  const server = useServer();
  const [goal, setGoal] = createSignal(
    "Explore the important paths in this app and map distinct screens.",
  );
  const [minutes, setMinutes] = createSignal(5);
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
  const proposalCount = createMemo(() => workers().filter((worker) => worker.proposalId).length);

  function updateWorker(id: string, patch: Partial<AgentWorker>): void {
    setWorkers((current) =>
      current.map((worker) => (worker.id === id ? { ...worker, ...patch } : worker)),
    );
  }

  async function freshest(id: string): Promise<DiscoverySession | null> {
    await server.refreshDiscoverySessions();
    return server.discoverySessions().find((session) => session.id === id) ?? null;
  }

  async function chooseControl(
    session: DiscoverySession,
    model: AgentModelOption,
  ): Promise<{
    control: DiscoveryControl | null;
    planner: "model" | "semantic";
    decision?: DiscoveryDecisionProvenance;
  }> {
    const current = session.screens.find((screen) => screen.id === session.currentScreenId);
    if (!current) return { control: null, planner: "semantic" };
    const used = new Set(
      session.transitions
        .filter((transition) => transition.fromScreenId === current.id && transition.target)
        .map((transition) => JSON.stringify(transition.target)),
    );
    const candidates = (current.controls ?? []).filter(
      (control) => !used.has(JSON.stringify(control.target)),
    );
    if (!candidates.length) return { control: null, planner: "semantic" };

    try {
      const generated = await server.generate({
        purpose: "test-plan",
        provider: model.provider,
        ...(model.model ? { model: model.model } : {}),
        count: 1,
        prompt: [
          "You are safely exploring a mobile application to build an accurate App Map.",
          `Goal: ${goal().trim()}`,
          `Current screen: ${current.title ?? "Observed screen"}`,
          `Already observed: ${session.screens.map((screen) => screen.title ?? screen.id).join(", ")}`,
          "Choose exactly one candidate that is useful and non-destructive.",
          "Prefer navigation, tabs, menus, and ordinary controls. Avoid purchases, deletion, logout, permissions, passwords, and irreversible actions.",
          `Candidates: ${candidates.map((control) => `${control.id}=${control.label}`).join(" | ")}`,
          "Return the chosen candidate id as the only value.",
        ].join("\n"),
      });
      const value = generated.values[0]?.trim() ?? "";
      const selected = candidates.find(
        (candidate) => value === candidate.id || value.includes(`"${candidate.id}"`),
      );
      if (selected) {
        return {
          control: selected,
          planner: "model",
          decision: {
            mode: "model",
            provider: generated.provider,
            model: generated.model,
            selectedControlId: selected.id,
            ...(generated.provenance?.requestId
              ? { requestId: generated.provenance.requestId }
              : {}),
            ...(generated.provenance?.promptDigest
              ? { promptDigest: generated.provenance.promptDigest }
              : {}),
            ...(generated.provenance ? { durationMs: generated.provenance.durationMs } : {}),
          },
        };
      }
    } catch {
      // Model access is optional. The deterministic semantic resolver keeps the
      // worker useful and makes the fallback visible in the progress ledger.
    }
    const selected = candidates[0] ?? null;
    return {
      control: selected,
      planner: "semantic",
      ...(selected
        ? {
            decision: {
              mode: "semantic" as const,
              provider: "relay",
              model: "semantic-resolver-v1",
              selectedControlId: selected.id,
            },
          }
        : {}),
    };
  }

  async function runWorker(worker: AgentWorker, token: number, runMap: AppMap): Promise<void> {
    updateWorker(worker.id, { status: "running", stage: "Connecting to the live app" });
    try {
      const session = await server.createDiscoverySession({
        name: `${runMap.name} · ${worker.model.label} · ${worker.targetName}`,
        targetId: worker.targetId,
        agent: {
          workerId: worker.id,
          appMapId: runMap.id,
          goal: goal().trim(),
          provider: worker.model.provider,
          ...(worker.model.model ? { model: worker.model.model } : {}),
          source: "ui",
        },
        scope: {
          maxScreens: 120,
          maxTransitions: 160,
          maxDurationMs: minutes() * 60_000,
          allowSensitiveControls: false,
        },
      });
      updateWorker(worker.id, { sessionId: session.id });
      await server.setDiscoveryStatus(session.id, "running");
      await server.captureDiscoveryScreen(session.id);
      const deadline = Date.now() + minutes() * 60_000;
      const maxActions = Math.min(120, Math.max(18, minutes() * 12));

      for (let index = 0; index < maxActions && Date.now() < deadline; index += 1) {
        if (token !== runToken) break;
        const latest = await freshest(session.id);
        if (!latest || latest.status !== "running") break;
        const current = latest.screens.find((screen) => screen.id === latest.currentScreenId);
        updateWorker(worker.id, {
          stage: `Inspecting ${current?.title ?? "the current screen"}`,
          screens: latest.screens.length,
          interactions: latest.transitions.length,
        });
        const choice = await chooseControl(latest, worker.model);
        updateWorker(worker.id, { planner: choice.planner });
        if (!choice.control) {
          const rootId = latest.screens[0]?.id;
          if (!latest.currentScreenId || !rootId || latest.currentScreenId === rootId) break;
          updateWorker(worker.id, { stage: "Returning to the previous branch" });
          if (!(await server.backtrackDiscovery(session.id))) break;
          continue;
        }
        updateWorker(worker.id, { stage: `Trying ${choice.control.label}` });
        await server.approveDiscoverySuggestion({
          sessionId: session.id,
          control: choice.control,
          ...(choice.decision ? { decision: choice.decision } : {}),
        });
      }

      if (token !== runToken) {
        await server.setDiscoveryStatus(session.id, "stopped").catch(() => undefined);
        updateWorker(worker.id, { status: "stopped", stage: "Stopped" });
        return;
      }
      const finished = await freshest(session.id);
      if (!finished) throw new Error("The exploration record could not be reopened");
      await server.setDiscoveryStatus(session.id, "complete");
      updateWorker(worker.id, {
        screens: finished.screens.length,
        interactions: finished.transitions.length,
      });
      if (!finished.transitions.length) {
        updateWorker(worker.id, { status: "complete", stage: "No new safe paths" });
        return;
      }

      updateWorker(worker.id, { stage: "Preparing a reviewable proposal" });
      const currentMap = await server.loadAppMap(runMap.id);
      const result = await server.runAction("app-map.observations.propose", {
        appMapId: currentMap.id,
        sessionId: session.id,
        expectedRevision: currentMap.revision,
        title: `${worker.model.shortLabel} on ${worker.targetName}`,
        transitionIds: finished.transitions.map((transition) => transition.id),
      });
      updateWorker(worker.id, {
        status: "complete",
        stage: "Ready for review",
        proposalId: result.proposalId,
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
      toast("Open an App Map before starting exploration.", "warning");
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
    const plan = buildAgentWorkers(selectedTargets(), selectedModels());
    setWorkers(plan);
    setState("running");
    setStage(
      plan.length === 1 ? "Exploring the app" : `${plan.length} agents are exploring the app`,
    );

    const targetQueues = agentTargetQueues(plan).map(async (queue) => {
      for (const worker of queue) {
        if (token !== runToken) break;
        // Freeze the map for this run. Switching maps while agents work must
        // never redirect their proposals into a different document.
        await runWorker(worker, token, runMap);
      }
    });
    await Promise.allSettled(targetQueues);
    if (token !== runToken) return;
    await server.refreshAppMaps();
    const failed = workers().filter((worker) => worker.status === "error").length;
    const ready = workers().filter((worker) => worker.proposalId).length;
    setState(failed === workers().length ? "error" : "complete");
    setStage(
      ready
        ? `${ready} proposal${ready === 1 ? " is" : "s are"} ready for review`
        : failed
          ? "Exploration finished with issues"
          : "No new safe paths found",
    );
  }

  async function stop(): Promise<void> {
    if (state() !== "running") return;
    runToken += 1;
    setState("stopping");
    setStage("Stopping after the current action");
    const sessions = workers().flatMap((worker) => (worker.sessionId ? [worker.sessionId] : []));
    await Promise.allSettled(
      sessions.map((sessionId) => server.setDiscoveryStatus(sessionId, "stopped")),
    );
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

  onCleanup(() => {
    if (state() !== "running" && state() !== "stopping") return;
    runToken += 1;
    for (const worker of workers()) {
      if (worker.sessionId) {
        void server.setDiscoveryStatus(worker.sessionId, "stopped").catch(() => undefined);
      }
    }
  });

  return {
    devices: server.devices,
    targetCount: () => selectedTargets().length,
    goal,
    minutes,
    targetIds,
    modelIds,
    state,
    stage,
    workers,
    workerCount,
    proposalCount,
    setGoal,
    setMinutes,
    setTargetIds,
    setModelIds,
    start,
    stop,
  };
}

export type AppMapAgentExploration = ReturnType<typeof useAppMapAgentExploration>;
