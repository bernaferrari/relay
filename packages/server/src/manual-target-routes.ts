import { createReadStream } from "node:fs";
import type http from "node:http";
import {
  captureScrollableSurveyForTarget,
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  describeTargetUi,
  devicePlatformForSerial,
  dismissTowardParent,
  exploreControls,
  getActiveJob,
  interact,
  IosMutationOutcomeUnknownError,
  scrollCollectControls,
  formatSnapshotTree,
  runWithOperationContext,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { assertTargetControl, assertTargetObservation } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import { assertAndroidLiveInputPlatform } from "./live-input-platform.js";
import {
  injectAndroidKey,
  injectAndroidScroll,
  injectAndroidTouch,
  type AndroidKeyboardInput,
  type AndroidTouchAction,
} from "./live-video.js";
import {
  iosVideoUnavailableResponse,
  readIosVideoTake,
  startIosVideoTake,
  stopIosVideoTake,
} from "./ios-video-capture.js";
import { optionalFiniteSearchNumber } from "./search-params.js";
import { recordAudit, type RequestContext } from "./security.js";
import { livePreviewOperationContext } from "./target-stream-context.js";

export type ManualTargetRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  liveVideoStream: (response: http.ServerResponse, serial: string) => Promise<void>;
  captureTargetScreenshot: typeof captureScreenshot;
};

/** A manual navigation stop never retries by itself. Give every caller one
 * explicit, read-only way to inspect the current pixels before deciding what
 * to do next. */
function manualNavigationOutcomeUnknownReview(serial: string) {
  return {
    serial,
    captureCurrent: {
      method: "GET" as const,
      href: `/screenshot?serial=${encodeURIComponent(serial)}&ephemeral=1`,
    },
  };
}

/**
 * Device pixels, manual input, and short-lived iOS video routes. Keeping this
 * separate makes index.ts a policy/order dispatcher while this module owns the
 * concrete device transport boundary.
 */
export async function handleManualTargetRoute(input: ManualTargetRouteInput): Promise<boolean> {
  const {
    method,
    pathname,
    url,
    request: req,
    response: res,
    scope,
    liveVideoStream,
    captureTargetScreenshot,
  } = input;

  if (method === "GET" && pathname === "/snapshot") {
    const serial = url.searchParams.get("serial") ?? undefined;
    const interactiveOnly =
      url.searchParams.get("interactiveOnly") === "1" ||
      url.searchParams.get("interactiveOnly") === "true";
    const includeVisual =
      url.searchParams.get("visual") === "1" || url.searchParams.get("visual") === "true";
    assertTargetObservation(scope, serial);
    const snap = await captureSnapshot({ serial, interactiveOnly, includeVisual });
    const tree = formatSnapshotTree(snap.nodes);
    json(res, 200, { ...snap, tree });
    return true;
  }

  if (method === "GET" && pathname === "/screenshot") {
    const serial = url.searchParams.get("serial") ?? undefined;
    const caption = url.searchParams.get("caption") ?? undefined;
    const jobId = url.searchParams.get("jobId") ?? undefined;
    const ephemeral =
      url.searchParams.get("ephemeral") === "1" || url.searchParams.get("ephemeral") === "true";
    const previewX = optionalFiniteSearchNumber(url.searchParams, "previewX");
    const previewY = optionalFiniteSearchNumber(url.searchParams, "previewY");
    assertTargetObservation(scope, serial);
    const shot = await captureTargetScreenshot({
      serial,
      caption: caption ?? undefined,
      jobId,
      ephemeral,
      // Screenshots must not take an accessibility tree — that wedges XCTest
      // on physical iPads and blocks the next interact/snapshot.
      includeScreenMatch: false,
      ...(previewX !== undefined && previewY !== undefined
        ? { previewTap: { x: previewX, y: previewY } }
        : {}),
    });
    json(res, 200, shot);
    if (ephemeral) await cleanupScreenshot(shot.path);
    return true;
  }

  if (method === "POST" && pathname === "/capture/scroll-survey") {
    const body = (await parseJsonBody(req)) as Partial<
      OperationInput<"target.scroll-survey.capture">
    >;
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (getActiveJob(serial)?.status === "running") {
      throw new HttpError(
        409,
        "A job is running — pause or cancel it before surveying a scrollable page",
      );
    }
    if (
      body.maxScrolls !== undefined &&
      (typeof body.maxScrolls !== "number" ||
        !Number.isInteger(body.maxScrolls) ||
        body.maxScrolls < 1 ||
        body.maxScrolls > 12)
    ) {
      throw new HttpError(400, "maxScrolls must be an integer between 1 and 12");
    }
    await assertTargetControl(scope, serial);
    let survey: Awaited<ReturnType<typeof captureScrollableSurveyForTarget>>;
    try {
      survey = await captureScrollableSurveyForTarget({
        serial,
        ...(body.maxScrolls !== undefined ? { maxScrolls: body.maxScrolls } : {}),
      });
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        throw iosMutationOutcomeUnknownHttpError(error);
      }
      throw error;
    }
    json(res, 200, survey);
    return true;
  }

  if (method === "GET" && pathname === "/device/stream") {
    const serial = url.searchParams.get("serial")?.trim();
    if (!serial) throw new HttpError(400, "serial is required");
    if (url.searchParams.has("lease")) {
      recordAudit(scope, {
        action: "target.preview.open",
        resource: "target",
        target: serial,
        result: "deny",
      });
      throw new HttpError(
        400,
        "lease is not accepted for a read-only live preview; remove it from the URL",
      );
    }
    const streamContext = await livePreviewOperationContext(req, scope, serial);
    await runWithOperationContext(streamContext, async () => {
      assertTargetObservation(scope, serial);
      await liveVideoStream(res, serial);
    });
    return true;
  }

  if (method === "POST" && pathname === "/device/video") {
    const body = (await parseJsonBody(req)) as { serial?: unknown; action?: unknown };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (body.action !== "start" && body.action !== "stop") {
      throw new HttpError(400, "action must be start or stop");
    }
    await assertTargetControl(scope, serial);
    if ((await devicePlatformForSerial(serial)) !== "ios") {
      throw new HttpError(400, "Recorded video capture is available for Apple devices only");
    }
    try {
      const take =
        body.action === "start" ? await startIosVideoTake(serial) : await stopIosVideoTake(serial);
      json(res, 200, {
        take: take && {
          id: take.id,
          serial: take.serial,
          startedAt: take.startedAt,
          ...(take.finishedAt ? { finishedAt: take.finishedAt } : {}),
          state: take.state,
          ...(take.warning ? { warning: take.warning } : {}),
        },
      });
    } catch (error) {
      const unavailable = iosVideoUnavailableResponse(error);
      if (unavailable) {
        throw new HttpError(unavailable.status, unavailable.message, unavailable.body);
      }
      throw new HttpError(502, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const iosVideoMatch = matchPath(pathname, "/device/video/:id");
  if (method === "GET" && iosVideoMatch) {
    // A finished take is workspace evidence, not live device control. Keep
    // it local-only, but let review continue after the iPhone/iPad is
    // unplugged or a different target has been selected.
    if (!scope.localTrusted) {
      throw new HttpError(403, "Recorded Apple video is available only from the local Relay host");
    }
    const take = await readIosVideoTake(iosVideoMatch.id!);
    if (!take || take.state !== "ready") throw new HttpError(404, "Video take is not ready");
    try {
      await new Promise<void>((resolve, reject) => {
        res.writeHead(200, {
          "content-type": "video/mp4",
          "cache-control": "private, max-age=0, no-store",
        });
        const stream = createReadStream(take.path);
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.pipe(res);
      });
    } catch {
      throw new HttpError(404, "Recorded video is unavailable");
    }
    return true;
  }

  if (method === "POST" && pathname === "/device/touch") {
    const body = (await parseJsonBody(req)) as {
      serial?: unknown;
      action?: unknown;
      x?: unknown;
      y?: unknown;
    };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const action = body.action;
    const x = body.x;
    const y = body.y;
    if (!serial) throw new HttpError(400, "serial is required");
    if (!(["down", "move", "up", "cancel"] as unknown[]).includes(action)) {
      throw new HttpError(400, "action must be down|move|up|cancel");
    }
    if (
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      typeof y !== "number" ||
      !Number.isFinite(y)
    ) {
      throw new HttpError(400, "x and y must be finite normalized coordinates");
    }
    if (getActiveJob(serial)?.status === "running") {
      throw new HttpError(409, "A job is running — pause or cancel it before interacting manually");
    }
    await assertTargetControl(scope, serial);
    assertAndroidLiveInputPlatform(await devicePlatformForSerial(serial));
    await injectAndroidTouch(serial, action as AndroidTouchAction, x, y);
    json(res, 200, { ok: true });
    return true;
  }

  if (method === "POST" && pathname === "/device/key") {
    const body = (await parseJsonBody(req)) as Record<string, unknown>;
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    if (getActiveJob(serial)?.status === "running") {
      throw new HttpError(409, "A job is running — pause or cancel it before interacting manually");
    }

    let input: AndroidKeyboardInput;
    if (body.kind === "text" && typeof body.text === "string" && body.text.length > 0) {
      input = { kind: "text", text: body.text };
    } else if (body.kind === "key" && (body.key === "enter" || body.key === "backspace")) {
      input = { kind: "key", key: body.key };
    } else {
      throw new HttpError(400, "kind must be text with text, or key with enter|backspace");
    }

    await assertTargetControl(scope, serial);
    assertAndroidLiveInputPlatform(await devicePlatformForSerial(serial));
    try {
      // The live H.264 stream is the lowest-latency path when the device
      // stage is open. Keep the CLI usable without that optional stream by
      // falling back to the shared semantic device adapter.
      await injectAndroidKey(serial, input);
    } catch (error) {
      if (!(error instanceof HttpError) || !/control is not ready/i.test(error.message)) {
        throw error;
      }
      await interact(
        input.kind === "text"
          ? { kind: "type", text: input.text }
          : { kind: "key", key: input.key },
        { serial },
      );
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (method === "POST" && pathname === "/device/scroll") {
    const body = (await parseJsonBody(req)) as Record<string, unknown>;
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const values = [body.x, body.y, body.scrollX, body.scrollY];
    if (!serial) throw new HttpError(400, "serial is required");
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new HttpError(400, "x, y, scrollX, and scrollY must be finite numbers");
    }
    if (getActiveJob(serial)?.status === "running") {
      throw new HttpError(409, "A job is running — pause or cancel it before interacting manually");
    }
    await assertTargetControl(scope, serial);
    assertAndroidLiveInputPlatform(await devicePlatformForSerial(serial));
    await injectAndroidScroll(
      serial,
      body.x as number,
      body.y as number,
      body.scrollX as number,
      body.scrollY as number,
    );
    json(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/target/ui") {
    const serial = url.searchParams.get("serial") ?? undefined;
    if (!serial) throw new HttpError(400, "serial is required");
    assertTargetObservation(scope, serial);
    const description = await describeTargetUi(serial);
    json(res, 200, description);
    return true;
  }

  if (method === "POST" && pathname === "/target/ui/back") {
    const body = (await parseJsonBody(req)) as { serial?: string; parentTitles?: string[] };
    const serial = body.serial;
    if (!serial) throw new HttpError(400, "serial is required");
    await assertTargetControl(scope, serial);
    let methodUsed: Awaited<ReturnType<typeof dismissTowardParent>>;
    try {
      methodUsed = await dismissTowardParent({
        serial,
        parentTitles: body.parentTitles,
      });
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        throw iosMutationOutcomeUnknownHttpError(error, {
          targetReview: manualNavigationOutcomeUnknownReview(serial),
        });
      }
      throw error;
    }
    json(res, 200, { method: methodUsed });
    return true;
  }

  if (method === "POST" && pathname === "/target/ui/scroll-collect") {
    const body = (await parseJsonBody(req)) as {
      serial?: string;
      maxScrolls?: number;
      allowSensitive?: boolean;
    };
    const serial = body.serial;
    if (!serial) throw new HttpError(400, "serial is required");
    await assertTargetControl(scope, serial);
    let collected: Awaited<ReturnType<typeof scrollCollectControls>>;
    try {
      collected = await scrollCollectControls({
        serial,
        maxScrolls: body.maxScrolls,
        extract: (nodes) =>
          exploreControls(nodes, {
            allowSensitive: body.allowSensitive === true,
          }),
      });
    } catch (error) {
      if (error instanceof IosMutationOutcomeUnknownError) {
        throw iosMutationOutcomeUnknownHttpError(error, {
          targetReview: manualNavigationOutcomeUnknownReview(serial),
        });
      }
      throw error;
    }
    json(res, 200, { controls: collected.controls, count: collected.controls.length });
    return true;
  }

  return false;
}
