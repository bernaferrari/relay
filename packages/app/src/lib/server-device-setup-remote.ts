import type { ServerRequest } from "./server-matrix-remote";

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

export async function loadAppleDeviceSetup(request: ServerRequest): Promise<AppleSetupStatus> {
  // This only determines whether the local runner is configured. Keep the
  // first-device path responsive; the detailed Settings view can be retried
  // instead of leaving the canvas in an indefinite checking state.
  return request<AppleSetupStatus>("/settings/devices/apple", undefined, 5_000);
}

export async function loadAppleSetupPreflight(
  request: ServerRequest,
): Promise<AppleSetupPreflight> {
  return request<AppleSetupPreflight>("/settings/devices/apple/preflight", undefined, 4_000);
}

export async function loadAndroidDeviceSetup(request: ServerRequest): Promise<AndroidSetupStatus> {
  return request<AndroidSetupStatus>("/settings/devices/android");
}

export async function loadAndroidAppLocales(
  request: ServerRequest,
  serial: string,
  packageName: string,
): Promise<string[]> {
  const query = new URLSearchParams({ serial, package: packageName });
  const result = await request<{ locales: string[] }>(`/device/app/locales?${query}`);
  return result.locales;
}

export async function saveAppleDeviceSetup(
  request: ServerRequest,
  input: AppleDeviceSetup,
): Promise<AppleSetupStatus["setup"]> {
  const result = await request<{ setup: AppleSetupStatus["setup"] }>("/settings/devices/apple", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return result.setup;
}

export async function saveIosLivePreview(
  request: ServerRequest,
  backend: IosLivePreviewBackend,
): Promise<AppleSetupStatus["setup"]> {
  const result = await request<{ setup: AppleSetupStatus["setup"] }>(
    "/settings/devices/apple/live-preview",
    {
      method: "PUT",
      body: JSON.stringify({ backend }),
    },
  );
  return result.setup;
}
