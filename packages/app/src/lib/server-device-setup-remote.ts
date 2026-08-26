import type { RelayClient } from "@relay/client";

export type AppleDeviceSetup = {
  teamId: string;
  bundleId: string;
  signingIdentity?: string;
  provisioningProfile?: string;
};

export type IosLivePreviewBackend = "agent-device-png" | "go-ios-auto" | "go-ios-mjpeg";

export type AppleSetupStatus = {
  setup: {
    version: number;
    ios?: AppleDeviceSetup;
    iosLivePreview?: { backend: IosLivePreviewBackend };
  };
  suggestion?: AppleDeviceSetup & {
    label: string;
  };
  checks: Array<{
    id: "xcode" | "devicectl" | "account" | "signing" | "relay";
    label: string;
    status: "ready" | "needs-attention";
    detail: string;
  }>;
};

export type AndroidSetupStatus = {
  checks: Array<{
    id: "adb";
    label: string;
    status: "ready" | "needs-attention";
    detail: string;
  }>;
};

export type AppleSetupPreflight = {
  configured: boolean;
};

export async function loadAppleDeviceSetup(client: RelayClient): Promise<AppleSetupStatus> {
  // This only determines whether the local runner is configured. Keep the
  // first-device path responsive; the detailed Settings view can be retried
  // instead of leaving the canvas in an indefinite checking state.
  return client.resource<AppleSetupStatus>("/settings/devices/apple", {
    signal: AbortSignal.timeout(5_000),
  });
}

export async function loadAppleSetupPreflight(
  client: RelayClient,
): Promise<AppleSetupPreflight> {
  return client.resource<AppleSetupPreflight>("/settings/devices/apple/preflight", {
    signal: AbortSignal.timeout(4_000),
  });
}

export async function loadAndroidDeviceSetup(client: RelayClient): Promise<AndroidSetupStatus> {
  return client.resource<AndroidSetupStatus>("/settings/devices/android");
}

export async function loadAndroidAppLocales(
  client: RelayClient,
  serial: string,
  packageName: string,
): Promise<string[]> {
  const result = await client.invoke("target.app.locales", { serial, package: packageName });
  return result.locales;
}

export async function saveAppleDeviceSetup(
  client: RelayClient,
  input: AppleDeviceSetup,
): Promise<AppleSetupStatus["setup"]> {
  const result = await client.invoke("workspace.apple-device.update", input);
  return result.setup;
}

export async function saveIosLivePreview(
  client: RelayClient,
  backend: IosLivePreviewBackend,
): Promise<AppleSetupStatus["setup"]> {
  const result = await client.invoke("workspace.apple-live-preview.update", { backend });
  return result.setup;
}
