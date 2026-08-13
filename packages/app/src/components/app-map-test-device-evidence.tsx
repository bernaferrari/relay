import { createEffect, createMemo, createSignal } from "solid-js";
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

type InspectorTab = "device" | "evidence";

const tabClass =
  "min-h-11 flex-1 border-b-2 px-3 text-[11px] font-semibold transition-[border-color,color,background-color,transform] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-border-strong-focus";

export function AppMapTestDeviceEvidence(props: {
  test: AppMapScenarioTest;
  selectedStepId?: string;
  compiledPlan?: AppMapCompiledTest;
  onOpenRun?: (runId: string) => void;
  onSelectStep?: (stepId: string) => void;
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
        <ContextTab
          ref={(element) => (deviceTab = element)}
          tab="device"
          selected={tab() === "device"}
          onKeyDown={onTabKeyDown}
          onSelect={() => setTab("device")}
        />
        <ContextTab
          ref={(element) => (evidenceTab = element)}
          tab="evidence"
          selected={tab() === "evidence"}
          onKeyDown={onTabKeyDown}
          onSelect={() => setTab("evidence")}
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
          ? "border-border-interactive-base text-text-interactive-base"
          : "border-transparent text-text-weak hover:bg-surface-base-hover hover:text-text-strong",
      )}
      onKeyDown={props.onKeyDown}
      onClick={props.onSelect}
    >
      {props.tab === "device" ? "Device" : "Results"}
    </button>
  );
}
