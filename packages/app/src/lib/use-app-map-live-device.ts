import type { AppMap } from "@relay/protocol";
import { createEffect, createMemo, type Accessor } from "solid-js";
import { useRecorder } from "../context/recorder";
import { useServer } from "../context/server";
import { appMapDeviceStatus } from "../components/device-status-label";
import {
  applicationIdsMatch,
  expectedAndroidApplicationId,
  matchLiveScreen,
} from "./app-map-live-location";
import { deviceReadiness } from "./device-readiness";
import { recordStateFromReadiness } from "./app-map-workspace-helpers";

/** Live-device presentation shared by the canvas, empty state, and companion. */
export function useAppMapLiveDevice(activeAppMap: Accessor<AppMap | undefined>) {
  const server = useServer();
  const recorder = useRecorder();
  const selectedDevice = createMemo(
    () => server.devices().find((device) => device.serial === server.selectedDevice()) ?? null,
  );
  let requestedAppleSetupFor = "";

  createEffect(() => {
    const device = selectedDevice();
    const setup = server.appleDeviceSetup();
    if (device?.platform !== "ios" || setup) {
      requestedAppleSetupFor = "";
      return;
    }
    const requestKey = device.serial;
    if (requestedAppleSetupFor === requestKey) return;
    requestedAppleSetupFor = requestKey;
    void server.refreshAppleDeviceSetup().catch(() => {
      // A cold detailed Xcode inspection can exceed the short UI request
      // budget. Live readiness remains authoritative while preparation runs.
    });
  });

  const readiness = createMemo(() => {
    const device = selectedDevice();
    const liveFrame = server.liveFrame();
    return deviceReadiness(device, server.health() === "online", {
      ...(device?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      recordingIssue: recorder.recordingIssue(),
      requireLiveScreen: true,
      liveScreenAvailable:
        Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === device?.serial),
    });
  });
  const recordState = () => recordStateFromReadiness(readiness());
  const canRecord = () =>
    recordState() === "ready" &&
    Boolean(server.selectedLeaseId()) &&
    !server.controlIssue() &&
    !outsideMapApp();
  const panelStatus = () => {
    const device = selectedDevice();
    return appMapDeviceStatus({
      readiness: readiness(),
      deviceSelected: Boolean(device),
      serverOnline: server.health() === "online",
      discovering: server.deviceDiscoveryStatus() === "scanning",
      recording: recorder.recording(),
      controlReady: Boolean(server.selectedLeaseId()),
      controlIssue: server.controlIssue(),
      controlTakeoverAvailable: server.canTakeControlOfSelectedDevice(),
    });
  };
  const screenSrc = createMemo(() => {
    const device = selectedDevice();
    const liveFrame = server.liveFrame();
    const belongsToSelectedDevice =
      Boolean(device) && (!liveFrame?.serial || liveFrame.serial === device?.serial);
    return liveFrame?.base64 && belongsToSelectedDevice
      ? `data:${liveFrame.mime || "image/png"};base64,${liveFrame.base64}`
      : undefined;
  });
  const liveRunJob = createMemo(() => {
    const jobId = server.selectedJobId();
    if (!jobId) return null;
    const job = server.jobs().find((candidate) => candidate.id === jobId);
    if (!job || !["queued", "running", "paused"].includes(job.status)) return null;
    const serial = server.selectedDevice();
    return !job.serial || !serial || job.serial === serial ? job : null;
  });
  const liveRunPresentation = createMemo(() => {
    const job = liveRunJob();
    if (!job) return undefined;
    return {
      title: job.title?.trim() || "App map",
      state: job.status as "queued" | "running" | "paused",
      completedSteps: job.steps?.length ?? 0,
      ...(job.recipeSnapshot?.steps.length ? { totalSteps: job.recipeSnapshot.steps.length } : {}),
      ...(job.matrixCase?.world ? { caseLabel: job.matrixCase.world } : {}),
    };
  });
  const liveLocation = createMemo(() =>
    matchLiveScreen(Object.values(activeAppMap()?.screens ?? {}), [
      server.snapshot()?.screenIdentity?.fingerprint,
      server.liveFrame()?.visualFingerprint,
      server.liveFrame()?.fingerprint,
    ]),
  );
  const expectedApplicationId = createMemo(() =>
    expectedAndroidApplicationId(Object.values(activeAppMap()?.screenVariants ?? {})),
  );
  const liveApplicationId = createMemo(
    () => server.snapshot()?.foregroundApp ?? server.snapshot()?.treeApp,
  );
  const outsideMapApp = createMemo(() => {
    const expected = expectedApplicationId();
    const actual = liveApplicationId();
    return Boolean(expected && actual && !applicationIdsMatch(expected, actual));
  });
  const unmapped = createMemo(
    () =>
      !outsideMapApp() &&
      liveLocation().kind === "unknown" &&
      Boolean(selectedDevice()) &&
      Boolean(server.liveFrame()?.base64) &&
      !server.controlIssue(),
  );
  const hereScreenId = createMemo(() => {
    const location = liveLocation();
    return location.kind === "here" ? location.screenId : null;
  });

  return {
    selectedDevice,
    readiness,
    recordState,
    canRecord,
    panelStatus,
    screenSrc,
    liveRunJob,
    liveRunPresentation,
    outsideMapApp,
    unmapped,
    hereScreenId,
  };
}
