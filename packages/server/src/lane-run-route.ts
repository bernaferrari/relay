import type http from "node:http";
import {
  applyLaneToCombineStart,
  applyLaneToInteract,
  applyLaneToTestRun,
  type LaneAwareCombineStartInput,
  type LaneInteractResolution,
} from "@relay/core";
import type { AuthoringTarget, OperationInput } from "@relay/protocol";
import { HttpError, parseJsonBody } from "./http.js";

export function laneRunHttpError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/was not found/u.test(message)) throw new HttpError(404, message);
  if (/must not persist|unique runtime profile|is bound to/u.test(message)) {
    throw new HttpError(409, message);
  }
  throw new HttpError(400, message);
}

export async function parseLaneAwareTestRunBody(
  request: http.IncomingMessage,
  projectId: string,
  appMapId: string,
): Promise<
  Omit<OperationInput<"app-map.test.run">, "appMapId" | "testId"> & {
    expectedRevision: number;
    target: AuthoringTarget;
  }
> {
  const body = (await parseJsonBody(request)) as Omit<
    OperationInput<"app-map.test.run">,
    "appMapId" | "testId"
  >;
  try {
    return await applyLaneToTestRun(projectId, appMapId, body);
  } catch (error) {
    laneRunHttpError(error);
  }
}

export async function applyLaneToCombineStartOrThrow<T extends LaneAwareCombineStartInput>(
  projectId: string,
  input: T,
): Promise<T> {
  try {
    return await applyLaneToCombineStart(projectId, input);
  } catch (error) {
    laneRunHttpError(error);
  }
}

export async function applyLaneToInteractOrThrow(input: {
  projectId: string;
  laneId?: string;
  serial?: string;
}): Promise<LaneInteractResolution> {
  try {
    return await applyLaneToInteract(input);
  } catch (error) {
    laneRunHttpError(error);
  }
}

/** Browser fixture / unsigned-lane overlay for interact and snapshot. */
export function runtimeOverlayFromLaneResolution(
  resolved: LaneInteractResolution,
  projectId: string,
):
  | {
      authenticationFixtureId?: string;
      projectId?: string;
      unsignedLaneId?: string;
    }
  | undefined {
  if (!resolved.authenticationFixtureId && !resolved.unsignedLaneId) return undefined;
  return {
    ...(resolved.authenticationFixtureId
      ? {
          authenticationFixtureId: resolved.authenticationFixtureId,
          projectId,
        }
      : {}),
    ...(resolved.unsignedLaneId ? { unsignedLaneId: resolved.unsignedLaneId } : {}),
  };
}

/** Overlay for target.open / Browser Device. Never writes grok-com fixture. */
export async function applyLaneToBrowserOpenOrThrow(input: {
  projectId: string;
  laneId: string;
  targetId: string;
}): Promise<LaneInteractResolution & { laneId: string }> {
  const resolved = await applyLaneToInteractOrThrow({
    projectId: input.projectId,
    laneId: input.laneId,
    serial: input.targetId,
  });
  return { ...resolved, laneId: input.laneId };
}
