import assert from "node:assert/strict";
import test from "node:test";
import {
  androidInspectionState,
  androidScreenIsInspectable,
  parseAndroidUiSnapshot,
} from "./android-ui-snapshot.js";

test("parses Android UI dump into semantic, nested Relay nodes", () => {
  const nodes = parseAndroidUiSnapshot(`<?xml version="1.0"?>
    <hierarchy><node index="0" text="" resource-id="root" class="android.widget.FrameLayout" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
      <node index="0" text="Continue" content-desc="Continue setup" resource-id="app:id/continue" class="android.widget.Button" clickable="true" enabled="true" focused="false" bounds="[80,1900][1000,2020]" />
    </node></hierarchy>`);

  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[0]?.rect, { x: 0, y: 0, width: 1080, height: 2400 });
  assert.equal(nodes[1]?.label, "Continue setup");
  assert.equal(nodes[1]?.value, "Continue");
  assert.equal(nodes[1]?.identifier, "app:id/continue");
  assert.equal(nodes[1]?.hittable, true);
  assert.equal(nodes[1]?.parentIndex, 0);
});

test("does not inspect a keyguard or sleeping screen", () => {
  assert.equal(
    androidScreenIsInspectable(`
      KeyguardServiceDelegate
        showing=true
      screenState=SCREEN_STATE_OFF
      interactiveState=INTERACTIVE_STATE_SLEEP
    `),
    false,
  );
  assert.equal(
    androidInspectionState(
      "showing=true\nscreenState=SCREEN_STATE_ON\ninteractiveState=INTERACTIVE_STATE_AWAKE",
    ),
    "keyguard",
  );
  assert.equal(
    androidInspectionState(
      "screenState=SCREEN_STATE_OFF\ninteractiveState=INTERACTIVE_STATE_SLEEP",
    ),
    "asleep",
  );
  assert.equal(
    androidScreenIsInspectable(
      "screenState=SCREEN_STATE_ON\ninteractiveState=INTERACTIVE_STATE_AWAKE",
    ),
    true,
  );
});
