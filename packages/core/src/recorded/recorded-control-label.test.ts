import assert from "node:assert/strict";
import test from "node:test";
import {
  recordedControlDisplayName,
  registerRecordedControlDisplayAliasResolver,
} from "./recorded-control-label.js";

const target = { identifier: "input_send_button" };
const button = {
  identifier: "input_send_button",
  bundleId: "com.example.app",
  type: "android.view.View",
  enabled: true,
  hittable: true,
};

test("registered control aliases are presentation only and unregister cleanly", () => {
  const before = structuredClone(target);
  assert.equal(recordedControlDisplayName(target, [button]), undefined);
  const unregister = registerRecordedControlDisplayAliasResolver(({ control }) =>
    control.bundleId === "com.example.app" ? "Send message" : undefined,
  );
  try {
    assert.equal(recordedControlDisplayName(target, [button]), "Send message");
    assert.deepEqual(target, before);
  } finally {
    unregister();
  }
  assert.equal(recordedControlDisplayName(target, [button]), undefined);
});

test("foreign, ambiguous, disabled and unknown controls retain their technical names", () => {
  const unregister = registerRecordedControlDisplayAliasResolver(() => "Send message");
  try {
    for (const nodes of [
      [button, button],
      [{ ...button, enabled: false }],
      [{ ...button, visibleToUser: false }],
      [{ ...button, identifier: "another_send_button" }],
    ])
      assert.equal(recordedControlDisplayName(target, nodes, "android"), undefined);
    assert.equal(
      recordedControlDisplayName({ identifier: "another_send_button" }, [button]),
      undefined,
    );
    assert.equal(recordedControlDisplayName({ point: { x: 20, y: 30 } }, [button]), undefined);
  } finally {
    unregister();
  }
});
