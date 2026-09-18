import type { AppMap } from "@relay/protocol";
import {
  AppMapCombineCellContractError,
  AppMapCompileError,
  AppMapTargetProfileError,
  currentOperationContext,
  updateCombineCampaign,
} from "@relay/core";

import { combineCellContractHttpError } from "./app-map-combine-runtime-contract.js";
import { httpErrorFromAppMapTargetProfile } from "./app-map-test-run-prepare.js";
import { HttpError } from "./http.js";
import type { RequestContext } from "./security.js";

/** Compensate every durable side effect made while admitting one Combine. */
export async function compensateCombineStartFailure(input: {
  error: unknown;
  scope: RequestContext;
  map: AppMap;
  targetId?: string;
  requestedPlatform?: "android" | "ios" | "browser";
  staged?: { rollback(): void };
  admission?: { rollback(): Promise<void> };
  persistedCampaignId?: string;
}): Promise<never> {
  const cleanupErrors: string[] = [];
  try {
    input.staged?.rollback();
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    await input.admission?.rollback();
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (input.persistedCampaignId) {
    try {
      const at = Date.now();
      await updateCombineCampaign(input.scope.projectId, input.persistedCampaignId, (current) => ({
        ...current,
        status: "cancelled",
        updatedAt: at,
        cases: current.cases.map((item) =>
          item.jobId ? { ...item, status: "cancelled" as const } : item,
        ),
        lineage: [
          ...current.lineage,
          {
            kind: "cancelled",
            at,
            appMapRevision: current.latestRevision,
            actorId: currentOperationContext()!.actorId,
          },
        ],
      }));
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (cleanupErrors.length) {
    throw new HttpError(
      500,
      `Combine admission failed and Relay could not fully compensate staged work: ${cleanupErrors.join("; ")}`,
    );
  }
  if (input.error instanceof HttpError) throw input.error;
  if (input.error instanceof AppMapTargetProfileError) {
    throw httpErrorFromAppMapTargetProfile(input.error);
  }
  if (input.error instanceof AppMapCombineCellContractError) {
    throw combineCellContractHttpError(input.error, {
      map: input.map,
      ...(input.targetId
        ? { target: { targetId: input.targetId, platform: input.requestedPlatform ?? "browser" } }
        : {}),
    });
  }
  if (input.error instanceof AppMapCompileError) throw new HttpError(409, input.error.message);
  throw new HttpError(
    400,
    input.error instanceof Error ? input.error.message : String(input.error),
  );
}
