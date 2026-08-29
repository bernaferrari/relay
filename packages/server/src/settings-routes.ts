import type http from "node:http";
import {
  getEvidenceCollectionPolicy,
  getRedactionPolicy,
  inspectAndroidDeviceSetup,
  inspectAppleDeviceSetup,
  inspectWorkspaceChange,
  readDeviceSetup,
  RedactionPolicyLockedError,
  resetDeviceClients,
  resetIosRunnerState,
  restartAgentDeviceDaemonForSetup,
  saveAppleDeviceSetup,
  saveIosLivePreviewSettings,
  isIosLivePreviewBackend,
  setRedactionEnabled,
  setSensitiveEvidenceConsent,
} from "@relay/core";
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import { HttpError, json, parseJsonBody } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

export type SettingsRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleSettingsRoute(context: SettingsRouteContext): Promise<boolean> {
  const { method, pathname, request: req, response: res, scope } = context;

  if (method === "GET" && pathname === "/workspace/change") {
    const search = new URL(req.url ?? pathname, "http://relay.local").searchParams;
    const baseRef = search.get("baseRef")?.trim();
    json(res, 200, {
      change: await inspectWorkspaceChange({
        ...(baseRef ? { baseRef } : {}),
        ...(process.env.RELAY_PROOF_BASE_REF?.trim()
          ? { preferredBaseRef: process.env.RELAY_PROOF_BASE_REF.trim() }
          : process.env.GITHUB_BASE_REF?.trim()
            ? { preferredBaseRef: process.env.GITHUB_BASE_REF.trim() }
            : {}),
      }),
    });
    return true;
  }

  if (method === "GET" && pathname === "/settings/privacy") {
    json(res, 200, { policy: getRedactionPolicy() });
    return true;
  }
  if (method === "PUT" && pathname === "/settings/privacy") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Privacy settings can only be changed from a local Relay host");
    }
    const body = (await parseJsonBody(req)) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      throw new HttpError(400, "enabled must be a boolean");
    }
    try {
      json(res, 200, { policy: await setRedactionEnabled(body.enabled) });
    } catch (error) {
      if (error instanceof RedactionPolicyLockedError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
    return true;
  }
  if (method === "GET" && pathname === "/settings/evidence") {
    json(res, 200, { policy: getEvidenceCollectionPolicy() });
    return true;
  }
  if (method === "GET" && pathname === "/settings/devices/apple") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Device setup can only be read from a local Relay host");
    }
    json(res, 200, await inspectAppleDeviceSetup());
    return true;
  }
  if (method === "GET" && pathname === "/settings/devices/apple/preflight") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Device setup can only be read from a local Relay host");
    }
    // Stage startup only needs to know whether the runner has been configured.
    // Keep it filesystem-only: the fuller Settings check runs Xcode commands and
    // can take seconds on first use.
    const setup = await readDeviceSetup();
    json(res, 200, { configured: Boolean(setup.ios) });
    return true;
  }
  if (method === "GET" && pathname === "/settings/devices/android") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Device setup can only be read from a local Relay host");
    }
    json(res, 200, await inspectAndroidDeviceSetup());
    return true;
  }
  if (method === "PUT" && pathname === "/settings/devices/apple") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Device setup can only be changed from a local Relay host");
    }
    const body = (await parseJsonBody(req)) as {
      teamId?: unknown;
      bundleId?: unknown;
      signingIdentity?: unknown;
      provisioningProfile?: unknown;
    };
    if (typeof body.teamId !== "string" || typeof body.bundleId !== "string") {
      throw new HttpError(400, "teamId and bundleId are required");
    }
    const setup = await saveAppleDeviceSetup({
      teamId: body.teamId,
      bundleId: body.bundleId,
      ...(typeof body.signingIdentity === "string"
        ? { signingIdentity: body.signingIdentity }
        : {}),
      ...(typeof body.provisioningProfile === "string"
        ? { provisioningProfile: body.provisioningProfile }
        : {}),
    });
    resetDeviceClients();
    resetIosRunnerState();
    await restartAgentDeviceDaemonForSetup();
    json(res, 200, { setup });
    return true;
  }

  if (method === "PUT" && pathname === "/settings/devices/apple/live-preview") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Device setup can only be changed from a local Relay host");
    }
    const body = (await parseJsonBody(req)) as { backend?: unknown };
    if (!isIosLivePreviewBackend(body.backend)) {
      throw new HttpError(400, "backend must be agent-device-png, go-ios-auto, or go-ios-mjpeg");
    }
    const setup = await saveIosLivePreviewSettings({ backend: body.backend });
    json(res, 200, { setup });
    return true;
  }
  if (method === "PUT" && pathname === "/settings/evidence") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Evidence consent can only be changed from a local Relay host");
    }
    const body = (await parseJsonBody(req)) as {
      channel?: unknown;
      enabled?: unknown;
      reason?: unknown;
    };
    if (body.channel !== "audio" && body.channel !== "crash" && body.channel !== "network-body") {
      throw new HttpError(400, "channel must be audio, crash, or network-body");
    }
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
    if (body.reason !== undefined && typeof body.reason !== "string") {
      throw new HttpError(400, "reason must be a string");
    }
    const policy = await setSensitiveEvidenceConsent({
      channel: body.channel as SensitiveEvidenceChannel,
      enabled: body.enabled,
      grantedBy: scope.subject,
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
    });
    recordAudit(scope, {
      action: body.enabled ? "evidence.consent.grant" : "evidence.consent.revoke",
      resource: body.channel,
      result: "allow",
    });
    json(res, 200, { policy });
    return true;
  }

  return false;
}
