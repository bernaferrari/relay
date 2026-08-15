import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { AppMapCompiledTest, AppMapScenarioTest } from "@relay/protocol";
import { useServer } from "../context/server";
import {
  latestRunForCompiledTest,
  provenanceForTestStep,
  runEvidenceCounts,
} from "../lib/app-map-test-evidence";
import { cn } from "../lib/cn";
import { deviceReadiness } from "../lib/device-readiness";
import { AppMapTestDevicePanel } from "./app-map-test-device-panel";
import { AppMapTestEvidencePanel } from "./app-map-test-evidence-panel";

export type InspectorTab = "device" | "evidence";

const tabClass =
  "relative min-h-11 flex-1 rounded-lg px-3 text-[11px] font-semibold transition-[color,background-color,box-shadow,transform] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus";

export function AppMapTestDeviceEvidence(props: {
  test: AppMapScenarioTest;
  selectedStepId?: string;
  compiledPlan?: AppMapCompiledTest;
  onOpenRun?: (runId: string) => void;
  onSelectStep?: (stepId: string) => void;
  selectedTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  hideTabs?: boolean;
}) {
  const server = useServer();
  const [tab, setTab] = createSignal<InspectorTab>("device");
  const [refreshing, setRefreshing] = createSignal(false);
  const [interacting, setInteracting] = createSignal(false);
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
  const currentSnapshot = createMemo(() => {
    const snapshot = server.snapshot?.();
    const device = selectedDevice();
    if (!snapshot || !device) return null;
    return !snapshot.serial || snapshot.serial === device.serial ? snapshot : null;
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
    if (props.selectedTab && props.selectedTab !== tab()) setTab(props.selectedTab);
  });

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
    props.onTabChange?.(next);
    queueMicrotask(() => (next === "device" ? deviceTab : evidenceTab)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent): void {
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
      await server.pollLiveSnapshot();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  const interactionBlocker = createMemo(() => {
    if (server.health() !== "online") return "Relay is offline. Reconnect to control this device.";
    if (!selectedDevice()) return "Choose a device before interacting with its screen.";
    if (readiness().kind !== "ready") {
      return "Keep the device connected and unlocked before interacting.";
    }
    const controlIssue = server.controlIssue?.();
    if (controlIssue) return controlIssue;
    if (!server.selectedLeaseId?.()) {
      return "This preview is view-only until Relay has control of the selected device.";
    }
    return undefined;
  });

  async function interactWithDevice(
    step: Parameters<typeof server.interactStep>[0],
  ): Promise<boolean> {
    if (interactionBlocker() || interacting()) return false;
    setInteracting(true);
    try {
      return await server.interactStep(step, "test preview tap");
    } finally {
      setInteracting(false);
    }
  }

  return (
    <aside
      class="flex h-full min-h-0 flex-col border-t border-border-weak-base bg-background-base"
      aria-label="Test device and evidence"
    >
      <div
        class={props.hideTabs ? "hidden" : "flex gap-1 border-b border-border-weak-base p-1.5"}
        role="tablist"
        aria-label="Test context"
        aria-hidden={props.hideTabs ? "true" : undefined}
      >
        <ContextTab
          ref={(element) => (deviceTab = element)}
          tab="device"
          selected={tab() === "device"}
          onKeyDown={onTabKeyDown}
          onSelect={() => selectTab("device")}
        />
        <ContextTab
          ref={(element) => (evidenceTab = element)}
          tab="evidence"
          selected={tab() === "evidence"}
          count={latestRun() ? 1 : 0}
          onKeyDown={onTabKeyDown}
          onSelect={() => selectTab("evidence")}
        />
      </div>
      <section
        id="test-context-device-panel"
        role="tabpanel"
        aria-labelledby="test-context-device-tab"
        hidden={tab() !== "device"}
        inert={tab() !== "device"}
        class="min-h-[260px] flex-1 overflow-y-auto p-3"
      >
        <AppMapTestDevicePanel
          frame={currentFrame()}
          snapshot={currentSnapshot()}
          platform={selectedDevice()?.platform}
          deviceSelected={Boolean(selectedDevice())}
          deviceName={selectedDevice()?.name}
          readiness={readiness()}
          offline={server.health() !== "online"}
          refreshing={refreshing()}
          interacting={interacting()}
          interactionBlocker={interactionBlocker()}
          error={refreshError()}
          onRefresh={() => void refreshDevicePixels()}
          onInteract={interactWithDevice}
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
        <AppMapTestEvidencePanel
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
          onSelectStep={props.onSelectStep}
        />
      </section>
    </aside>
  );
}

function ContextTab(props: {
  ref: (element: HTMLButtonElement) => void;
  tab: InspectorTab;
  selected: boolean;
  count?: number;
  onKeyDown: (event: KeyboardEvent) => void;
  onSelect: () => void;
}) {
  return (
    <button
      ref={props.ref}
      type="button"
      role="tab"
      id={`test-context-${props.tab}-tab`}
      aria-controls={`test-context-${props.tab}-panel`}
      aria-selected={props.selected}
      tabindex={props.selected ? 0 : -1}
      class={cn(
        tabClass,
        props.selected
          ? "bg-surface-base-active text-text-strong shadow-[inset_0_0_0_1px_var(--border-strong-base)]"
          : "text-text-weak hover:bg-surface-base-hover hover:text-text-strong",
      )}
      onKeyDown={props.onKeyDown}
      onClick={props.onSelect}
    >
      <span>{props.tab === "device" ? "Device" : "Results"}</span>
      <Show when={props.tab === "evidence" && props.count !== undefined}>
        <span
          class={cn(
            "ml-1 inline-grid min-w-5 place-items-center rounded-full px-1.5 text-[9px] tabular-nums",
            props.selected
              ? "bg-background-base text-text-strong"
              : "bg-surface-base text-text-weak",
          )}
          aria-label={`${props.count} ${props.count === 1 ? "result" : "results"}`}
        >
          {props.count}
        </span>
      </Show>
    </button>
  );
}
