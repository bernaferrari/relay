import * as z from "zod/v4";
import type { InteractPreviewResolutionState } from "@relay/protocol";
import { rememberedTargetApplication, type NamedControlResolution } from "./device.js";
import { resolveIosLaunchBundleId } from "./ios-app-launch.js";
import { probeLiveIosRunnerListener } from "./ios-runner-listener.js";
import { postAdoptedIosRunnerCommand } from "./ios-runner-listener-command.js";
import type { TargetContext } from "./target-context.js";

const rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const receiptSchema = z.object({
  version: z.literal(1),
  source: z.literal("xcui-tap-selector-policy"),
  appBundleId: z.string(),
  appStateBefore: z.literal("runningForeground"),
  appStateAfter: z.literal("runningForeground"),
  selectorKey: z.enum(["id", "label"]),
  selectorValue: z.string(),
  allowNonHittableCoordinateFallback: z.literal(true),
  filtersByExpectedPoint: z.literal(false),
  coordinateSpace: z.literal("application-logical"),
  status: z.enum(["resolved", "ambiguous", "unresolved"]),
  candidateCount: z.number().int().nonnegative(),
  candidateBounds: rect.optional(),
  candidateHittable: z.boolean().optional(),
  windowBounds: rect.optional(),
});

export type IosSelectorPreview = {
  resolutionState: InteractPreviewResolutionState;
  resolution?: NamedControlResolution;
  windowBounds?: z.infer<typeof rect>;
};

/** One read-only, app-bound native tap-policy census. No cached chrome or
 * ordinary querySelector node can establish this observation-time proof. */
export async function observeIosSelectorPreview(
  context: TargetContext,
  selector?: { key: "id" | "label"; value: string },
): Promise<IosSelectorPreview> {
  const unavailable: IosSelectorPreview = { resolutionState: "unavailable" };
  if (context.kind !== "device" || context.platform !== "ios" || !selector?.value.trim())
    return unavailable;
  try {
    const remembered = await rememberedTargetApplication(context);
    if (!remembered) return unavailable;
    const appBundleId = resolveIosLaunchBundleId(remembered);
    const listener = await probeLiveIosRunnerListener(context.serial);
    if (!listener || listener.serial !== context.serial) return unavailable;
    const result = await postAdoptedIosRunnerCommand(
      listener,
      {
        command: "querySelectorTapCandidate",
        appBundleId,
        selectorKey: selector.key,
        selectorValue: selector.value,
        allowNonHittableCoordinateFallback: true,
        timeoutMs: 15_000,
      },
      20_000,
    );
    if (result.ok !== true || result.data?.systemSurface !== undefined) return unavailable;
    const parsed = receiptSchema.safeParse(result.data?.selectorCandidateReceipt);
    if (!parsed.success) return unavailable;
    const proof = parsed.data;
    if (
      proof.appBundleId !== appBundleId ||
      proof.selectorKey !== selector.key ||
      proof.selectorValue !== selector.value
    )
      return unavailable;
    if (proof.status !== "resolved") {
      if (
        proof.candidateBounds ||
        proof.windowBounds ||
        proof.candidateHittable !== undefined ||
        (proof.status === "ambiguous" && proof.candidateCount < 2)
      )
        return unavailable;
      return { resolutionState: proof.status };
    }
    const bounds = proof.candidateBounds;
    const window = proof.windowBounds;
    if (
      proof.candidateCount < 1 ||
      proof.candidateHittable !== true ||
      !bounds ||
      !window ||
      window.x !== 0 ||
      window.y !== 0 ||
      !Number.isSafeInteger(window.width) ||
      !Number.isSafeInteger(window.height)
    )
      return unavailable;
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    if (point.x < 0 || point.y < 0 || point.x > window.width || point.y > window.height)
      return unavailable;
    return {
      resolutionState: "resolved",
      windowBounds: window,
      resolution: { method: selector.key === "id" ? "identifier" : "label", bounds, point },
    };
  } catch {
    return unavailable;
  }
}
