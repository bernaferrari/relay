import type {
  AppMap,
  AuthoringTarget,
  LogicalScrollSurface,
  Screen,
  ScreenVariant,
} from "@relay/protocol";
import { HttpError } from "./http.js";

/** Resolve the exact logical screen + target/locale variant before any device
 * control begins. A stale or mismatched selection must never capture against a
 * convenient-but-wrong variant. */
export function resolveScrollSurfaceCaptureSelection(input: {
  appMap: AppMap;
  expectedRevision: number;
  screenId: string;
  variantId: string;
  target: AuthoringTarget;
}): { screen: Screen; variant: ScreenVariant } {
  if (input.appMap.revision !== input.expectedRevision) {
    throw new HttpError(
      409,
      `Expected App Map revision ${input.expectedRevision}, current revision is ${input.appMap.revision}`,
      {
        code: "revision-conflict",
        recovery: "Reload the App Map and retry against its current revision.",
        current: input.appMap,
      },
    );
  }
  const screen = input.appMap.screens[input.screenId];
  const variant = input.appMap.screenVariants[input.variantId];
  if (
    !screen ||
    !variant ||
    variant.screenId !== input.screenId ||
    !screen.variantIds.includes(input.variantId)
  ) {
    throw new HttpError(404, `Screen ${input.screenId} does not own variant ${input.variantId}`);
  }
  if (
    input.target.kind !== "device" ||
    variant.targetProfile.targetId !== input.target.targetId ||
    variant.targetProfile.platform !== input.target.platform
  ) {
    throw new HttpError(
      409,
      "The selected target does not match this Screen Variant's target profile",
      {
        code: "target-profile-mismatch",
        recovery: "Select the device and locale represented by this Screen Variant, then retry.",
      },
    );
  }
  return { screen, variant };
}

export function resolveScrollSurfaceRegenerationSelection(input: {
  appMap: AppMap;
  expectedRevision: number;
  screenId: string;
  variantId: string;
  captureId: string;
}): { screen: Screen; variant: ScreenVariant; surface: LogicalScrollSurface } {
  if (input.appMap.revision !== input.expectedRevision) {
    throw new HttpError(
      409,
      `Expected App Map revision ${input.expectedRevision}, current revision is ${input.appMap.revision}`,
      {
        code: "revision-conflict",
        recovery: "Reload the App Map and retry against its current revision.",
        current: input.appMap,
      },
    );
  }
  const screen = input.appMap.screens[input.screenId];
  const variant = input.appMap.screenVariants[input.variantId];
  if (!screen || !variant || variant.screenId !== screen.id) {
    throw new HttpError(404, `Screen ${input.screenId} does not own variant ${input.variantId}`);
  }
  const surface = variant.scrollSurfaces?.find(
    (candidate) => candidate.captureId === input.captureId,
  );
  if (!surface) throw new HttpError(404, `Scroll capture ${input.captureId} not found`);
  return { screen, variant, surface };
}
