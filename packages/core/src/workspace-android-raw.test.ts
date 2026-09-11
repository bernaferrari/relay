import assert from "node:assert/strict";
import test from "node:test";
import { androidKeyCode, primaryAndroidDisplay } from "./workspace-android-raw.js";

test("raw Android navigation keys never fall through to backspace", () => {
  assert.equal(androidKeyCode("enter"), "KEYCODE_ENTER");
  assert.equal(androidKeyCode("backspace"), "KEYCODE_DEL");
  assert.equal(androidKeyCode("back"), "KEYCODE_BACK");
  assert.equal(androidKeyCode("home"), "KEYCODE_HOME");
  assert.equal(androidKeyCode("recents"), "KEYCODE_APP_SWITCH");
});

test("screenshots select HWC display zero without rounding its 64-bit ID", () => {
  assert.equal(
    primaryAndroidDisplay(
      "Display 4619827551948147201 (HWC display 1): port=1\nDisplay 4619827259835644672 (HWC display 0): port=0",
    ),
    "4619827259835644672",
  );
  assert.throws(
    () => primaryAndroidDisplay("Display 12 (virtual)\nDisplay 13 (virtual)"),
    /primary Android display/,
  );
  assert.equal(primaryAndroidDisplay("Display 12 (physical)"), "12");
});
