import assert from "node:assert/strict";
import test from "node:test";
import { accessibilityOverlaySnapshotNeeded } from "./use-device-stage-accessibility";

test("overlay collection requests one missing tree but never requeues a fresh overlay", () => {
  assert.equal(
    accessibilityOverlaySnapshotNeeded({
      collectionEnabled: true,
      liveViewActive: true,
      hasSnapshot: false,
    }),
    true,
  );
  assert.equal(
    accessibilityOverlaySnapshotNeeded({
      collectionEnabled: true,
      liveViewActive: true,
      hasSnapshot: true,
    }),
    false,
  );
});

test("inactive or pixels-only stages do not request an accessibility tree", () => {
  assert.equal(
    accessibilityOverlaySnapshotNeeded({
      collectionEnabled: false,
      liveViewActive: true,
      hasSnapshot: false,
    }),
    false,
  );
  assert.equal(
    accessibilityOverlaySnapshotNeeded({
      collectionEnabled: true,
      liveViewActive: false,
      hasSnapshot: false,
    }),
    false,
  );
});
