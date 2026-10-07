import { cooperativeCheckpoint } from "./control.js";
import { snapshot, rememberedTargetApplication, type Device, type SnapshotNode } from "./device.js";
import { isPhysicalRunnerRoute, resolveAppleControlRoute } from "./apple-control-route.js";
import { snapshotCompleteIosTreeForTargetApplication } from "./ios-runner-listener-command.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { ResponseBoundary } from "./recipe-response-boundary.js";
import { currentTargetContext, type DeviceTargetContext } from "./target-context.js";

export type RecipeResponseObservation = {
  nodes: SnapshotNode[];
  nativeApplication?: NonNullable<ResponseBoundary["nativeApplication"]>;
};

function nativeResponseTarget(): DeviceTargetContext | undefined {
  let context;
  try {
    context = currentTargetContext();
  } catch {
    return undefined;
  }
  return context.kind === "device" && isPhysicalRunnerRoute(resolveAppleControlRoute(context))
    ? context
    : undefined;
}

/** Response absence/freshness needs the current complete app tree. A catalog,
 * requested selector, or retained authoring frame cannot establish that census. */
export async function observeRecipeResponse(
  device: Device,
  ctx: RecipeStepContext,
): Promise<RecipeResponseObservation> {
  const context = nativeResponseTarget();
  if (!context) {
    return { nodes: await snapshot(device) };
  }
  await cooperativeCheckpoint();
  const appBundleId = await rememberedTargetApplication(context);
  const boundaryOwner = ctx.runtime?.responseBoundary?.nativeApplication;
  if (
    !appBundleId ||
    (ctx.recordingIosAppBundleId && ctx.recordingIosAppBundleId !== appBundleId) ||
    (boundaryOwner &&
      (boundaryOwner.serial !== context.serial || boundaryOwner.appBundleId !== appBundleId))
  ) {
    throw new Error("Response boundary application changed or is not bound to the current target");
  }
  // This route requires ok:true, explicit truncated:false, current Application
  // geometry, and real owner/system-surface guards. It has no SDK/cache fallback.
  const nodes = await snapshotCompleteIosTreeForTargetApplication(context, appBundleId);
  if ((await rememberedTargetApplication(context)) !== appBundleId) {
    throw new Error("Response observation application changed during the current tree read");
  }
  await cooperativeCheckpoint();
  return { nodes, nativeApplication: { serial: context.serial, appBundleId } };
}

/** Legacy standalone browser/Android waits remain supported. Native current
 * action claims require the complete initiating receipt from this run. */
export async function requireCurrentActionResponseBoundary(ctx: RecipeStepContext): Promise<void> {
  if (ctx.runtime?.responseBoundaryUnavailable) {
    throw new Error(
      "Current-action response baseline unavailable; initiating boundary was not verified",
    );
  }
  const context = nativeResponseTarget();
  if (!context) return;
  const boundary = ctx.runtime?.responseBoundary;
  if (boundary?.source !== "initiating-action" || !boundary.nativeApplication) {
    throw new Error("Native current-action response requires a verified initiating boundary");
  }
  if (
    boundary.nativeApplication.serial !== context.serial ||
    boundary.nativeApplication.appBundleId !== (await rememberedTargetApplication(context))
  ) {
    throw new Error("Response boundary application changed or belongs to another target");
  }
}
