/**
 * Runner glue for the browser-only actuation step kinds. Execution lives in
 * browser-actuation.ts; this module owns what the run records: screen
 * invalidation after every mutation and the active-page evidence a tab
 * switch leaves behind.
 */
import type { Device } from "../device/device.js";
import type { RecipeStep } from "@relay/protocol";
import { now } from "../collaboration/events.js";
import { runBrowserActuationStep } from "../browser/browser-actuation.js";
import { invalidateVerifiedScreen, type RecipeStepContext } from "./recipe-runner-context.js";

type ActuationStep = Extract<
  RecipeStep,
  { kind: "hover" | "select" | "press-key" | "drag" | "upload-file" | "switch-tab" }
>;

export async function runRecipeActuationStep(
  device: Device,
  step: ActuationStep,
  ctx: RecipeStepContext,
): Promise<void> {
  const switched = await runBrowserActuationStep(device, step, () => invalidateVerifiedScreen(ctx));
  if (!switched) return;
  ctx.job?.artifacts.push({ kind: "browser-tab", capturedAt: now(), data: switched });
  ctx.log(
    `switch-tab: active page ${switched.index + 1} of ${switched.pages} — ${switched.url || "about:blank"}`,
  );
}
