import assert from "node:assert/strict";
import test from "node:test";
import { recordedControlDisplayName } from "./recorded-control-label.js";

const target = { identifier: "input_send_button" };
const button = {
  identifier: "input_send_button",
  bundleId: "ai.x.grok",
  type: "android.view.View",
  enabled: true,
  hittable: true,
};

test("a captured unlabeled Grok send control gets a display name without changing its selector", () => {
  const before = structuredClone(target);
  assert.equal(recordedControlDisplayName(target, [button]), "Send message");
  assert.deepEqual(target, before);
});

test("normalized Android captures require the retained Grok resource owner", () => {
  const normalized = { identifier: "input_send_button", role: "android.view.view", hittable: true };
  const root = { identifier: "ai.x.grok:id/action_bar_root", role: "android.widget.linearlayout" };
  assert.equal(recordedControlDisplayName(target, [root, normalized], "android"), "Send message");
  assert.equal(recordedControlDisplayName(target, [normalized], "android"), undefined);
  assert.equal(recordedControlDisplayName(target, [root, normalized], "web"), undefined);
});

test("foreign, ambiguous, disabled and unknown controls retain their technical names", () => {
  for (const nodes of [
    [{ ...button, bundleId: "example.app" }],
    [button, button],
    [{ ...button, enabled: false }],
    [{ ...button, visibleToUser: false }],
    [{ ...button, identifier: "another_send_button" }],
    [{ ...button, bundleId: "example.app" }, { identifier: "ai.x.grok:id/action_bar_root" }],
  ])
    assert.equal(recordedControlDisplayName(target, nodes, "android"), undefined);
  assert.equal(
    recordedControlDisplayName({ identifier: "another_send_button" }, [button]),
    undefined,
  );
  assert.equal(recordedControlDisplayName({ point: { x: 20, y: 30 } }, [button]), undefined);
});
