import { createSignal, type Accessor, type Setter } from "solid-js";
import {
  loadAndroidDeviceSetup,
  loadAndroidAppLocales,
  loadAppleDeviceSetup,
  loadAppleSetupPreflight,
  saveAppleDeviceSetup,
  saveIosLivePreview,
  type AndroidSetupStatus,
  type AppleDeviceSetup,
  type AppleSetupStatus,
} from "./server-device-setup-remote";

type Request = <T = unknown>(path: string, init?: RequestInit, timeoutMs?: number) => Promise<T>;

export function createServerDeviceSetupController(input: {
  request: Request;
  selectedDevice: Accessor<string | null>;
  setLiveCaptureIssue: Setter<string | null>;
}) {
  const [appleDeviceSetup, setAppleDeviceSetup] = createSignal<AppleSetupStatus | null>(null);
  const [androidDeviceSetup, setAndroidDeviceSetup] = createSignal<AndroidSetupStatus | null>(null);
  let appleRefreshSequence = 0;

  async function refreshAppleDeviceSetup(): Promise<AppleSetupStatus> {
    const sequence = ++appleRefreshSequence;
    const status = await loadAppleDeviceSetup(input.request);
    // Settings can refresh while a save is in flight. Only the newest reply
    // may change shared setup state.
    if (sequence === appleRefreshSequence) setAppleDeviceSetup(status);
    return status;
  }

  async function preflightAppleDeviceSetup(): Promise<boolean> {
    return (await loadAppleSetupPreflight(input.request)).configured;
  }

  async function refreshAndroidDeviceSetup(): Promise<AndroidSetupStatus> {
    const status = await loadAndroidDeviceSetup(input.request);
    setAndroidDeviceSetup(status);
    return status;
  }

  async function loadAndroidAppLocalesForSelectedDevice(packageName: string): Promise<string[]> {
    const serial = input.selectedDevice();
    if (!serial) throw new Error("Choose a connected Android device first");
    return loadAndroidAppLocales(input.request, serial, packageName);
  }

  async function saveAppleSetup(inputValue: AppleDeviceSetup): Promise<void> {
    await saveAppleDeviceSetup(input.request, inputValue);
    await refreshAppleDeviceSetup();
    // A runner setup failure belongs to the previous configuration.
    input.setLiveCaptureIssue(null);
  }

  async function saveIosPreview(
    backend: "agent-device-png" | "go-ios-auto" | "go-ios-mjpeg",
  ): Promise<void> {
    await saveIosLivePreview(input.request, backend);
    await refreshAppleDeviceSetup();
  }

  return {
    appleDeviceSetup,
    androidDeviceSetup,
    refreshAppleDeviceSetup,
    preflightAppleDeviceSetup,
    refreshAndroidDeviceSetup,
    loadAndroidAppLocales: loadAndroidAppLocalesForSelectedDevice,
    saveAppleDeviceSetup: saveAppleSetup,
    saveIosLivePreview: saveIosPreview,
  };
}
