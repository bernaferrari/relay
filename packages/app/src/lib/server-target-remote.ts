import type { TargetDefinition, TargetPreflight, TargetProfile } from "@relay/protocol";
import type { ActionInfo, DeviceInfo } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

export async function listDevices(request: ServerRequest): Promise<DeviceInfo[]> {
  const data = await request<{ devices: DeviceInfo[] }>("/devices");
  return data.devices ?? [];
}

export async function listActions(request: ServerRequest): Promise<ActionInfo[]> {
  const data = await request<{ actions: ActionInfo[] }>("/actions");
  return data.actions ?? [];
}

export async function listTargets(request: ServerRequest): Promise<TargetDefinition[]> {
  const data = await request<{ targets: TargetDefinition[] }>("/targets");
  return data.targets ?? [];
}

export async function listTargetProfiles(request: ServerRequest): Promise<TargetProfile[]> {
  const data = await request<{ profiles: TargetProfile[] }>("/target-profiles");
  return data.profiles ?? [];
}

export async function selectDevice(
  request: ServerRequest,
  serial: string | null,
  platform: string = "android",
): Promise<void> {
  await request("/device/select", {
    method: "POST",
    body: JSON.stringify({ serial, platform }),
  });
}

export async function saveBrowserTarget(
  request: ServerRequest,
  input: {
    id?: string;
    name: string;
    startUrl: string;
    executablePath?: string;
    headless?: boolean;
  },
): Promise<TargetDefinition> {
  const data = await request<{ target: TargetDefinition }>("/targets", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.target;
}

export async function deleteTarget(request: ServerRequest, id: string): Promise<void> {
  await request(`/targets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function preflightTarget(
  request: ServerRequest,
  id: string,
): Promise<TargetPreflight> {
  const data = await request<{ preflight: TargetPreflight }>(
    `/targets/${encodeURIComponent(id)}/preflight`,
    { method: "POST", body: "{}" },
    30_000,
  );
  return data.preflight;
}
