import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import type { AppMap, DiscoveryControl, DiscoverySession } from "@relay/protocol";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { cn } from "../lib/cn";
import { productPrimary, productSecondary } from "../lib/ui";
import { Icon } from "./icon";

type AgentState = "idle" | "running" | "stopping" | "complete" | "error";
type AgentEvent = { id: number; label: string; detail?: string; tone?: "success" | "warning" };

export function AppMapAgentPanel(props: {
  appMap: AppMap;
  onClose: () => void;
  onProposalReady: () => void;
}) {
  const server = useServer();
  const [goal, setGoal] = createSignal(
    "Explore the important paths in this app and map distinct screens.",
  );
  const [minutes, setMinutes] = createSignal(5);
  const [state, setState] = createSignal<AgentState>("idle");
  const [stage, setStage] = createSignal("Ready to explore");
  const [events, setEvents] = createSignal<AgentEvent[]>([]);
  const [sessionId, setSessionId] = createSignal<string>();
  const [proposalId, setProposalId] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [planner, setPlanner] = createSignal<"openrouter" | "semantic">("openrouter");
  let runToken = 0;
  let eventSequence = 0;

  const selectedDevice = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  const activeSession = createMemo(
    () => server.discoverySessions().find((session) => session.id === sessionId()) ?? null,
  );

  onCleanup(() => {
    runToken += 1;
    const id = sessionId();
    if (id && (state() === "running" || state() === "stopping")) {
      void server.setDiscoveryStatus(id, "stopped").catch(() => undefined);
    }
  });

  function append(label: string, detail?: string, tone?: AgentEvent["tone"]): void {
    setEvents((current) => [
      ...current.slice(-39),
      { id: ++eventSequence, label, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) },
    ]);
  }

  async function chooseControl(session: DiscoverySession): Promise<DiscoveryControl | null> {
    const current = session.screens.find((screen) => screen.id === session.currentScreenId);
    if (!current) return null;
    const used = new Set(
      session.transitions
        .filter((transition) => transition.fromScreenId === current.id && transition.target)
        .map((transition) => JSON.stringify(transition.target)),
    );
    const candidates = (current.controls ?? []).filter(
      (control) => !used.has(JSON.stringify(control.target)),
    );
    if (!candidates.length) return null;

    try {
      const generated = await server.generate({
        purpose: "test-plan",
        provider: "openrouter",
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
        setPlanner("openrouter");
        return selected;
      }
    } catch {
      // OpenRouter is optional. Relay's semantic resolver remains useful and
      // deterministic without a key or network connection.
    }
    setPlanner("semantic");
    return candidates[0] ?? null;
  }

  async function freshest(id: string): Promise<DiscoverySession | null> {
    await server.refreshDiscoverySessions();
    return server.discoverySessions().find((session) => session.id === id) ?? null;
  }

  async function start(): Promise<void> {
    if (state() === "running") return;
    const device = selectedDevice();
    if (!device) {
      toast("Choose a device from the top bar before starting an exploration.", "warning");
      return;
    }
    const token = ++runToken;
    setState("running");
    setError(undefined);
    setProposalId(undefined);
    setEvents([]);
    setPlanner("openrouter");
    try {
      setStage("Connecting to the live app");
      append("Exploration started", device.name);
      const session = await server.createDiscoverySession({
        name: `${props.appMap.name} · Agent exploration`,
        targetId: device.serial,
        scope: {
          maxScreens: 120,
          maxTransitions: 160,
          maxDurationMs: minutes() * 60_000,
          allowSensitiveControls: false,
        },
      });
      setSessionId(session.id);
      await server.setDiscoveryStatus(session.id, "running");
      await server.captureDiscoveryScreen(session.id);
      const deadline = Date.now() + minutes() * 60_000;
      const maxActions = Math.min(120, Math.max(18, minutes() * 12));

      for (let index = 0; index < maxActions && Date.now() < deadline; index += 1) {
        if (token !== runToken) break;
        const latest = await freshest(session.id);
        if (!latest || latest.status !== "running") break;
        const current = latest.screens.find((screen) => screen.id === latest.currentScreenId);
        setStage(`Inspecting ${current?.title ?? "the current screen"}`);
        const control = await chooseControl(latest);
        if (!control) {
          const rootId = latest.screens[0]?.id;
          if (!latest.currentScreenId || !rootId || latest.currentScreenId === rootId) break;
          setStage("Returning to the previous branch");
          append("Backtracked", "No unexplored safe controls here");
          if (!(await server.backtrackDiscovery(session.id))) break;
          continue;
        }
        setStage(`Trying ${control.label}`);
        append("Selected a safe control", control.label);
        const beforeCount = latest.screens.length;
        await server.approveDiscoverySuggestion({ sessionId: session.id, control });
        const after = await freshest(session.id);
        if (!after) break;
        if (after.screens.length > beforeCount) {
          const reached = after.screens.at(-1);
          append("Discovered a screen", reached?.title ?? "New screen", "success");
        } else {
          append("Observed an interaction", "The semantic screen did not change");
        }
      }

      if (token !== runToken) {
        setState("idle");
        setStage("Exploration stopped");
        return;
      }
      const finished = await freshest(session.id);
      if (!finished) throw new Error("The exploration record could not be reopened");
      await server.setDiscoveryStatus(session.id, "complete");
      if (!finished.transitions.length) {
        setState("complete");
        setStage("No new safe paths found");
        append("Exploration complete", "Nothing was changed", "warning");
        return;
      }

      setStage("Preparing a reviewable map proposal");
      const currentMap = await server.loadAppMap(props.appMap.id);
      const result = await server.runAction("app-map.observations.propose", {
        appMapId: currentMap.id,
        sessionId: session.id,
        expectedRevision: currentMap.revision,
        title: `Agent exploration · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        transitionIds: finished.transitions.map((transition) => transition.id),
      });
      setProposalId(result.proposalId);
      await server.refreshAppMaps();
      setState("complete");
      setStage("Ready for your review");
      append(
        "Proposal ready",
        `${finished.screens.length} screens · ${finished.transitions.length} interactions`,
        "success",
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setState("error");
      setStage("Exploration needs attention");
      append("Exploration stopped", message, "warning");
    }
  }

  async function stop(): Promise<void> {
    if (state() !== "running") return;
    runToken += 1;
    setState("stopping");
    setStage("Stopping after the current action");
    const id = sessionId();
    if (id) {
      await server.setDiscoveryStatus(id, "stopped").catch(() => undefined);
    }
    setState("idle");
    setStage("Exploration stopped");
  }

  return (
    <aside
      class="ui-panel-in absolute top-3 right-3 bottom-3 z-40 flex w-[min(390px,calc(100%-24px))] flex-col overflow-hidden rounded-[16px] bg-[var(--v2-background-bg-base)] shadow-[0_0_0_1px_var(--v2-border-border-strong),0_22px_70px_rgb(0_0_0/24%)]"
      aria-label="Agent exploration"
    >
      <header class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--v2-border-border-muted)] px-4">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
            <Icon name="sparkle" size={14} />
          </span>
          <span class="min-w-0">
            <strong class="block truncate text-[13px] font-semibold text-[var(--text-strong)]">
              Explore with Relay
            </strong>
            <small class="block truncate text-[10px] text-[var(--text-weak)]">
              Changes stay proposals until you approve them
            </small>
          </span>
        </div>
        <button
          type="button"
          class="grid size-10 place-items-center rounded-[9px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)]"
          aria-label="Close agent exploration"
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Show
          when={state() === "idle" || (state() === "error" && !activeSession())}
          fallback={
            <AgentProgress
              state={state()}
              stage={stage()}
              planner={planner()}
              session={activeSession()}
              events={events()}
              error={error()}
            />
          }
        >
          <div class="grid gap-5">
            <section>
              <h2 class="text-[20px]/[1.2] font-semibold tracking-[-0.03em] text-[var(--text-strong)]">
                Give the app a goal
              </h2>
              <p class="mt-1.5 text-[12px]/[1.55] text-[var(--text-weak)]">
                Relay observes the UI, chooses only from safe visible controls, and records every
                decision and resulting screen.
              </p>
            </section>
            <label class="grid gap-1.5">
              <span class="text-[10.5px] font-semibold text-[var(--text-base)]">
                What should it understand?
              </span>
              <textarea
                class="min-h-28 resize-y rounded-[11px] border border-[var(--v2-border-border-strong)] bg-[var(--v2-background-bg-layer-01)] px-3 py-2.5 text-[16px]/[1.5] text-[var(--text-strong)] outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-[var(--text-weak)] focus:border-[var(--text-interactive-base)] focus:bg-[var(--v2-background-bg-base)] focus:shadow-[0_0_0_3px_var(--product-accent-soft)] min-[681px]:text-[12.5px]"
                value={goal()}
                onInput={(event) => setGoal(event.currentTarget.value)}
              />
            </label>
            <fieldset class="grid gap-2">
              <legend class="text-[10.5px] font-semibold text-[var(--text-base)]">
                Time budget
              </legend>
              <div class="grid grid-cols-3 gap-1 rounded-[10px] bg-[var(--v2-background-bg-layer-01)] p-1">
                <For each={[5, 10, 20]}>
                  {(value) => (
                    <button
                      type="button"
                      class={cn(
                        "min-h-10 rounded-[8px] text-[11.5px] font-medium text-[var(--text-base)] transition-[background-color,color,box-shadow] duration-150",
                        minutes() === value &&
                          "bg-[var(--v2-background-bg-base)] text-[var(--text-strong)] shadow-[0_1px_4px_rgb(0_0_0/12%)]",
                      )}
                      aria-pressed={minutes() === value}
                      onClick={() => setMinutes(value)}
                    >
                      {value} min
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
            <div class="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 gap-y-3 rounded-[11px] bg-[var(--v2-background-bg-layer-01)] p-3 text-[11px]/[1.45] text-[var(--text-base)]">
              <Icon name="smartphone" size={15} class="mt-0.5 text-[var(--text-weak)]" />
              <span>
                <strong class="font-medium text-[var(--text-strong)]">
                  {selectedDevice()?.name ?? "No device selected"}
                </strong>
                <br />
                One target is controlled at a time; target-set runs stay separate.
              </span>
              <Icon name="check" size={14} class="mt-0.5 text-[var(--icon-success-base)]" />
              <span>
                Purchases, deletion, logout, passwords, and permission prompts are blocked by
                default.
              </span>
              <Icon name="info" size={14} class="mt-0.5 text-[var(--text-weak)]" />
              <span>Every accepted path becomes a proposal, never a silent map edit.</span>
            </div>
          </div>
        </Show>
      </div>

      <footer class="flex min-h-[68px] shrink-0 items-center justify-end gap-2 border-t border-[var(--v2-border-border-muted)] px-4">
        <Show
          when={state() === "running" || state() === "stopping"}
          fallback={
            <Show
              when={proposalId()}
              fallback={
                <button
                  type="button"
                  class={productPrimary}
                  disabled={!selectedDevice() || !goal().trim()}
                  onClick={() => void start()}
                >
                  <Icon name="play" size={13} /> Start exploring
                </button>
              }
            >
              <button type="button" class={productPrimary} onClick={props.onProposalReady}>
                <Icon name="check" size={13} /> Review proposal
              </button>
            </Show>
          }
        >
          <button
            type="button"
            class={productSecondary}
            disabled={state() === "stopping"}
            onClick={() => void stop()}
          >
            <Icon name="square" size={12} /> {state() === "stopping" ? "Stopping…" : "Stop"}
          </button>
        </Show>
      </footer>
    </aside>
  );
}

function AgentProgress(props: {
  state: AgentState;
  stage: string;
  planner: "openrouter" | "semantic";
  session: DiscoverySession | null;
  events: AgentEvent[];
  error?: string;
}) {
  return (
    <div class="grid gap-5">
      <section class="grid gap-3 rounded-[12px] bg-[var(--v2-background-bg-layer-01)] p-4">
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
            <i
              class={cn(
                "size-2 rounded-full",
                props.state === "error"
                  ? "bg-[var(--icon-critical-base)]"
                  : props.state === "complete"
                    ? "bg-[var(--icon-success-base)]"
                    : "bg-[var(--text-interactive-base)] motion-safe:animate-pulse",
              )}
            />
            {props.state === "complete"
              ? "Complete"
              : props.state === "error"
                ? "Needs attention"
                : "Working"}
          </span>
          <span class="rounded-full bg-[var(--v2-background-bg-base)] px-2 py-1 text-[9px] font-medium text-[var(--text-weak)] shadow-[0_0_0_1px_var(--v2-border-border-muted)]">
            {props.planner === "openrouter" ? "OpenRouter planner" : "Semantic planner"}
          </span>
        </div>
        <div>
          <h2 class="text-[18px]/[1.25] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            {props.stage}
          </h2>
          <p class="mt-1 text-[11px] text-[var(--text-weak)] tabular-nums">
            {props.session?.screens.length ?? 0} screens · {props.session?.transitions.length ?? 0}{" "}
            interactions
          </p>
        </div>
        <Show when={props.error}>
          <p
            role="alert"
            class="rounded-[9px] bg-[color-mix(in_srgb,var(--icon-critical-base)_9%,transparent)] px-3 py-2 text-[11px]/[1.45] text-[var(--icon-critical-base)]"
          >
            {props.error}
          </p>
        </Show>
      </section>
      <section>
        <h3 class="mb-2 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
          Activity
        </h3>
        <ol class="grid gap-1">
          <For
            each={[...props.events].reverse()}
            fallback={
              <li class="py-6 text-center text-[11px] text-[var(--text-weak)]">
                Waiting for the first observation…
              </li>
            }
          >
            {(event) => (
              <li class="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 rounded-[9px] px-2 py-2 hover:bg-[var(--v2-background-bg-layer-01)]">
                <span
                  class={cn(
                    "mt-1 grid size-4 place-items-center rounded-full",
                    event.tone === "success"
                      ? "bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] text-[var(--icon-success-base)]"
                      : event.tone === "warning"
                        ? "bg-[color-mix(in_srgb,var(--icon-warning-base)_12%,transparent)] text-[var(--icon-warning-base)]"
                        : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                  )}
                >
                  <Icon
                    name={
                      event.tone === "success"
                        ? "check"
                        : event.tone === "warning"
                          ? "alert"
                          : "arrow-right"
                    }
                    size={9}
                  />
                </span>
                <span class="min-w-0">
                  <strong class="block truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                    {event.label}
                  </strong>
                  <Show when={event.detail}>
                    <small class="mt-0.5 block text-[10px]/[1.4] text-[var(--text-weak)]">
                      {event.detail}
                    </small>
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ol>
      </section>
    </div>
  );
}
