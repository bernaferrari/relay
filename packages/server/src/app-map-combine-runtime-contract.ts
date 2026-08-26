import {
  AppMapCombineCellContractError,
  savedAppMapTargetProfileIdsForTarget,
  type PreparedAppMapCombine,
} from "@relay/core";
import type { AppMap, ExecutionTargetRef } from "@relay/protocol";
import { HttpError } from "./http.js";

export function requireSingleTestUseAppMapTestRun(appMapId: string, testId: string): never {
  throw new HttpError(
    409,
    "Use app-map.test.run: this legacy Combine endpoint cannot freeze the Test's runtime evidence profile.",
    {
      code: "APP_MAP_COMBINE_RUNTIME_PROFILE_CONTRACT_REQUIRED",
      appMapId,
      testId,
      recovery: "Run this one Test through app-map.test.run with its selected targetProfileId.",
      recoveryAction: {
        operationId: "app-map.test.run",
        input: { appMapId, testId },
      },
      migration: {
        state: "awaiting-per-cell-frozen-runtime-profile",
        path: "single-test-run",
      },
    },
  );
}

function targetIdentity(
  target: ExecutionTargetRef | undefined,
): { targetId: string; platform: string } | undefined {
  return target ? { targetId: target.targetId, platform: target.platform } : undefined;
}

/** A failed binding recovery must name the exact ids an agent can bind, or the
 * capture step when the requested target has no saved profile at all. Without
 * that, the ids are only discoverable by reading raw map storage. */
function bindSavedTargetProfileRecovery(
  error: AppMapCombineCellContractError,
  context?: { map?: AppMap; target?: { targetId: string; platform: string } },
): string {
  const generic =
    "Bind an explicit saved targetProfileId to every selected Test × world cell, then retry. Relay will not borrow another cell's profile.";
  const map = context?.map;
  if (!map) return generic;
  const targets: Array<{ targetId: string; platform: string }> = [];
  for (const target of [
    context?.target,
    ...error.cells.flatMap((cell) => [targetIdentity(cell.target)]),
  ]) {
    if (
      target &&
      !targets.some(
        (known) => known.targetId === target.targetId && known.platform === target.platform,
      )
    ) {
      targets.push(target);
    }
  }
  if (!targets.length) return generic;
  const listings = targets.map((target) => ({
    target,
    profileIds: savedAppMapTargetProfileIdsForTarget(map, target),
  }));
  const withCandidates = listings.filter((listing) => listing.profileIds.length);
  const missing = listings
    .filter((listing) => !listing.profileIds.length)
    .map(
      (listing) =>
        `No saved runtime profile for target ${listing.target.platform}:${listing.target.targetId} — capture a screen on this target first.`,
    );
  if (!withCandidates.length) return missing.join(" ");
  return [
    "Bind an explicit saved targetProfileId to every selected Test × world cell, then retry.",
    ...withCandidates.map(
      (listing) =>
        `Saved runtime profiles for ${listing.target.platform}:${listing.target.targetId}: ${listing.profileIds.join(", ")}.`,
    ),
    ...missing,
    "Relay will not borrow another cell's profile.",
  ].join(" ");
}

export function combineCellContractHttpError(
  error: AppMapCombineCellContractError,
  context?: { map?: AppMap; target?: { targetId: string; platform: string } },
): HttpError {
  const first = error.issues[0];
  return new HttpError(409, error.message, {
    code: error.code,
    cells: error.cells,
    issues: error.issues,
    ...(first?.cellId ? { cellId: first.cellId } : {}),
    ...(first?.testId ? { testId: first.testId } : {}),
    ...(first?.targetProfileId ? { targetProfileId: first.targetProfileId } : {}),
    recovery: bindSavedTargetProfileRecovery(error, context),
    recoveryAction: {
      operationId: "app-map.combine.save",
      input: { cellRuntimeProfiles: "required" },
    },
  });
}

export function assertPreparedCombineCells(prepared: PreparedAppMapCombine): PreparedAppMapCombine {
  if (!prepared.selectedCells.length) {
    throw new HttpError(409, "No selected Combine cells are ready to run.", {
      code: "APP_MAP_COMBINE_CELL_CONTRACT",
      cells: prepared.cellStates,
      recovery: "Select at least one bound Combine cell.",
    });
  }
  return prepared;
}
