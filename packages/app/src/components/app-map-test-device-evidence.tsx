import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestStep,
} from "@relay/protocol";
import { useServer } from "../context/server";
import {
  latestRunForCompiledTest,
  provenanceForTestStep,
  runEvidenceCounts,
} from "../lib/app-map-test-evidence";
import { cn } from "../lib/cn";
import { productIconButton } from "../lib/ui";
import { deviceReadiness } from "../lib/device-readiness";
import { scenarioStepTitle } from "../lib/app-map-test-step-path";
import { AppMapTestDevicePanel } from "./app-map-test-device-panel";
import { AppMapTestEvidencePanel } from "./app-map-test-evidence-panel";
import { matchLiveScreen } from "../lib/app-map-live-location";
import { useAppMapScrollSurface } from "../lib/use-app-map-scroll-surface";
import { interactionSucceeded } from "../lib/ios-interaction-safety";
import { Icon } from "./icon";

export type InspectorTab = "device" | "evidence";

/**
 * The right rail. It answers one question — "what does this step look like?" —
 * either right now on the device or as it was in the last run, so the two views
 * are one switch rather than two unrelated column headers.
 */
export function AppMapTestDeviceEvidence(props: {
  appMap?: AppMap;
  test: AppMapScenarioTest;
  selectedStepId?: string;
  compiledPlan?: AppMapCompiledTest;
  onOpenRun?: (runId: string) => void;
  onSelectStep?: (stepId: string) => void;
  selectedTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  hideTabs?: boolean;
  onClose?: () => void;
  onChooseTarget?: () => void;
}) {
  const server = useServer();
  const [tab, setTab] = createSignal<InspectorTab>("device");
  const [refreshing, setRefreshing] = createSignal(false);
  const [interacting, setInteracting] = createSignal(false);
  const [refreshError, setRefreshError] = createSignal("");
  const [detailError, setDetailError] = createSignal("");
  const [recovering, setRecovering] = createSignal(false);
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
  const selectedStep = createMemo(() => findTestStep(props.test.steps, props.selectedStepId));
  const selectedStepLabel = createMemo(() => {
    const step = selectedStep();
    const map = props.appMap;
    if (!step) return undefined;
    return map ? scenarioStepTitle(map, step) : step.intent;
  });
  const mappedLiveScreenId = createMemo(() => {
    const map = props.appMap;
    if (!map) return undefined;
    const match = matchLiveScreen(Object.values(map.screens), [
      currentSnapshot()?.screenIdentity?.fingerprint,
    ]);
    return match.kind === "here" ? match.screenId : undefined;
  });
  const captureScreenId = createMemo(
    () =>
      mappedLiveScreenId() ??
      (props.appMap ? screenIdForTestStep(props.appMap, selectedStep()) : undefined),
  );
  const scrollSurface = useAppMapScrollSurface({
    activeAppMap: () => props.appMap,
    screenId: captureScreenId,
  });

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
      await server.refreshTargetHealth?.();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  const interactionBlocker = createMemo(() => {
    if (server.health() !== "online") return "Relay is offline. Reconnect to control this device.";
    if (!selectedDevice()) return "Choose a device before interacting with its screen.";
    const health = server.targetHealth?.();
    if (health?.input.state === "uncertain") {
      return "Review the last device action before sending another one.";
    }
    if (health?.input.state === "blocked") {
      return "Relay has stopped device input until its blocker is resolved.";
    }
    if (health && ["recovering", "needs-human", "quarantined"].includes(health.overall)) {
      return health.overall === "recovering"
        ? "Relay is restoring device control."
        : "Review the device status before sending another action.";
    }
    const targetReadiness = readiness();
    if (targetReadiness.kind !== "ready") {
      return "detail" in targetReadiness
        ? targetReadiness.detail
        : "Relay is getting this target ready for input.";
    }
    const controlIssue = server.controlIssue?.();
    if (controlIssue) return controlIssue;
    if (!server.selectedLeaseId?.()) {
      return "Relay is getting this target ready for input.";
    }
    return undefined;
  });

  const recoveryLabel = createMemo(() => {
    if (!selectedDevice()) return "Choose device";
    if (server.health() !== "online") return "Retry connection";
    if (server.controlIssue?.() || !server.selectedLeaseId?.()) return "Take control";
    return "Try again";
  });

  async function recoverDevice(): Promise<void> {
    if (recovering()) return;
    if (!selectedDevice()) {
      props.onChooseTarget?.();
      return;
    }
    setRecovering(true);
    setRefreshError("");
    try {
      if (server.health() !== "online") {
        await server.retryConnection();
      } else if (server.controlIssue?.() || !server.selectedLeaseId?.()) {
        await server.takeControlOfSelectedDevice();
      } else {
        await server.recoverSelectedTarget("observe");
      }
      await refreshDevicePixels();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecovering(false);
    }
  }

  async function interactWithDevice(
    step: Parameters<typeof server.interactStep>[0],
  ): Promise<boolean> {
    if (interactionBlocker() || interacting()) return false;
    setInteracting(true);
    try {
      return interactionSucceeded(await server.interactStep(step, "test preview tap"));
    } finally {
      setInteracting(false);
      void server.refreshTargetHealth?.();
    }
  }

  return (
    <aside
      class="flex h-full min-h-0 flex-col bg-background-base"
      aria-label="Device and results for the selected step"
    >
      <div
        class={cn(
          "flex min-h-9 shrink-0 items-center gap-1 border-b border-border-weak-base px-2 py-1",
          props.hideTabs && "hidden",
        )}
        aria-hidden={props.hideTabs ? "true" : undefined}
      >
        <Show when={props.onClose}>
          <button
            type="button"
            class={cn(productIconButton, "size-8")}
            aria-label="Hide device"
            onClick={() => props.onClose?.()}
          >
            <Icon name="chevron-right" size={15} />
          </button>
        </Show>
        <div
          class="flex min-w-0 flex-1 gap-0.5 rounded-md bg-surface-base p-0.5"
          role="tablist"
          aria-label="Device view"
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
      </div>

      <Show when={selectedStepLabel()}>
        {(label) => (
          <p
            class="m-0 flex shrink-0 items-center gap-1.5 border-b border-border-weak-base px-2.5 py-1.5 text-caption/[1.3] text-text-weak"
            data-test-rail-step={props.selectedStepId}
          >
            <Icon name="arrow-right" size={11} class="shrink-0 text-text-weaker" />
            <span class="min-w-0 truncate">
              <span class="text-text-weaker">Showing </span>
              <span class="font-medium text-text-base">{label()}</span>
            </span>
          </p>
        )}
      </Show>

      <section
        id="test-context-device-panel"
        role="tabpanel"
        aria-labelledby="test-context-device-tab"
        hidden={tab() !== "device"}
        inert={tab() !== "device"}
        class="min-h-0 flex-1 overflow-y-auto p-2.5"
      >
        <AppMapTestDevicePanel
          frame={currentFrame()}
          snapshot={currentSnapshot()}
          platform={selectedDevice()?.platform}
          deviceSelected={Boolean(selectedDevice())}
          deviceName={selectedDevice()?.name}
          targetHealth={server.targetHealth?.() ?? undefined}
          readiness={readiness()}
          offline={server.health() !== "online"}
          refreshing={refreshing()}
          interacting={interacting()}
          interactionBlocker={interactionBlocker()}
          fullPageCapture={{
            busy: scrollSurface.captureProps().busy,
            disabledReason: captureScreenId()
              ? scrollSurface.captureProps().disabledReason
              : "Select a screen-bound step or open a mapped screen to capture its full page.",
            policy: scrollSurface.captureProps().policy,
            hasSurface: Boolean(scrollSurface.surface()),
            onCapture: scrollSurface.captureProps().onCapture,
          }}
          recoveryAction={
            interactionBlocker()
              ? {
                  label: recoveryLabel(),
                  busy: recovering(),
                  onAction: () => void recoverDevice(),
                }
              : undefined
          }
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
        class="min-h-0 flex-1 overflow-y-auto p-2.5"
      >
        <AppMapTestEvidencePanel
          appMap={props.appMap}
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

function findTestStep(
  steps: readonly AppMapScenarioTestStep[],
  stepId: string | undefined,
): AppMapScenarioTestStep | undefined {
  if (!stepId) return undefined;
  for (const step of steps) {
    if (step.id === stepId) return step;
    const nested =
      step.kind === "decision"
        ? [...step.thenSteps, ...(step.elseSteps ?? [])]
        : step.kind === "loop"
          ? step.steps
          : [];
    const match = findTestStep(nested, stepId);
    if (match) return match;
  }
  return undefined;
}

function screenIdForTestStep(
  map: AppMap,
  step: AppMapScenarioTestStep | undefined,
): string | undefined {
  if (!step || step.binding.status !== "resolved") return undefined;
  if (
    step.kind === "validation" &&
    step.binding.kind === "assertion" &&
    step.binding.assertion.kind === "screen"
  ) {
    return step.binding.assertion.screenId;
  }
  if (step.kind !== "instruction" || step.binding.kind !== "connections") return undefined;
  for (const connectionId of step.binding.connectionIds.toReversed()) {
    const destination = map.connections[connectionId]?.destination;
    if (destination?.kind === "screen") return destination.screenId;
  }
  return undefined;
}

/**
 * "Live" and "Last run" instead of "Device" and "Results": the map view already
 * owns the word Results, and these two are the same subject at two moments.
 */
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
        "min-h-7 flex-1 rounded px-2 text-caption font-medium",
        "transition-colors duration-hover motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong-focus",
        props.selected
          ? "bg-background-base text-text-strong shadow-[0_1px_2px_rgb(0_0_0/6%)]"
          : "text-text-weak hover:text-text-strong",
      )}
      onKeyDown={props.onKeyDown}
      onClick={props.onSelect}
    >
      {props.tab === "device" ? "Live" : "Last run"}
      <Show when={props.tab === "evidence" && props.count}>
        <span
          class="ml-1 inline-block size-1.5 rounded-full bg-icon-interactive-base align-middle"
          aria-label="This test has a result"
        />
      </Show>
    </button>
  );
}
