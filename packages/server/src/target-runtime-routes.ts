import type http from "node:http";
import {
  installRegisteredBuild,
  launchRegisteredBuild,
  listDeviceLeases,
  listDevices,
  listTargetWorkers,
  preflightDevicePool,
  preflightRegisteredBuild,
  readBuild,
  readDevicePool,
  runWithTargetContext,
  type BuildCommandRunner,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export type TargetRuntimeRouteRuntime = {
  listDevices: typeof listDevices;
  listDeviceLeases: typeof listDeviceLeases;
  assertTargetControl: typeof assertTargetControl;
  runBuildCommand?: BuildCommandRunner;
};

const defaultRuntime: TargetRuntimeRouteRuntime = {
  listDevices,
  listDeviceLeases,
  assertTargetControl,
};

export async function handleTargetRuntimeRoute(context: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<TargetRuntimeRouteRuntime>;
}): Promise<boolean> {
  const { method, pathname, request, response, scope } = context;
  const runtime = { ...defaultRuntime, ...context.runtime };

  if (method === "GET" && pathname === "/target-workers") {
    json(response, 200, { workers: listTargetWorkers() });
    return true;
  }

  const poolPreflight = matchPath(pathname, "/device-pools/:id/preflight");
  if (method === "POST" && poolPreflight) {
    const pool = await readDevicePool(scope.projectId, poolPreflight.id!);
    if (!pool) throw new HttpError(404, "Device pool not found");
    json(response, 200, {
      preflight: preflightDevicePool({
        pool,
        devices: await runtime.listDevices().catch(() => []),
        leases: await runtime.listDeviceLeases(scope.projectId),
      }),
    });
    return true;
  }

  const buildPreflight = matchPath(pathname, "/builds/:id/preflight");
  if (method === "POST" && buildPreflight) {
    const build = await readBuild(scope.projectId, buildPreflight.id!);
    if (!build) throw new HttpError(404, "Build not found");
    const body = (await parseJsonBody(request)) as { serial?: unknown };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const target = serial
      ? { kind: "device" as const, platform: build.platform, serial }
      : undefined;
    json(response, 200, {
      preflight: await preflightRegisteredBuild(build, {
        ...(target ? { target } : {}),
        ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
      }),
    });
    return true;
  }

  const installMatch = matchPath(pathname, "/builds/:id/install");
  if (method === "POST" && installMatch) {
    const build = await readBuild(scope.projectId, installMatch.id!);
    if (!build) throw new HttpError(404, "Build not found");
    const body = (await parseJsonBody(request)) as {
      serial?: unknown;
      launch?: unknown;
      applicationId?: unknown;
    };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    await runtime.assertTargetControl(scope, serial);
    const device = (await runtime.listDevices().catch(() => [])).find(
      (candidate) => candidate.serial === serial,
    );
    if (!device) throw new HttpError(409, `Target ${serial} is not connected`);
    if (device.platform !== build.platform) {
      throw new HttpError(
        409,
        `Build targets ${build.platform}, but ${serial} is ${device.platform}`,
      );
    }
    const target = { kind: "device" as const, platform: build.platform, serial };
    const installed = await runWithTargetContext(target, () =>
      installRegisteredBuild({
        build,
        target,
        targetKind: device.kind,
        ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
      }),
    );
    const shouldLaunch = body.launch === true;
    const launched = shouldLaunch
      ? await runWithTargetContext(target, () =>
          launchRegisteredBuild({
            build,
            target,
            applicationId:
              typeof body.applicationId === "string" ? body.applicationId : installed.applicationId,
            ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
          }),
        )
      : undefined;
    json(response, 200, { installed, ...(launched ? { launched } : {}) });
    return true;
  }

  const launchMatch = matchPath(pathname, "/builds/:id/launch");
  if (method === "POST" && launchMatch) {
    const build = await readBuild(scope.projectId, launchMatch.id!);
    if (!build) throw new HttpError(404, "Build not found");
    const body = (await parseJsonBody(request)) as { serial?: unknown; applicationId?: unknown };
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    if (!serial) throw new HttpError(400, "serial is required");
    await runtime.assertTargetControl(scope, serial);
    const target = { kind: "device" as const, platform: build.platform, serial };
    const launched = await runWithTargetContext(target, () =>
      launchRegisteredBuild({
        build,
        target,
        ...(typeof body.applicationId === "string" ? { applicationId: body.applicationId } : {}),
        ...(runtime.runBuildCommand ? { run: runtime.runBuildCommand } : {}),
      }),
    );
    json(response, 200, { launched });
    return true;
  }

  return false;
}
