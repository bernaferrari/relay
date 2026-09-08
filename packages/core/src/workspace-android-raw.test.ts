import assert from "node:assert/strict";
import test from "node:test";
import { androidKeyCode } from "./workspace-android-raw.js";

test("raw Android navigation keys never fall through to backspace", () => {
  assert.equal(androidKeyCode("enter"), "KEYCODE_ENTER");
  assert.equal(androidKeyCode("backspace"), "KEYCODE_DEL");
  assert.equal(androidKeyCode("back"), "KEYCODE_BACK");
  assert.equal(androidKeyCode("home"), "KEYCODE_HOME");
  assert.equal(androidKeyCode("recents"), "KEYCODE_APP_SWITCH");
});
