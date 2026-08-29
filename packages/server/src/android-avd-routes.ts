import type http from "node:http";
import { AndroidAvdError, bootAndroidAvd, listAndroidAvds } from "@relay/core";
import { HttpError, json, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export type AndroidAvdRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

/** Host-local AVD inventory and boot controls, kept outside the main router. */
export async function handleAndroidAvdRoute(context: AndroidAvdRouteContext): Promise<boolean> {
  const { method, pathname, request, response, scope } = context;

  // A configured AVD is not a connected device. Keep this inventory separate
  // so a stopped emulator is selectable by its stable name without pretending
  // it already has an ADB serial or a live session.
  if (method === "GET" && pathname === "/devices/avds") {
    json(response, 200, { inventory: await listAndroidAvds() });
    return true;
  }

  if (method !== "POST" || pathname !== "/device/avd/boot") return false;
  if (!scope.localTrusted) {
    throw new HttpError(403, "Android AVD boot is available only on the local Relay host");
  }
  const body = (await parseJsonBody(request)) as {
    avdName?: string;
    timeoutMs?: number;
    headless?: boolean;
  };
  if (!body.avdName?.trim()) throw new HttpError(400, "avdName is required");
  try {
    const boot = await bootAndroidAvd(body.avdName, {
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
      ...(body.headless !== undefined ? { headless: body.headless } : {}),
    });
    json(response, 200, { boot });
  } catch (error) {
    if (error instanceof AndroidAvdError) {
      const status =
        error.code === "avd-boot-in-progress" ? 409 : error.code === "avd-not-found" ? 404 : 502;
      throw new HttpError(status, error.message, {
        code: `ANDROID_AVD_${error.code.replaceAll("-", "_").toUpperCase()}`,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    throw new HttpError(502, error instanceof Error ? error.message : String(error));
  }
  return true;
}
