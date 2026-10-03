import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GROK_ANDROID_APP_POLICY } from "./app-identity-policy.js";
import type { SnapshotNode } from "./device.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeScreenIdentityForHost,
} from "./screen-identity.js";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/grok-imagine-workspace.json", import.meta.url), "utf8"),
) as {
  template: SnapshotNode[];
  generated: SnapshotNode[];
  editor: SnapshotNode[];
  speed: SnapshotNode[];
  promotionalModal: SnapshotNode[];
  rememberedSpeedEditor: SnapshotNode[];
};
const native = (nodes: SnapshotNode[]) =>
  observeScreenIdentityForHost(nodes, { appMapId: "grok-android" });
test("captured Imagine template and generated grid retain one root workspace identity", () => {
  assert.equal(
    compareScreenIdentity(native(fixture.template), native(fixture.generated)).decision,
    "match",
  );
});
test("generic maps retain the original destination mismatch", () => {
  assert.notEqual(
    compareScreenIdentity(
      observeScreenIdentity(fixture.template),
      observeScreenIdentity(fixture.generated),
    ).decision,
    "match",
  );
});
test("native root policy preserves captured editor and selected model boundaries", () => {
  const root = native(fixture.template);
  assert.notEqual(compareScreenIdentity(root, native(fixture.editor)).decision, "match");
  assert.notEqual(compareScreenIdentity(root, native(fixture.speed)).decision, "match");
  const quality = fixture.speed.map((node) =>
    node.label === "Speed" ? { ...node, label: "Quality", value: "Quality" } : node,
  );
  assert.notEqual(native(fixture.speed).fingerprint, native(quality).fingerprint);
});
test("native root policy requires real application ownership and selected Imagine navigation", () => {
  const otherApp = fixture.template.map((node) => ({
    ...node,
    bundleId: "example.other",
    ...(node.identifier?.startsWith("ai.x.grok:")
      ? { identifier: node.identifier.replace("ai.x.grok:", "example.other:") }
      : {}),
  }));
  assert.notEqual(
    compareScreenIdentity(native(fixture.template), native(otherApp)).decision,
    "match",
  );
  const unselected = fixture.template.map((node) => ({ ...node, selected: false }));
  assert.notEqual(
    compareScreenIdentity(native(fixture.template), native(unselected)).decision,
    "match",
  );
  const modal = [
    ...fixture.template,
    {
      bundleId: "com.android.permissioncontroller",
      type: "android.widget.Button",
      label: "Allow",
      visibleToUser: true,
    },
  ];
  assert.notEqual(compareScreenIdentity(native(fixture.template), native(modal)).decision, "match");
});

test("workspace qualification needs the owned root, live composer and visible nav", () => {
  for (const missing of [
    "ai.x.grok:id/action_bar_root",
    "conversation_top_bar",
    "Attach media",
    "Imagine settings",
  ]) {
    const incomplete = fixture.template.filter(
      (node) => node.identifier !== missing && node.label !== missing,
    );
    assert.notEqual(
      compareScreenIdentity(native(incomplete), native(fixture.template)).decision,
      "match",
    );
  }
  const disabled = fixture.template.map((node) =>
    node.label === "Attach media" ? { ...node, enabled: false } : node,
  );
  assert.notEqual(
    compareScreenIdentity(native(disabled), native(fixture.template)).decision,
    "match",
  );
  const dialog = [
    ...fixture.template,
    {
      bundleId: "ai.x.grok",
      type: "android.app.Dialog",
      label: "Choose image",
      visibleToUser: true,
    },
  ];
  assert.notEqual(
    compareScreenIdentity(native(dialog), native(fixture.template)).decision,
    "match",
  );
});
test("captured editor retains model and input state while its background changes", () => {
  const changedBody = fixture.speed.map((node) =>
    node.rect && node.rect.y > 295 && node.rect.y < 1092
      ? { ...node, label: node.label ? "Generated gallery content" : undefined }
      : node,
  );
  assert.equal(native(fixture.speed).fingerprint, native(changedBody).fingerprint);
  assert.notEqual(native(fixture.editor).fingerprint, native(fixture.speed).fingerprint);
});

test("destination proof rejects the captured wrong model despite high semantic similarity", async () => {
  const { runExpectScreenStep } = await import("./recipe-runner-screen.js");
  const { GROK_ANDROID_APP_POLICY } = await import("./app-identity-policy.js");
  const expected = native(fixture.editor);
  const context = {
    runtime: { identityPolicy: GROK_ANDROID_APP_POLICY },
    log: () => {},
    observeVisualFingerprint: async () => undefined,
  };
  const device = {
    command: {
      wait: async () => {
        throw new Error("no device commands permitted");
      },
    },
  } as unknown as import("./device.js").Device;
  await assert.rejects(
    runExpectScreenStep(
      device,
      {
        kind: "expect-screen",
        screenId: "editor",
        screenTitle: "Imagine editor",
        fingerprint: expected.fingerprint,
        observations: [expected],
        timeoutMs: 0,
      },
      context,
      { observeSnapshot: async () => fixture.speed, getLocalization: async () => undefined },
    ),
    /expect-screen:/,
  );
  await runExpectScreenStep(
    device,
    {
      kind: "expect-screen",
      screenId: "editor",
      screenTitle: "Imagine editor",
      fingerprint: expected.fingerprint,
      observations: [expected],
      timeoutMs: 0,
    },
    context,
    { observeSnapshot: async () => fixture.editor, getLocalization: async () => undefined },
  );
});

test("actual second repeat announcement sheet cannot prove the Imagine workspace", async () => {
  const { runExpectScreenStep } = await import("./recipe-runner-screen.js");
  const { GROK_ANDROID_APP_POLICY } = await import("./app-identity-policy.js");
  const expected = native(fixture.template);
  assert.notEqual(
    compareScreenIdentity(expected, native(fixture.promotionalModal)).decision,
    "match",
  );
  const context = {
    runtime: { identityPolicy: GROK_ANDROID_APP_POLICY },
    log: () => {},
    observeVisualFingerprint: async () => undefined,
  };
  const device = {
    command: {
      wait: async () => {
        throw new Error("no device commands permitted");
      },
    },
  } as unknown as import("./device.js").Device;
  await assert.rejects(
    runExpectScreenStep(
      device,
      {
        kind: "expect-screen",
        screenId: "imagine",
        screenTitle: "Imagine",
        fingerprint: expected.fingerprint,
        observations: [expected],
        timeoutMs: 0,
      },
      context,
      {
        observeSnapshot: async () => fixture.promotionalModal,
        getLocalization: async () => undefined,
      },
    ),
    /expect-screen:/,
  );
});

test("editor entry accepts captured remembered default only before explicit model selection", () => {
  const pending = (nodes: SnapshotNode[]) =>
    observeScreenIdentity(nodes, {
      policy: GROK_ANDROID_APP_POLICY,
      nativeImaginePendingModel: true,
    });
  assert.equal(
    pending(fixture.editor).fingerprint,
    pending(fixture.rememberedSpeedEditor).fingerprint,
  );
  assert.notEqual(
    native(fixture.editor).fingerprint,
    native(fixture.rememberedSpeedEditor).fingerprint,
  );
  assert.equal(
    native(fixture.speed).fingerprint,
    native(fixture.rememberedSpeedEditor).fingerprint,
  );
});
