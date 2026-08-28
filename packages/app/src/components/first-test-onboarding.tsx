import { createEffect, createMemo, createSignal, onMount } from "solid-js";
import type { AppMapScenarioTest, Screen } from "@relay/protocol";
import { usePlatform } from "../context/platform";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { scenarioDiagnostics } from "../lib/app-map-test-editor-model";
import { deviceReadiness } from "../lib/device-readiness";
import { humanError } from "../lib/human-error";
import {
  EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE,
  FIRST_TEST_ONBOARDING_STORAGE_KEY,
  createFirstTestStarter,
  deriveFirstTestState,
  firstTestTargetStatus,
  parseFirstTestOnboardingPreference,
  persistedRunsForFirstTest,
  serializeFirstTestOnboardingPreference,
  shouldShowFirstTestChecklist,
  type FirstTestAuthoringPreference,
  type FirstTestOnboardingPreference,
} from "../lib/onboarding";
import type { DeviceInfo } from "../lib/api-types";
import { FirstTestChecklist, type FirstTestChecklistProps } from "./first-test-checklist";

export type FirstTestOnboardingActions = {
  onOpenTargets: () => void;
  onShowLiveDevice: () => void;
  onSaveStartScreen: () => void;
  onRecord: () => void;
  onImportYaml: (yaml: string) => Promise<void> | void;
  onOpenTest: () => void;
  onOpenRun: (id: string) => void;
  onExportYaml: () => void;
};

function currentTarget(devices: readonly DeviceInfo[], serial: string | null | undefined) {
  return devices.find((candidate) => candidate.serial === serial);
}

function runSucceeded(status: string): boolean {
  return status === "ok" || status === "healed";
}

/**
 * This is deliberately a view model rather than a new authoring workflow. It
 * converts live Relay state into guide props and forwards every mutation to
 * the existing map/Test actions. The only locally persisted values are the
 * presentation preference permitted by plan 018.
 */
export function useFirstTestOnboarding(actions: FirstTestOnboardingActions) {
  const server = useServer();
  const recorder = useRecorder();
  const platform = usePlatform();
  const [preference, setPreference] = createSignal<FirstTestOnboardingPreference>(
    EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE,
  );
  const [preferenceReady, setPreferenceReady] = createSignal(false);
  const [forceOpen, setForceOpen] = createSignal(false);
  const [targetCheck, setTargetCheck] = createSignal<FirstTestChecklistProps["targetCheck"]>({
    state: "idle",
  });
  const [creatingStarter, setCreatingStarter] = createSignal<"screen-check" | "blank" | null>(null);

  onMount(() => {
    void Promise.resolve(platform.storage.get(FIRST_TEST_ONBOARDING_STORAGE_KEY))
      .then((stored) => setPreference(parseFirstTestOnboardingPreference(stored)))
      .catch(() => setPreference(EMPTY_FIRST_TEST_ONBOARDING_PREFERENCE))
      .finally(() => setPreferenceReady(true));
  });

  function persist(next: FirstTestOnboardingPreference): void {
    setPreference(next);
    void Promise.resolve(
      platform.storage.set(
        FIRST_TEST_ONBOARDING_STORAGE_KEY,
        serializeFirstTestOnboardingPreference(next),
      ),
    ).catch(() => undefined);
  }

  function rememberAuthoringPreference(authoringPreference: FirstTestAuthoringPreference): void {
    persist({ ...preference(), authoringPreference, dismissedAt: undefined });
  }

  const target = createMemo(() => currentTarget(server.devices(), server.selectedDevice()));
  const targetReadiness = createMemo(() => {
    const selected = target();
    const liveFrame = server.liveFrame();
    return deviceReadiness(selected, server.health() === "online", {
      ...(selected?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      recordingIssue: recorder.recordingIssue(),
      // The first saved screen uses the same capture path as EmptyAppMap. A
      // connected lease without pixels is not sufficient evidence that this
      // action can succeed, including for browser targets.
      requireLiveScreen: true,
      liveScreenAvailable:
        Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === selected?.serial),
    });
  });
  const targetStatus = createMemo(() =>
    firstTestTargetStatus({
      online: server.health() === "online",
      target: target(),
      readiness: targetReadiness(),
      hasControl: Boolean(server.selectedLeaseId()),
      controlIssue: server.controlIssue(),
    }),
  );
  const map = createMemo(() => server.selectedAppMap());
  const tests = createMemo(() =>
    Object.values(map()?.tests ?? {}).toSorted(
      (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    ),
  );
  const guideTest = createMemo(() => {
    const appMap = map();
    if (!appMap) return undefined;
    const savedRuns = server.persistedRuns();
    return (
      tests().find((test) =>
        persistedRunsForFirstTest(savedRuns, appMap.id, test.id).some((run) =>
          runSucceeded(run.status),
        ),
      ) ?? tests()[0]
    );
  });
  const matchedRuns = createMemo(() =>
    persistedRunsForFirstTest(server.persistedRuns(), map()?.id, guideTest()?.id),
  );
  const safeStarterScreen = createMemo<Screen | undefined>(() => {
    const screens = Object.values(map()?.screens ?? {});
    return screens
      .toSorted(
        (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      )
      .find((screen) => Boolean(screen.identity));
  });
  const state = createMemo(() => {
    const appMap = map();
    const test = guideTest();
    return deriveFirstTestState({
      target: targetStatus(),
      screenSaved: Boolean(appMap && Object.keys(appMap.screens).length > 0),
      testCreated: Boolean(test),
      testReady: Boolean(
        appMap &&
        test &&
        scenarioDiagnostics(appMap, test).every((diagnostic) => diagnostic.tone !== "blocker"),
      ),
      runs: matchedRuns(),
    });
  });
  const visible = createMemo(
    () => preferenceReady() && (forceOpen() || shouldShowFirstTestChecklist(preference(), state())),
  );
  const canReopen = createMemo(
    () => preferenceReady() && !visible() && state().stage !== "complete",
  );

  createEffect(() => {
    target();
    server.health();
    setTargetCheck({ state: "idle" });
  });

  async function checkTarget(): Promise<void> {
    const status = targetStatus();
    if (status.kind === "choose-target") {
      actions.onOpenTargets();
      return;
    }
    if (status.kind === "needs-control") {
      actions.onShowLiveDevice();
      requestAnimationFrame(actions.onOpenTargets);
      return;
    }
    if (targetReadiness().kind === "screen-preparing") {
      // Opening the existing companion is an explicit, non-destructive way to
      // obtain the exact live frame the first capture requires. It does not
      // reserve the device, grant a permission, or begin a run.
      actions.onShowLiveDevice();
      return;
    }

    setTargetCheck({ state: "checking", detail: "Checking this Device…" });
    try {
      if (status.kind === "offline") {
        await server.retryConnection();
      } else {
        await server.refreshDevices();
        const selected = target();
        if (selected?.platform === "browser") {
          const preflight = await server.preflightTarget(selected.id ?? selected.serial);
          if (!preflight.ok) {
            setTargetCheck({
              state: "failed",
              detail: preflight.checks.map((check) => check.message).join(" · "),
            });
            return;
          }
        } else if (selected?.platform === "ios") {
          await server.preflightAppleDeviceSetup();
        }
      }
      const next = targetStatus();
      setTargetCheck({
        state: next.kind === "ready" ? "passed" : "failed",
        detail: next.detail,
      });
    } catch (error) {
      setTargetCheck({
        state: "failed",
        detail: humanError(error, "Relay could not check this Device."),
      });
    }
  }

  async function createStarter(kind: "screen-check" | "blank"): Promise<void> {
    const appMap = map();
    if (!appMap || creatingStarter()) return;
    const screen = safeStarterScreen();
    if (kind === "screen-check" && !screen) {
      toast("Capture the starting state before creating this check.", "warning");
      return;
    }
    setCreatingStarter(kind);
    try {
      const test: AppMapScenarioTest = createFirstTestStarter({
        map: appMap,
        kind,
        screen,
      });
      await server.saveTest({
        appMapId: appMap.id,
        expectedRevision: appMap.revision,
        test,
      });
      await server.refreshAppMaps();
      rememberAuthoringPreference(kind);
      actions.onOpenTest();
      toast(
        kind === "screen-check"
          ? "Starting-state check created · review it, then choose Run"
          : "Blank Test created · add a step, then choose Run",
        "success",
      );
    } catch (error) {
      toast(humanError(error, "Could not create this Test"), "error");
    } finally {
      setCreatingStarter(null);
    }
  }

  function dismiss(reason: "dismissed" | "completed"): void {
    const now = Date.now();
    persist({
      ...preference(),
      ...(reason === "completed" ? { completedAt: now } : { dismissedAt: now }),
    });
    setForceOpen(false);
  }

  const checklistProps = createMemo<FirstTestChecklistProps>(() => ({
    state: state(),
    targetCheck: targetCheck(),
    starterAvailable: Boolean(safeStarterScreen()),
    creatingStarter: creatingStarter(),
    canSaveStartScreen:
      targetStatus().kind === "ready" &&
      Boolean(server.selectedLeaseId()) &&
      !server.controlIssue(),
    onTargetAction: () => void checkTarget(),
    onShowLiveDevice: actions.onShowLiveDevice,
    onSaveStartScreen: actions.onSaveStartScreen,
    onCreateStarter: (kind) => void createStarter(kind),
    onRecord: () => {
      rememberAuthoringPreference("record");
      actions.onRecord();
    },
    onImportYaml: async (yaml) => {
      rememberAuthoringPreference("yaml");
      await actions.onImportYaml(yaml);
    },
    onOpenTest: actions.onOpenTest,
    onOpenReport: actions.onOpenRun,
    onExportYaml: actions.onExportYaml,
    onDismiss: dismiss,
  }));

  return {
    visible,
    canReopen,
    checklistProps,
    reopen: () => {
      persist({ ...preference(), dismissedAt: undefined });
      setForceOpen(true);
    },
  };
}

export { FirstTestChecklist };
