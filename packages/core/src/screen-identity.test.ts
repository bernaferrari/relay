import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeVisualScreenFingerprint,
  resolveScreenIdentity,
} from "./screen-identity.js";

function observe(nodes: SnapshotNode[]) {
  return observeScreenIdentity(nodes);
}

function visualScreen(options: { top?: [number, number, number]; panelX: number }): Buffer {
  const png = new PNG({ width: 108, height: 234 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const top = options.top ?? [18, 18, 18];
      const inSystemBar = y < 12;
      const inPanel = x >= options.panelX && x < options.panelX + 32 && y >= 22 && y < 40;
      const colour: readonly [number, number, number] = inSystemBar
        ? top
        : inPanel
          ? [232, 232, 232]
          : [18, 18, 18];
      png.data[offset] = colour[0];
      png.data[offset + 1] = colour[1];
      png.data[offset + 2] = colour[2];
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test("visual fallback ignores system bars but distinguishes custom-rendered screens", () => {
  const first = observeVisualScreenFingerprint(visualScreen({ panelX: 12 }));
  const changedClock = observeVisualScreenFingerprint(
    visualScreen({ panelX: 12, top: [245, 80, 120] }),
  );
  const nextScreen = observeVisualScreenFingerprint(visualScreen({ panelX: 28 }));

  assert.match(first ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(first, changedClock);
  assert.notEqual(first, nextScreen);
  assert.equal(observeVisualScreenFingerprint(Buffer.from("not a png")), undefined);
});

test("stable semantics match across traversal order, whitespace, and hidden nodes", () => {
  const first = observe([
    {
      role: "heading",
      label: "  Sign   in  ",
      identifier: "auth.title",
      visibleToUser: true,
    },
    { role: "textbox", label: "Email", identifier: "auth.email", visibleToUser: true },
    { role: "button", label: "Continue", identifier: "auth.continue", visibleToUser: true },
    { role: "text", label: "Debug overlay", visibleToUser: false },
  ]);
  const second = observe([
    { role: "button", label: "continue", identifier: "auth.continue", visibleToUser: true },
    { role: "textbox", label: "Email", identifier: "auth.email", visibleToUser: true },
    { role: "heading", label: "Sign in", identifier: "auth.title", visibleToUser: true },
  ]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(compareScreenIdentity(first, second), {
    confidence: 1,
    decision: "match",
    signals: [
      {
        kind: "exact-fingerprint",
        impact: "positive",
        strength: 1,
        detail: "All normalized visible semantics match.",
      },
    ],
  });
  assert.equal(first.nodes.find((node) => node.role === "textbox")?.identifier, "auth.email");
});

test("Android system chrome and keyboards do not redefine an application screen", () => {
  const app = {
    type: "android.widget.Button",
    label: "Continue",
    bundleId: "com.example.app",
    visibleToUser: true,
  };
  const first = observe([
    app,
    {
      type: "android.widget.TextView",
      label: "09:41",
      bundleId: "com.android.systemui",
      visibleToUser: true,
    },
    {
      type: "android.widget.Button",
      label: "Q",
      bundleId: "com.touchtype.swiftkey",
      visibleToUser: true,
    },
  ]);
  const second = observe([
    app,
    {
      type: "android.widget.TextView",
      label: "18:22",
      bundleId: "com.android.systemui",
      visibleToUser: true,
    },
  ]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.nodes, [{ role: "android.widget.button", label: "continue" }]);
});

test("iOS keyboard and input-assistant subtrees do not redefine an application screen", () => {
  const app: SnapshotNode[] = [
    {
      index: 0,
      depth: 0,
      type: "Application",
      label: "Grok",
      visibleToUser: true,
    },
    {
      index: 1,
      parentIndex: 0,
      depth: 1,
      type: "TextView",
      label: "New Message",
      identifier: "ask.toolbar.textfield",
      visibleToUser: true,
    },
  ];
  const withKeyboard = observe([
    ...app,
    { index: 2, parentIndex: 0, depth: 1, type: "Other", visibleToUser: true },
    {
      index: 3,
      parentIndex: 2,
      depth: 2,
      type: "Keyboard",
      label: "Q",
      visibleToUser: true,
    },
    { index: 4, parentIndex: 3, depth: 3, type: "Key", label: "Q", visibleToUser: true },
    {
      index: 5,
      parentIndex: 0,
      depth: 1,
      type: "Other",
      label: "Typing Predictions",
      identifier: "SystemInputAssistantView",
      visibleToUser: true,
    },
    {
      index: 6,
      parentIndex: 5,
      depth: 2,
      type: "Button",
      label: "Paste",
      identifier: "assistantPaste:forEvent:",
      visibleToUser: true,
    },
  ]);
  const withoutKeyboard = observe(app);

  assert.equal(withKeyboard.fingerprint, withoutKeyboard.fingerprint);
  assert.deepEqual(withKeyboard.nodes, withoutKeyboard.nodes);
});

test("volatile clocks, dates, percentages, counters, relative times, and UUIDs retain context", () => {
  const first = observe([
    { role: "text", label: "Updated at 09:41", visibleToUser: true },
    { role: "text", label: "Friday, July 31, 2026", visibleToUser: true },
    { role: "progressbar", label: "Upload", value: "28%", visibleToUser: true },
    { role: "text", label: "3 unread messages", visibleToUser: true },
    { role: "text", label: "Synced 6 min ago", visibleToUser: true },
    {
      role: "button",
      label: "Open invoice",
      identifier: "invoice-550e8400-e29b-41d4-a716-446655440000",
      visibleToUser: true,
    },
  ]);
  const second = observe([
    { role: "text", label: "Updated at 18:22", visibleToUser: true },
    { role: "text", label: "Saturday, August 1, 2026", visibleToUser: true },
    { role: "progressbar", label: "Upload", value: "83%", visibleToUser: true },
    { role: "text", label: "19 unread messages", visibleToUser: true },
    { role: "text", label: "Synced 2 h ago", visibleToUser: true },
    {
      role: "button",
      label: "Open invoice",
      identifier: "invoice-123e4567-e89b-42d3-a456-426614174000",
      visibleToUser: true,
    },
  ]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(compareScreenIdentity(first, second).confidence, 1);
  assert.deepEqual([...new Set(first.volatileSignals.map((item) => item.kind))].sort(), [
    "clock",
    "counter",
    "date",
    "percentage",
    "relative-time",
    "uuid",
  ]);
  assert.equal(first.nodes.find((node) => node.role === "button")?.label, "open invoice");
  assert.equal(first.nodes.find((node) => node.role === "button")?.identifier, "invoice-<uuid>");
  assert.ok(first.nodes.some((node) => node.label === "<count> unread messages"));
});

test("truly different screens produce conflicting evidence and resolve as new", () => {
  const signIn = observe([
    { role: "heading", label: "Sign in", identifier: "auth.title", visibleToUser: true },
    { role: "textbox", label: "Email", identifier: "auth.email", visibleToUser: true },
    { role: "textbox", label: "Password", identifier: "auth.password", visibleToUser: true },
    { role: "button", label: "Continue", identifier: "auth.continue", visibleToUser: true },
  ]);
  const settings = observe([
    { role: "heading", label: "Settings", identifier: "settings.title", visibleToUser: true },
    {
      role: "switch",
      label: "Notifications",
      identifier: "settings.notifications",
      visibleToUser: true,
    },
    { role: "button", label: "Privacy", identifier: "settings.privacy", visibleToUser: true },
    { role: "button", label: "Sign out", identifier: "settings.signout", visibleToUser: true },
  ]);

  const comparison = compareScreenIdentity(signIn, settings);
  assert.equal(comparison.decision, "different");
  assert.ok(comparison.confidence < 0.5);
  assert.ok(comparison.signals.some((item) => item.kind === "semantic-conflict"));

  const resolution = resolveScreenIdentity(settings, [{ id: "sign-in", observation: signIn }]);
  assert.equal(resolution.kind, "new");
});

test("empty trees are deterministic but never considered identity proof", () => {
  const first = observe([]);
  const second = observe([{ visibleToUser: true }, { label: "Hidden", visibleToUser: false }]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.nodes, []);
  assert.equal(compareScreenIdentity(first, second).decision, "insufficient");
  assert.equal(compareScreenIdentity(first, second).confidence, 0);
  assert.equal(resolveScreenIdentity(first, [{ id: "empty", observation: second }]).kind, "new");
});

test("candidate resolution chooses the strongest match and ranks ties deterministically", () => {
  const target = observe([
    { role: "heading", label: "Inbox", identifier: "inbox.title", visibleToUser: true },
    { role: "button", label: "Compose", identifier: "inbox.compose", visibleToUser: true },
    { role: "text", label: "4 unread messages", visibleToUser: true },
  ]);
  const inboxVariant = observe([
    { role: "heading", label: "Inbox", identifier: "inbox.title", visibleToUser: true },
    { role: "button", label: "Compose", identifier: "inbox.compose", visibleToUser: true },
    { role: "text", label: "12 unread messages", visibleToUser: true },
  ]);
  const profile = observe([
    { role: "heading", label: "Profile", identifier: "profile.title", visibleToUser: true },
    { role: "button", label: "Edit", identifier: "profile.edit", visibleToUser: true },
  ]);

  const resolved = resolveScreenIdentity(target, [
    { id: "profile", observation: profile },
    { id: "inbox", observation: inboxVariant },
  ]);
  assert.equal(resolved.kind, "existing");
  if (resolved.kind === "existing") assert.equal(resolved.match.candidate.id, "inbox");

  const duplicateCandidates = [
    { id: "z-copy", observation: inboxVariant },
    { id: "a-copy", observation: inboxVariant },
  ];
  const ambiguous = resolveScreenIdentity(target, duplicateCandidates);
  assert.equal(ambiguous.kind, "ambiguous");
  assert.deepEqual(
    ambiguous.ranked.map((item) => item.candidate.id),
    ["a-copy", "z-copy"],
  );
});

test("fingerprints and normalized nodes are deterministic for arbitrary input ordering", () => {
  const nodes: SnapshotNode[] = [
    { role: "button", label: "Save", identifier: "editor.save", visibleToUser: true },
    { role: "textbox", label: "Title", identifier: "editor.title", visibleToUser: true },
    { role: "text", value: "Page 2 of 10 at 09:41", visibleToUser: true },
  ];
  const forward = observe(nodes);
  const reversed = observe([...nodes].reverse());

  assert.equal(forward.fingerprint, reversed.fingerprint);
  assert.deepEqual(forward.nodes, reversed.nodes);
  assert.deepEqual(forward.volatileSignals, reversed.volatileSignals);
  assert.match(forward.fingerprint, /^[0-9a-f]{64}$/u);
});
