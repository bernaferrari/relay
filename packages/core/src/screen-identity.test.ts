import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import type { SnapshotNode } from "./device.js";
import { GROK_WEB_APP_POLICY } from "./app-identity-policy.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  observeVisualScreenFingerprint,
  resolveScreenIdentity,
} from "./screen-identity.js";

function observe(nodes: SnapshotNode[]) {
  return observeScreenIdentity(nodes);
}

function observeGrok(nodes: SnapshotNode[]) {
  return observeScreenIdentity(nodes, { policy: GROK_WEB_APP_POLICY });
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

test("rotating composer hints and generated radix ids do not redefine a browser screen", () => {
  const observe = observeGrok;
  const chrome = (hint: string, radix: string): SnapshotNode[] => [
    { role: "button", label: "Sign in", visibleToUser: true },
    { role: "button", label: "Submit", identifier: "chat-submit", visibleToUser: true },
    { role: "button", label: "Settings", identifier: radix, visibleToUser: true },
    { role: "textarea", label: "Ask Grok anything", visibleToUser: true },
    { role: "text", label: hint, visibleToUser: true },
    {
      role: "main",
      identifier: "grok-content-area",
      label: `Imagine Sign in ${hint} Fast`,
      visibleToUser: true,
    },
  ];
  const first = observe(chrome("Type @ to search your apps", "radix-_r_2q_"));
  const second = observe(chrome("Drag and drop folders into chat", "radix-_r_8k_"));
  const third = observe(chrome("Type / to use slash commands", "radix-_r_aa_"));

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprint, third.fingerprint);
  assert.equal(compareScreenIdentity(first, second).decision, "match");
  assert.ok(first.volatileSignals.some((signal) => signal.kind === "placeholder"));
  assert.ok(first.volatileSignals.some((signal) => signal.kind === "generated-id"));
  assert.equal(
    first.nodes.find((node) => node.role === "button" && node.label === "settings")?.identifier,
    "<generated-id>",
  );
  assert.ok(first.nodes.some((node) => node.label === "<placeholder>"));
});

test("cookie consent chrome and landmark innerText dumps do not redefine a browser screen", () => {
  const observe = observeGrok;
  const chrome: SnapshotNode[] = [
    { role: "button", label: "Sign in", visibleToUser: true },
    { role: "button", label: "Sign up", visibleToUser: true },
    {
      role: "button",
      label: "Submit",
      identifier: "chat-submit",
      hittable: true,
      visibleToUser: true,
    },
    { role: "textarea", label: "Ask Grok anything", visibleToUser: true },
    { role: "h1", label: "What should we explore?", visibleToUser: true },
    { role: "text", label: "Type @ to search your apps", visibleToUser: true },
  ];
  const dump: SnapshotNode = {
    role: "main",
    identifier: "app-root",
    hittable: false,
    visibleToUser: true,
    label:
      "Imagine\nSign in\nSign up\nWhat should we explore?\nType @ to search your apps\nBy messaging Grok, you agree to our Terms",
  };
  const cookies: SnapshotNode[] = [
    { role: "dialog", label: "Cookie notice", visibleToUser: true },
    { role: "button", label: "Reject All", value: "Reject All", visibleToUser: true },
    {
      role: "button",
      label: "Accept All Cookies",
      value: "Accept All Cookies",
      visibleToUser: true,
    },
    { role: "button", label: "Cookies Settings", value: "Cookies Settings", visibleToUser: true },
    { role: "button", label: "Dismiss cookie notice", value: "Close", visibleToUser: true },
    { role: "a", label: "Cookie Policy", value: "Cookie Policy", visibleToUser: true },
    { role: "a", label: "Terms of Service", value: "Terms of Service", visibleToUser: true },
    { role: "g", identifier: "name=close-sm", visibleToUser: true },
    { role: "path", identifier: "vector", visibleToUser: true },
    { role: "text", label: "Close", visibleToUser: true },
    {
      role: "p",
      identifier: "cookie-banner-desc",
      label: "Essential cookies keep the site working and stay on.",
      visibleToUser: true,
    },
  ];
  const liveBanner: SnapshotNode[] = [
    {
      role: "p",
      label:
        "Essential cookies keep the site working and stay on. Optional cookies help with performance and advertising — accept, reject, or manage them. Learn more in our Cookie Policy, Privacy Policy, and Terms of Service.",
      visibleToUser: true,
    },
    { role: "button", label: "Reject All", visibleToUser: true },
    { role: "button", label: "Accept All Cookies", visibleToUser: true },
    { role: "button", label: "Cookies Settings", visibleToUser: true },
  ];
  const quiet = observe(chrome);
  const withDump = observe([...chrome, dump]);
  const withCookies = observe([...chrome, dump, ...cookies]);
  const otherHint = observe([
    ...chrome.map((node) =>
      node.role === "text" ? { ...node, label: "Switch to Build Mode to create apps" } : node,
    ),
    {
      ...dump,
      label:
        "Imagine\nSign in\nSign up\nWhat should we explore?\nSwitch to Build Mode to create apps\nBy messaging Grok, you agree to our Terms",
    },
  ]);

  const withLiveBanner = observe([...chrome, dump, ...liveBanner]);
  assert.equal(quiet.fingerprint, withDump.fingerprint);
  assert.equal(quiet.fingerprint, withCookies.fingerprint);
  assert.equal(quiet.fingerprint, withLiveBanner.fingerprint);
  assert.equal(quiet.fingerprint, otherHint.fingerprint);
  assert.equal(compareScreenIdentity(quiet, withCookies).decision, "match");
  assert.equal(compareScreenIdentity(quiet, withLiveBanner).decision, "match");
  assert.ok(!quiet.nodes.some((node) => node.identifier === "app-root"));
  assert.ok(!withCookies.nodes.some((node) => node.label === "reject all"));
  assert.ok(!withLiveBanner.nodes.some((node) => /essential cookies/iu.test(node.label ?? "")));
});

test("a Build Mode intro popover does not redefine signed-in home", () => {
  const observe = observeGrok;
  const chrome: SnapshotNode[] = [
    { role: "button", label: "Chat", visibleToUser: true },
    { role: "a", label: "Imagine", visibleToUser: true },
    { role: "h1", label: "What should we explore?", visibleToUser: true },
    { role: "textarea", label: "Ask Grok anything", visibleToUser: true },
    { role: "button", label: "Attach", identifier: "attach-button", visibleToUser: true },
    { role: "text", label: "Switch to Build Mode to create apps", visibleToUser: true },
    { role: "p", label: "Finance", visibleToUser: true },
    { role: "p", label: "Connect accounts to manage your finances in chat", visibleToUser: true },
    {
      role: "button",
      label: "Dismiss",
      rect: { x: 991, y: 382, width: 72, height: 32 },
      visibleToUser: true,
    },
    { role: "button", label: "Upgrade", visibleToUser: true },
  ];
  const overlay: SnapshotNode[] = [
    {
      role: "dialog",
      label: "Introducing Build Mode",
      identifier: "radix-_r_nh_",
      value:
        "Introducing Build Mode\nUse Build Mode to create websites, games, apps, and interactive dashboards.\nTry now\nDismiss",
      rect: { x: 824, y: 339, width: 320, height: 301 },
      visibleToUser: true,
    },
    { role: "text", label: "Introducing Build Mode", visibleToUser: true },
    {
      role: "text",
      label: "Use Build Mode to create websites, games, apps, and interactive dashboards.",
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Try now",
      rect: { x: 1058, y: 596, width: 74, height: 32 },
      visibleToUser: true,
    },
    { role: "text", label: "Try now", visibleToUser: true },
    {
      role: "button",
      label: "Dismiss",
      rect: { x: 828, y: 596, width: 72, height: 32 },
      visibleToUser: true,
    },
    { role: "text", label: "Dismiss", rect: { x: 839, y: 607, width: 50, height: 10 }, visibleToUser: true },
  ];
  const quiet = observe(chrome);
  const withOverlay = observe([...chrome, ...overlay]);
  assert.equal(quiet.fingerprint, withOverlay.fingerprint);
  assert.equal(compareScreenIdentity(quiet, withOverlay).decision, "match");
  assert.ok(!withOverlay.nodes.some((node) => /introducing build mode/iu.test(node.label ?? "")));
  assert.ok(!withOverlay.nodes.some((node) => node.label === "try now"));
  assert.equal(withOverlay.nodes.filter((node) => node.label === "dismiss").length, 1);
  assert.ok(withOverlay.nodes.some((node) => node.label === "finance"));
  assert.ok(withOverlay.nodes.some((node) => node.label === "<placeholder>"));
});

test("typeahead suggestions do not redefine composer-with-prompt identity", () => {
  const observe = observeGrok;
  const chrome: SnapshotNode[] = [
    { role: "a", label: "Home page", hittable: true, visibleToUser: true },
    { role: "a", label: "Imagine", hittable: true, visibleToUser: true },
    { role: "a", label: "Sign in", visibleToUser: true },
    { role: "button", label: "Settings", identifier: "radix-_r_9_", visibleToUser: true },
    { role: "button", label: "Attach", identifier: "attach-button", visibleToUser: true },
    { role: "button", label: "Submit", identifier: "chat-submit", visibleToUser: true },
    { role: "button", label: "Model select", value: "Fast", visibleToUser: true },
    { role: "h1", label: "What should we explore?", visibleToUser: true },
    { role: "text", label: "explore?", visibleToUser: true },
    { role: "text", label: "fast", visibleToUser: true },
    { role: "text", label: "imagine", visibleToUser: true },
    {
      role: "textarea",
      label: "Ask Grok anything",
      value: "hello",
      focused: true,
      visibleToUser: true,
    },
  ];
  const typeahead: SnapshotNode[] = [
    { role: "alert", identifier: "__next-route-announcer__", visibleToUser: true },
    { role: "option", label: "hello fresh", visibleToUser: true },
    { role: "text", label: "hello", visibleToUser: true },
    { role: "text", label: "fresh", visibleToUser: true },
    { role: "text", label: "kitty", visibleToUser: true },
  ];
  const emptyHome = observe(
    chrome.map((node) =>
      node.role === "textarea" ? { ...node, value: undefined, focused: false } : node,
    ),
  );
  const quiet = observe(chrome);
  const withTypeahead = observe([...chrome, ...typeahead]);
  assert.equal(quiet.fingerprint, withTypeahead.fingerprint);
  assert.notEqual(quiet.fingerprint, emptyHome.fingerprint);
  assert.equal(compareScreenIdentity(quiet, withTypeahead).decision, "match");
  assert.ok(!withTypeahead.nodes.some((node) => node.label === "fresh"));
  assert.ok(!withTypeahead.nodes.some((node) => node.identifier === "__next-route-announcer__"));
  assert.ok(quiet.nodes.some((node) => node.role === "textarea" && node.value === "hello"));
});

test("composer placeholders and feed tiles do not redefine chrome identity", () => {
  const observe = observeGrok;
  const chrome = (options: {
    heading: string;
    nav: string;
    placeholder: string;
    tiles: string[];
  }): SnapshotNode[] => [
    {
      role: "a",
      label: options.nav,
      rect: { x: 940, y: 11, width: 93, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Sign in",
      rect: { x: 1087, y: 11, width: 77, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "h1",
      label: options.heading,
      rect: { x: 493, y: 166, width: 283, height: 32 },
      visibleToUser: true,
    },
    {
      role: "textbox",
      label: options.placeholder,
      rect: { x: 270, y: 232, width: 740, height: 42 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Submit",
      identifier: "chat-submit",
      rect: { x: 960, y: 282, width: 40, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    ...options.tiles.map((label, index) => ({
      role: "a" as const,
      label,
      rect: {
        x: 258 + (index % 3) * 254,
        y: 366 + Math.floor(index / 3) * 254,
        width: 244,
        height: 244,
      },
      hittable: true,
      visibleToUser: true,
    })),
  ];
  const imagineA = observe(
    chrome({
      heading: "What should we imagine?",
      nav: "Chat",
      placeholder: "Type to imagine",
      tiles: ["Segmentation", "Photo Edit", "Reimagine"],
    }),
  );
  const imagineB = observe(
    chrome({
      heading: "What should we imagine?",
      nav: "Chat",
      placeholder: "Ask Grok anything",
      tiles: ["Icon Maker", "Smart Resize", "UGC Photos"],
    }),
  );
  const home = observe(
    chrome({
      heading: "What should we explore?",
      nav: "Imagine",
      placeholder: "Ask Grok anything",
      tiles: ["Try Skills", "Create Videos"],
    }),
  );
  const chat = (reply: string): SnapshotNode[] => [
    {
      role: "button",
      label: "New chat",
      rect: { x: 16, y: 12, width: 40, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "a",
      label: "Home page",
      rect: { x: 16, y: 64, width: 48, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "p",
      label: reply,
      rect: { x: 280, y: 180, width: 700, height: 80 },
      visibleToUser: true,
    },
    {
      role: "textbox",
      label: "Ask Grok anything",
      rect: { x: 270, y: 700, width: 740, height: 42 },
      hittable: true,
      visibleToUser: true,
    },
    {
      role: "button",
      label: "Submit",
      identifier: "chat-submit",
      rect: { x: 960, y: 750, width: 40, height: 40 },
      hittable: true,
      visibleToUser: true,
    },
  ];

  assert.equal(imagineA.fingerprint, imagineB.fingerprint);
  assert.equal(compareScreenIdentity(imagineA, imagineB).decision, "match");
  assert.notEqual(imagineA.fingerprint, home.fingerprint);
  assert.equal(
    observe(chat("hello from grok")).fingerprint,
    observe(chat("a longer, different reply")).fingerprint,
  );
  assert.ok(imagineA.nodes.some((node) => node.label === "<placeholder>"));
  assert.ok(!imagineA.nodes.some((node) => node.label === "segmentation"));
  assert.ok(
    !observe(chat("hello from grok")).nodes.some((node) => node.label === "hello from grok"),
  );
  assert.ok(imagineA.nodes.some((node) => node.label === "what should we imagine?"));
  assert.ok(home.nodes.some((node) => node.label === "what should we explore?"));
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

test("authored ignore regions keep reply-body copy out of screen identity", () => {
  const chrome = {
    role: "button",
    label: "Home",
    visibleToUser: true,
    rect: { x: 8, y: 8, width: 80, height: 32 },
  } satisfies SnapshotNode;
  const reply = (label: string): SnapshotNode => ({
    role: "text",
    label,
    visibleToUser: true,
    rect: { x: 80, y: 200, width: 900, height: 400 },
  });
  const ignore = { x: 80, y: 180, width: 900, height: 1400 };
  const withParis = observeScreenIdentity([chrome, reply("Paris is the capital")], {
    ignoreRegions: [ignore],
  });
  const withBerlin = observeScreenIdentity([chrome, reply("Berlin is the capital")], {
    ignoreRegions: [ignore],
  });
  assert.equal(withParis.fingerprint, withBerlin.fingerprint);
  assert.equal(
    withParis.nodes.some((node) => node.label?.includes("Paris")),
    false,
  );
  assert.notEqual(
    observeScreenIdentity([chrome, reply("Paris is the capital")]).fingerprint,
    observeScreenIdentity([chrome, reply("Berlin is the capital")]).fingerprint,
  );
});

test("unit ignore regions scale onto snapshot pixels so reply copy stays out of identity", () => {
  const chrome = {
    role: "button",
    label: "Home",
    visibleToUser: true,
    rect: { x: 8, y: 8, width: 80, height: 32 },
  } satisfies SnapshotNode;
  const reply = (label: string): SnapshotNode => ({
    role: "text",
    label,
    visibleToUser: true,
    rect: { x: 80, y: 200, width: 900, height: 400 },
  });
  const ignore = { name: "reply body", x: 0.08, y: 0.3, width: 0.92, height: 0.7 };
  const withParis = observeScreenIdentity([chrome, reply("Paris is the capital")], {
    ignoreRegions: [ignore],
  });
  const withBerlin = observeScreenIdentity([chrome, reply("Berlin is the capital")], {
    ignoreRegions: [ignore],
  });
  assert.equal(withParis.fingerprint, withBerlin.fingerprint);
  assert.equal(
    withParis.nodes.some((node) => node.label?.includes("Paris")),
    false,
  );
});

test("heads-up notification banners never re-key screen identity", () => {
  const base = [
    { role: "android.widget.TextView", label: "Settings", visibleToUser: true },
    { role: "android.widget.TextView", label: "SuperGrok", visibleToUser: true },
  ];
  const quiet = observeScreenIdentity(base as never);
  const withBanners = observeScreenIdentity([
    { role: "android.widget.TextView", label: "Photos notification:", visibleToUser: true },
    { role: "android.widget.TextView", label: "WhatsApp notification:", visibleToUser: true },
    { role: "android.widget.TextView", label: "Do not disturb turned on", visibleToUser: true },
    ...base,
  ] as never);
  assert.equal(withBanners.fingerprint, quiet.fingerprint);

  // Opting back in: device state differences count again.
  const previous = process.env.RELAY_IDENTITY_INCLUDE_DEVICE_STATE;
  process.env.RELAY_IDENTITY_INCLUDE_DEVICE_STATE = "1";
  try {
    const including = observeScreenIdentity([
      { role: "android.widget.TextView", label: "Photos notification:", visibleToUser: true },
      ...base,
    ] as never);
    assert.notEqual(including.fingerprint, quiet.fingerprint);
  } finally {
    if (previous === undefined) delete process.env.RELAY_IDENTITY_INCLUDE_DEVICE_STATE;
    else process.env.RELAY_IDENTITY_INCLUDE_DEVICE_STATE = previous;
  }

  // A real settings row named Notifications (no trailing colon) stays.
  const settingsRow = observeScreenIdentity([
    ...base,
    { role: "android.widget.TextView", label: "Notifications", visibleToUser: true },
  ] as never);
  assert.notEqual(settingsRow.fingerprint, quiet.fingerprint);
});

test("Japanese calendar dates retain the same volatile date identity as English dates", () => {
  const english = observeScreenIdentity([{ role: "text", label: "Aug 11 – Sep 8" }]);
  const japanese = observeScreenIdentity([{ role: "text", label: "8月11日~9月8日" }]);
  assert.equal(japanese.fingerprint, english.fingerprint);
  assert.ok(japanese.volatileSignals.some((signal) => signal.kind === "date"));
  assert.notEqual(
    observeScreenIdentity([{ role: "text", label: "Version 8.11" }]).fingerprint,
    japanese.fingerprint,
  );
});
