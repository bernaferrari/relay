import type { ScreenPatch } from "./model.js";
import { appMapFail } from "./errors.js";
import { assertIdentity } from "./connection-navigation-validation.js";
import { assertReviewedBinding } from "./reviewed-bindings-validation.js";
import { objectValue, requiredText } from "./validation-primitives.js";

export function assertScreenPatch(patch: ScreenPatch, label: string): void {
  objectValue(patch, label);
  if (patch.title !== undefined) requiredText(patch.title, `${label}.title`);
  if (patch.description !== undefined && patch.description !== null)
    requiredText(patch.description, `${label}.description`);
  if (patch.logicalStateBinding !== undefined && patch.logicalStateBinding !== null) {
    assertReviewedBinding(
      patch.logicalStateBinding,
      "logicalStateId",
      `${label}.logicalStateBinding`,
    );
  }
  if (patch.handoff !== undefined && patch.handoff !== null) {
    objectValue(patch.handoff, `${label}.handoff`);
    requiredText(patch.handoff.ownerApp, `${label}.handoff.ownerApp`, 240);
    if (patch.handoff.returnAction !== "back" && patch.handoff.returnAction !== "relaunch-source") {
      appMapFail("invalid-map", `${label}.handoff.returnAction is unsupported`);
    }
  }
  if (patch.identity !== undefined && patch.identity !== null)
    assertIdentity(patch.identity, `${label}.identity`);
  if (
    patch.evidenceSurface !== undefined &&
    patch.evidenceSurface !== null &&
    !["ordinary", "modal", "preview", "confirmation", "dead-end"].includes(patch.evidenceSurface)
  ) {
    appMapFail("invalid-map", `${label}.evidenceSurface is unsupported`);
  }
  if (
    patch.position !== undefined &&
    patch.position !== null &&
    (!Number.isFinite(patch.position.x) || !Number.isFinite(patch.position.y))
  ) {
    appMapFail("invalid-map", `${label}.position must contain finite coordinates`);
  }
}
