import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AppMapCompiledTest, AppMapScenarioTest } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import {
  latestRunForCompiledTest,
  provenanceForTestStep,
  runEvidenceCounts,
  runObservedAt,
} from "../lib/app-map-test-evidence";
import type { PersistedRun } from "../lib/api-types";
import { cn } from "../lib/cn";
import { deviceReadiness } from "../lib/device-readiness";
import { runTargetLabel } from "../lib/run-presentation";
import { Icon } from "./icon";

type InspectorTab = "device" | "evidence";

const tabClass =
  "min-h-11 flex-1 border-b-2 px-3 text-[11px] font-semibold transition-[border-color,color,background-color,transform] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-border-strong-focus";

export function AppMapTestDeviceEvidence(props: {
  test: AppMapScenarioTest;
  selectedStepId?: string;
  compiledPlan?: AppMapCompiledTest;
  onOpenRun?: (runId: string) => void;
}) {
  const server = useServer();
  const [tab, setTab] = createSignal<InspectorTab>("device");
  const [refreshing, setRefreshing] = createSignal(false);
  const [refreshError, setRefreshError] = createSignal("");
  const [detailError, setDetailError] = createSignal("");
  const requestedRunDetails = new Set<string>();
  let deviceTab: HTMLButtonElement | undefined;
  let evidenceTab: HTMLButtonElement | undefined;

  const selectedDevice = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  const currentFrame = createMemo(() => {
    const frame = server.liveFrame();
    const device = selectedDevice();
    if (!frame?.base64 || !device) return undefined;
    return !frame.serial || frame.serial === device.serial ? frame : undefined;
  });
  const readiness = createMemo(() =>
    deviceReadiness(selectedDevice(), server.health() === "online", {
      ...(selectedDevice()?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      requireLiveScreen: true,
      liveScreenAvailable: Boolean(currentFrame()),
    }),
  );
  const latestRun = createMemo(() =>
    latestRunForCompiledTest(props.compiledPlan, server.jobs(), server.persistedRuns()),
  );
  const evidence = createMemo(() => runEvidenceCounts(latestRun()));
  const provenance = createMemo(() =>
    provenanceForTestStep(props.compiledPlan, props.selectedStepId),
  );

  createEffect(() => {
    if (tab() !== "evidence") return;
    const run = latestRun();
    if (!run || requestedRunDetails.has(run.id)) return;
    const catalog = run as { frameCount?: number; artifactCount?: number };
    const expectedEvidence =
      (catalog.frameCount ?? 0) > evidence().frames ||
      (catalog.artifactCount ?? 0) > evidence().artifacts;
    if (!expectedEvidence) return;
    requestedRunDetails.add(run.id);
    setDetailError("");
    void server
      .loadRunDetail(run.id, "persisted" in run ? Boolean(run.persisted) : true)
      .catch((error) => setDetailError(error instanceof Error ? error.message : String(error)));
  });

  function selectTab(next: InspectorTab): void {
    setTab(next);
    queueMicrotask(() => (next === "device" ? deviceTab : evidenceTab)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent): void {
    if (!event.key.startsWith("Arrow")) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    selectTab(tab() === "device" ? "evidence" : "device");
  }

  async function refreshDevicePixels(): Promise<void> {
    if (!selectedDevice() || server.health() !== "online" || refreshing()) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      await server.pollLiveFrame();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <aside
      class="flex min-h-0 flex-col border-t border-border-weak-base bg-background-base"
      aria-label="Test device and evidence"
    >
      <div class="flex" role="tablist" aria-label="Test context">
        <button
          ref={(element) => (deviceTab = element)}
          type="button"
          role="tab"
          id="test-context-device-tab"
          aria-controls="test-context-device-panel"
          aria-selected={tab() === "device"}
          tabindex={tab() === "device" ? 0 : -1}
          class={cn(
            tabClass,
            tab() === "device"
              ? "border-border-interactive-base text-text-interactive-base"
              : "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-strong",
          )}
          onKeyDown={onTabKeyDown}
          onClick={() => setTab("device")}
        >
          Device
        </button>
        <button
          ref={(element) => (evidenceTab = element)}
          type="button"
          role="tab"
          id="test-context-evidence-tab"
          aria-controls="test-context-evidence-panel"
          aria-selected={tab() === "evidence"}
          tabindex={tab() === "evidence" ? 0 : -1}
          class={cn(
            tabClass,
            tab() === "evidence"
              ? "border-border-interactive-base text-text-interactive-base"
              : "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-strong",
          )}
          onKeyDown={onTabKeyDown}
          onClick={() => setTab("evidence")}
        >
          Evidence
        </button>
      </div>

      <section
        id="test-context-device-panel"
        role="tabpanel"
        aria-labelledby="test-context-device-tab"
        hidden={tab() !== "device"}
        inert={tab() !== "device"}
        class="min-h-[260px] flex-1 overflow-y-auto p-3"
      >
        <DevicePanel
          frame={currentFrame()}
          deviceSelected={Boolean(selectedDevice())}
          deviceName={selectedDevice()?.name}
          readiness={readiness()}
          offline={server.health() !== "online"}
          refreshing={refreshing()}
          error={refreshError()}
          onRefresh={() => void refreshDevicePixels()}
        />
      </section>

      <section
        id="test-context-evidence-panel"
        role="tabpanel"
        aria-labelledby="test-context-evidence-tab"
        hidden={tab() !== "evidence"}
        inert={tab() !== "evidence"}
        class="min-h-[260px] flex-1 overflow-y-auto p-3"
      >
        <EvidencePanel
          test={props.test}
          plan={props.compiledPlan}
          selectedStepId={props.selectedStepId}
          run={latestRun()}
          counts={evidence()}
          provenance={provenance()}
          detailError={detailError()}
          devices={server.devices()}
          frameUrl={(run, frame) => server.frameUrlForPersisted(run, frame)}
          onOpenRun={props.onOpenRun}
        />
      </section>
    </aside>
  );
}

function DevicePanel(props: {
  frame?: { base64: string; mime: string; caption: string; capturedAt: number };
  deviceSelected: boolean;
  deviceName?: string;
  readiness: ReturnType<typeof deviceReadiness>;
  offline: boolean;
  refreshing: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const message = () =>
    props.readiness.kind === "ready"
      ? undefined
      : props.readiness.kind === "choose-device"
        ? {
            title: "Choose a device",
            detail: "Select a target to see its latest directly observed pixels here.",
          }
        : props.readiness;
  return (
    <div class="grid gap-3">
      <header class="flex min-h-11 items-center justify-between gap-3">
        <div class="min-w-0">
          <strong class="block truncate text-[12px] font-semibold text-text-strong">
            {props.deviceName ?? "No device selected"}
          </strong>
          <span class="mt-0.5 block text-[10.5px] text-text-weak" role="status" aria-live="polite">
            {props.refreshing
              ? "Requesting fresh pixels…"
              : props.frame
                ? `${props.offline ? "Last frame" : "Observed"} · ${formatTime(props.frame.capturedAt)}`
                : (message()?.title ?? "Live pixels available")}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          class="min-h-11 shrink-0"
          disabled={!props.deviceSelected || props.offline || props.refreshing}
          aria-busy={props.refreshing}
          onClick={props.onRefresh}
        >
          <Icon name="refresh" size={13} class={props.refreshing ? "ui-refresh-spin" : undefined} />
          {props.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      <Show
        when={props.frame}
        fallback={
          <HonestEmpty
            icon="smartphone"
            title={message()?.title ?? "Waiting for pixels"}
            detail={message()?.detail ?? "Relay has not observed a frame from this device yet."}
          />
        }
      >
        {(frame) => (
          <figure class="m-0 grid min-h-[220px] place-items-center overflow-hidden rounded-xl border border-border-weak-base bg-[var(--map-canvas)] p-2">
            <img
              src={`data:${frame().mime || "image/png"};base64,${frame().base64}`}
              alt={`${props.deviceName ?? "Selected device"}: ${frame().caption || "observed screen"}`}
              class="max-h-[360px] max-w-full rounded-lg object-contain shadow-[0_1px_2px_rgb(0_0_0/10%),0_16px_42px_-24px_rgb(0_0_0/34%)]"
            />
          </figure>
        )}
      </Show>
      <Show when={props.error}>
        <p
          class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[11px]/[1.5] text-text-critical-base"
          role="alert"
        >
          Pixels were not refreshed. {props.error}
        </p>
      </Show>
    </div>
  );
}

function EvidencePanel(props: {
  test: AppMapScenarioTest;
  plan?: AppMapCompiledTest;
  selectedStepId?: string;
  run?: ReturnType<typeof latestRunForCompiledTest>;
  counts: ReturnType<typeof runEvidenceCounts>;
  provenance: ReturnType<typeof provenanceForTestStep>;
  detailError: string;
  devices: Parameters<typeof runTargetLabel>[1];
  frameUrl: (run: PersistedRun, frame: PersistedRun["frames"][number]) => string;
  onOpenRun?: (runId: string) => void;
}) {
  const lastFrame = () => props.run?.frames?.at(-1);
  const runAsPersisted = () => {
    const run = props.run;
    if (!run) return undefined;
    if ("writtenAt" in run || ("persisted" in run && run.persisted)) {
      return run as PersistedRun;
    }
    return undefined;
  };
  return (
    <div class="grid gap-3">
      <Show
        when={props.plan}
        fallback={
          <HonestEmpty
            icon="command"
            title="Compile to inspect provenance"
            detail="Compilation resolves this Test into deterministic recipes. No run or evidence is attributed until that exact recipe executes."
          />
        }
      >
        {(plan) => (
          <>
            <section class="rounded-xl border border-border-weak-base bg-surface-base p-3">
              <p class="m-0 text-[10px] font-semibold tracking-[0.08em] text-text-weaker uppercase">
                Compiled revision
              </p>
              <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <Metric label="Map revision" value={String(plan().appMapRevision)} />
                <Metric label="Recipes" value={String(Object.keys(plan().recipes).length)} />
              </div>
              <code class="mt-3 block overflow-x-auto rounded-lg bg-background-deep p-2 font-mono text-[9.5px]/[1.45] text-text-weak">
                {plan().rootRecipeId}
              </code>
            </section>

            <Show
              when={props.run}
              fallback={
                <HonestEmpty
                  icon="clock"
                  title="No run for this compiled revision"
                  detail="Evidence will appear only after the exact compiled root recipe has run. Older or similarly named runs are intentionally not attached."
                />
              }
            >
              {(run) => (
                <section class="overflow-hidden rounded-xl border border-border-weak-base bg-surface-base">
                  <header class="flex min-h-11 items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2">
                    <div class="min-w-0">
                      <strong class="block truncate text-[12px] font-semibold text-text-strong">
                        Latest run · {run().status}
                      </strong>
                      <span class="mt-0.5 block truncate text-[10.5px] text-text-weak">
                        {runTargetLabel(run(), props.devices)}
                        {runObservedAt(run()) ? ` · ${formatDate(runObservedAt(run())!)}` : ""}
                      </span>
                    </div>
                    <Show when={props.onOpenRun}>
                      <Button
                        variant="secondary"
                        size="sm"
                        class="min-h-11 shrink-0"
                        onClick={() => props.onOpenRun?.(run().id)}
                      >
                        Open run
                      </Button>
                    </Show>
                  </header>
                  <Show when={lastFrame() && runAsPersisted()}>
                    <img
                      src={props.frameUrl(runAsPersisted()!, lastFrame()!)}
                      alt={`Latest immutable frame from ${props.test.name}`}
                      class="aspect-video w-full border-b border-border-weak-base bg-background-deep object-contain"
                    />
                  </Show>
                  <div class="grid grid-cols-3 gap-px bg-border-weak-base">
                    <Metric label="Frames" value={String(props.counts.frames)} />
                    <Metric label="Events" value={String(props.counts.events)} />
                    <Metric label="Artifacts" value={String(props.counts.artifacts)} />
                  </div>
                </section>
              )}
            </Show>

            <section class="rounded-xl border border-border-weak-base bg-surface-base p-3">
              <header class="mb-2">
                <strong class="block text-[12px] font-semibold text-text-strong">
                  {props.selectedStepId ? "Selected step provenance" : "Test provenance"}
                </strong>
                <span class="mt-0.5 block text-[10.5px] text-text-weak">
                  Immutable links from authored intent to compiled recipe steps.
                </span>
              </header>
              <For
                each={props.provenance}
                fallback={
                  <p class="m-0 rounded-lg border border-dashed border-border-weak-base p-3 text-[11px] text-text-weak">
                    This selection emitted no recipe step.
                  </p>
                }
              >
                {(item) => (
                  <article class="grid gap-1 border-t border-border-weak-base py-2.5 first:border-0">
                    <div class="flex items-center justify-between gap-2">
                      <strong class="truncate font-mono text-[10px] font-medium text-text-strong">
                        {item.recipeStepId}
                      </strong>
                      <span class="shrink-0 text-[9.5px] tabular-nums text-text-weaker">
                        Step {item.stepIndex + 1}
                      </span>
                    </div>
                    <span class="truncate text-[10px] text-text-weak">
                      {item.bindingKind}
                      {item.referencedEntityIds.length
                        ? ` · ${item.referencedEntityIds.join(", ")}`
                        : " · no map reference"}
                    </span>
                  </article>
                )}
              </For>
            </section>
          </>
        )}
      </Show>
      <Show when={props.detailError}>
        <p
          class="m-0 rounded-lg border border-border-critical-base bg-surface-critical-weak p-3 text-[11px]/[1.5] text-text-critical-base"
          role="alert"
        >
          Run details could not be loaded. {props.detailError}
        </p>
      </Show>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <span class="grid min-w-0 gap-0.5 bg-surface-base p-2.5">
      <span class="text-[9.5px] text-text-weaker">{props.label}</span>
      <strong class="truncate text-[12px] font-semibold tabular-nums text-text-strong">
        {props.value}
      </strong>
    </span>
  );
}

function HonestEmpty(props: {
  icon: "smartphone" | "command" | "clock";
  title: string;
  detail: string;
}) {
  return (
    <div class="grid min-h-[180px] place-items-center rounded-xl border border-dashed border-border-weak-base bg-surface-base p-5 text-center">
      <div class="max-w-[38ch]">
        <span class="mx-auto grid size-10 place-items-center rounded-xl bg-background-base text-text-weak">
          <Icon name={props.icon} size={17} />
        </span>
        <strong class="mt-3 block text-[13px] font-semibold text-text-strong">{props.title}</strong>
        <p class="mt-1 text-[11px]/[1.5] text-text-weak">{props.detail}</p>
      </div>
    </div>
  );
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(value: number): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
