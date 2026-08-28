import { Show, createMemo, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { usePlatform } from "../context/platform";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { deviceReadiness } from "../lib/device-readiness";
import {
  EMPTY_FIRST_OPERATOR_RUN_PREFERENCE,
  FIRST_OPERATOR_RUN_STORAGE_KEY,
  deriveFirstOperatorRunState,
  parseFirstOperatorRunPreference,
  serializeFirstOperatorRunPreference,
  shouldShowFirstOperatorRun,
  type FirstOperatorRunPreference,
} from "../lib/first-operator-run";
import { firstTestTargetStatus } from "../lib/onboarding";
import { Icon } from "./icon";

export function useFirstOperatorRun(actions: {
  firstTestVisible: () => boolean;
  onOpenTargets: () => void;
  onShowLiveDevice: () => void;
  onOpenCombine: (combineId?: string) => void;
  onOpenTest: () => void;
}) {
  const server = useServer();
  const recorder = useRecorder();
  const platform = usePlatform();
  const [preference, setPreference] = createSignal<FirstOperatorRunPreference>(
    EMPTY_FIRST_OPERATOR_RUN_PREFERENCE,
  );
  const [ready, setReady] = createSignal(false);
  const [forceOpen, setForceOpen] = createSignal(false);

  onMount(() => {
    void Promise.resolve(platform.storage.get(FIRST_OPERATOR_RUN_STORAGE_KEY))
      .then((stored) => setPreference(parseFirstOperatorRunPreference(stored)))
      .catch(() => setPreference(EMPTY_FIRST_OPERATOR_RUN_PREFERENCE))
      .finally(() => setReady(true));
  });

  function persist(next: FirstOperatorRunPreference): void {
    setPreference(next);
    void Promise.resolve(
      platform.storage.set(
        FIRST_OPERATOR_RUN_STORAGE_KEY,
        serializeFirstOperatorRunPreference(next),
      ),
    ).catch(() => undefined);
  }

  const target = createMemo(() =>
    server.devices().find((device) => device.serial === server.selectedDevice()),
  );
  const liveFrame = () => server.liveFrame();
  const snapshot = () => server.snapshot();
  const targetStatus = createMemo(() =>
    firstTestTargetStatus({
      online: server.health() === "online",
      target: target(),
      readiness: deviceReadiness(target(), server.health() === "online", {
        ...(target()?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
        liveCaptureIssue: server.liveCaptureIssue(),
        recordingIssue: recorder.recordingIssue(),
        requireLiveScreen: true,
        liveScreenAvailable:
          Boolean(liveFrame()?.base64) &&
          (!liveFrame()?.serial || liveFrame()?.serial === target()?.serial),
      }),
      hasControl: Boolean(server.selectedLeaseId()),
      controlIssue: server.controlIssue(),
    }),
  );
  const state = createMemo(() =>
    deriveFirstOperatorRunState({
      target: targetStatus(),
      device: target(),
      inspection: snapshot()
        ? {
            inspectable: snapshot()!.inspectable,
            inspectionState: snapshot()!.inspectionState,
            nodeCount: snapshot()!.nodes?.length,
            source: snapshot()!.source,
            inspectionError: snapshot()!.inspectionError,
          }
        : undefined,
      map: server.selectedAppMap() ?? undefined,
      runs: server.persistedRuns(),
    }),
  );
  const visible = createMemo(
    () =>
      ready() &&
      (forceOpen() ||
        shouldShowFirstOperatorRun(preference(), state(), actions.firstTestVisible())),
  );

  function activate(): void {
    const next = state();
    if (next.action === "device") {
      if (next.stage === "device" && targetStatus().kind === "choose-target") {
        actions.onOpenTargets();
        return;
      }
      actions.onShowLiveDevice();
      return;
    }
    if (next.action === "combine") {
      actions.onOpenCombine(next.combineId);
      return;
    }
    if (next.action === "test") actions.onOpenTest();
  }

  return {
    visible,
    state,
    activate,
    dismiss: (reason: "dismissed" | "completed") => {
      const now = Date.now();
      persist({
        ...preference(),
        ...(reason === "completed" ? { completedAt: now } : { dismissedAt: now }),
      });
      setForceOpen(false);
    },
  };
}

export function FirstOperatorRunCard(props: {
  title: string;
  detail: string;
  actionLabel: string;
  deviceLabel: string;
  deviceDetail: string;
  stage: "device" | "bind" | "run" | "complete";
  onAction: () => void;
  onDismiss: (reason: "dismissed" | "completed") => void;
}) {
  return (
    <section
      class="min-w-0 w-[min(100%,390px)] rounded-2xl border border-[var(--map-divider)] bg-[var(--map-control-surface)] p-4 text-left shadow-[var(--map-elevation-panel)]"
      aria-labelledby="first-operator-run-title"
      data-first-operator-run={props.stage}
    >
      <header class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="m-0 text-micro font-semibold tracking-[0.08em] text-[var(--text-weaker)] uppercase">
            First operator run
          </p>
          <h2
            id="first-operator-run-title"
            class="mt-1 mb-0 text-body/[1.25] font-semibold text-[var(--text-strong)]"
          >
            {props.title}
          </h2>
        </div>
        <button
          type="button"
          class="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--text-weak)] hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
          aria-label="Hide first operator run guide"
          onClick={() => props.onDismiss(props.stage === "complete" ? "completed" : "dismissed")}
        >
          <Icon name="x" size={15} />
        </button>
      </header>
      <p
        class="m-0 mt-3 flex items-start gap-1.5 text-caption/[1.45] text-[var(--text-weak)]"
        data-first-operator-device
      >
        <Icon
          name={props.stage === "device" ? "alert" : "smartphone"}
          size={13}
          class="mt-0.5 shrink-0"
        />
        <span>
          <strong class="font-medium text-[var(--text-base)]">{props.deviceLabel}</strong>
          {" · "}
          {props.deviceDetail}
        </span>
      </p>
      <p class="m-0 mt-2 text-caption/[1.5] text-[var(--text-weak)]">{props.detail}</p>
      <Show when={props.stage !== "complete"}>
        <Button variant="primary" size="lg" class="mt-3 w-full" onClick={props.onAction}>
          <Icon
            name={
              props.stage === "run" ? "play" : props.stage === "bind" ? "sliders" : "smartphone"
            }
            size={14}
          />
          {props.actionLabel}
        </Button>
      </Show>
      <footer class="mt-3 flex justify-end border-t border-[var(--map-divider)] pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onDismiss(props.stage === "complete" ? "completed" : "dismissed")}
        >
          {props.stage === "complete" ? "Hide guide" : "Not now"}
        </Button>
      </footer>
    </section>
  );
}
