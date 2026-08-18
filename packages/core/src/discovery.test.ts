import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDiscoverySession,
  discoveryControls,
  formatDiscoveryExport,
  listDiscoverySessions,
  promoteDiscoveryPath,
  readDiscoverySession,
  readDiscoveryScreenAsset,
  recordObservedScreen,
  recordObservedTransition,
  setDiscoveryStatus,
  suggestDiscoveryControl,
} from "./discovery.js";
import {
  resetDiscoveryExploreJobsForTests,
  startDiscoveryExplore,
} from "./discovery-explore-job.js";

test("discovery keeps a bounded, evidence-backed screen graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  const previousTests = process.env.RELAY_TESTS_DIR;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  try {
    const screenshot = join(root, "welcome.png");
    await writeFile(screenshot, "image evidence");
    const session = await createDiscoverySession({
      id: "map",
      name: "Sign-in map",
      targetId: "browser-chat",
      agent: {
        workerId: "worker-1",
        appMapId: "store",
        goal: "Map sign in",
        provider: "openrouter",
        model: "test/model",
        source: "mcp",
      },
      scope: { maxScreens: 2, maxTransitions: 2, maxDurationMs: 60_000 },
    });
    await setDiscoveryStatus(session.id, "running");
    const first = await recordObservedScreen({
      sessionId: session.id,
      title: "Welcome",
      nodes: [{ role: "button", label: "Continue", visibleToUser: true }],
      screenshotPath: screenshot,
    });
    const duplicate = await recordObservedScreen({
      sessionId: session.id,
      title: "Welcome again",
      nodes: [{ role: "button", label: "Continue", visibleToUser: true }],
    });
    assert.equal(duplicate.isNew, false);
    assert.equal(
      (await readDiscoveryScreenAsset(session.id, first.screen.id))?.toString(),
      "image evidence",
    );
    const second = await recordObservedScreen({
      sessionId: session.id,
      title: "Sign in",
      nodes: [{ role: "textbox", label: "Email", visibleToUser: true }],
    });
    const transition = await recordObservedTransition({
      sessionId: session.id,
      fromScreenId: first.screen.id,
      toScreenId: second.screen.id,
      kind: "tap",
      label: "Continue",
      target: { label: "Continue" },
      decision: {
        mode: "model",
        provider: "openrouter",
        model: "test/model",
        selectedControlId: "continue",
        requestId: "request-1",
        promptDigest: "a".repeat(64),
        durationMs: 42,
      },
      changedScreen: true,
    });
    await assert.rejects(
      promoteDiscoveryPath({
        sessionId: session.id,
        transitionIds: [transition.id],
        recipeId: "discovered-sign-in",
        title: "Discovered sign in",
      }),
      /App Map/,
    );
    assert.equal(
      (await readDiscoverySession(session.id))?.transitions[0]?.label,
      "Continue",
      "review labels must not mutate raw discovery evidence",
    );
    assert.equal((await readDiscoverySession(session.id))?.agent?.model, "test/model");
    assert.equal(
      (await readDiscoverySession(session.id))?.transitions[0]?.decision?.requestId,
      "request-1",
    );
    const finished = await setDiscoveryStatus(session.id, "complete");
    assert.match(formatDiscoveryExport(finished, "markdown"), /Welcome → Sign in: tap “Continue”/);
    await assert.rejects(
      setDiscoveryStatus(session.id, "running"),
      /cannot move from complete to running/,
    );
    await assert.rejects(
      recordObservedTransition({
        sessionId: session.id,
        fromScreenId: first.screen.id,
        kind: "tap",
        label: "Delete account",
        changedScreen: false,
      }),
      /complete/,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    if (previousTests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previousTests;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery blocks sensitive actions before an interaction is recorded", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-policy-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const session = await createDiscoverySession({
      id: "policy",
      name: "Policy",
      targetId: "phone",
    });
    const screen = await recordObservedScreen({ sessionId: session.id, nodes: [] });
    await assert.rejects(
      recordObservedTransition({
        sessionId: session.id,
        fromScreenId: screen.screen.id,
        kind: "tap",
        label: "Purchase now",
        changedScreen: false,
      }),
      /blocks sensitive controls/,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery rejects malformed agent and model provenance at the shared core boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-provenance-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await assert.rejects(
      createDiscoverySession({
        id: "bad-agent",
        name: "Bad agent",
        targetId: "phone",
        agent: {
          workerId: "worker",
          appMapId: "map",
          goal: "Explore",
          provider: "openrouter",
          source: "socket" as "mcp",
        },
      }),
      /source is invalid/,
    );
    const session = await createDiscoverySession({
      id: "bad-decision",
      name: "Bad decision",
      targetId: "phone",
    });
    const screen = await recordObservedScreen({ sessionId: session.id, nodes: [] });
    await assert.rejects(
      recordObservedTransition({
        sessionId: session.id,
        fromScreenId: screen.screen.id,
        kind: "tap",
        changedScreen: false,
        decision: {
          mode: "model",
          provider: "openrouter",
          model: "test/model",
          selectedControlId: "continue",
          promptDigest: "not-a-digest",
        },
      }),
      /prompt digest is invalid/,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery suggests only safe unexplored semantic controls", async () => {
  const controls = discoveryControls([
    { role: "button", label: "Continue", ref: "@continue", visibleToUser: true, hittable: true },
    {
      role: "button",
      label: "Delete account",
      ref: "@delete",
      visibleToUser: true,
      hittable: true,
    },
  ]);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Continue"],
  );
  const session = {
    id: "map",
    name: "Map",
    targetId: "phone",
    scope: {
      maxScreens: 5,
      maxTransitions: 5,
      maxDurationMs: 60_000,
      allowSensitiveControls: false,
    },
    status: "running" as const,
    currentScreenId: "screen-a",
    createdAt: 1,
    updatedAt: 1,
    screens: [{ id: "screen-a", fingerprint: "a", capturedAt: 1, controls }],
    transitions: [],
  };
  assert.equal(suggestDiscoveryControl(session)?.control.label, "Continue");

  const secondScreen = {
    id: "screen-b",
    fingerprint: "b",
    capturedAt: 2,
    controls,
  };
  const branched = {
    ...session,
    currentScreenId: "screen-b",
    screens: [...session.screens, secondScreen],
    transitions: [
      {
        id: "transition-a",
        fromScreenId: "screen-a",
        toScreenId: "screen-b",
        kind: "tap" as const,
        label: "Continue",
        target: { ref: "@continue" },
        changedScreen: true,
        capturedAt: 2,
      },
    ],
  };
  // A semantic locator is consumed within its source screen, not globally: a
  // different screen may legitimately expose its own “Continue” control.
  assert.equal(suggestDiscoveryControl(branched)?.screenId, "screen-b");

  const currentFirst = {
    ...branched,
    currentScreenId: "screen-a",
    screens: [
      {
        ...branched.screens[0]!,
        controls: [...controls, { ...controls[0]!, label: "Help", target: { ref: "@help" } }],
      },
      branched.screens[1]!,
    ],
  };
  assert.equal(suggestDiscoveryControl(currentFirst)?.screenId, "screen-a");
});

test("discovery prioritizes semantic navigation rows and skips toggles", () => {
  const controls = discoveryControls([
    { role: "switch", label: "Use dark mode", visibleToUser: true, hittable: true },
    { role: "button", label: "Help", visibleToUser: true, hittable: true },
    {
      type: "android.widget.LinearLayout",
      role: "listitem",
      label: "Appearance",
      identifier: "settings-appearance",
      visibleToUser: true,
      hittable: true,
    },
    { role: "button", label: "Advanced", visibleToUser: true, hittable: true },
  ]);

  assert.deepEqual(
    controls.map((control) => control.label),
    ["Appearance", "Advanced", "Help"],
  );
  assert.deepEqual(controls[0]?.target, { identifier: "settings-appearance" });
});

test("discovery walks a settings list top to bottom", () => {
  const controls = discoveryControls([
    {
      label: "Connections",
      rect: { x: 0, y: 400, width: 100, height: 40 },
      visibleToUser: true,
      hittable: true,
    },
    {
      label: "Notifications",
      rect: { x: 0, y: 200, width: 100, height: 40 },
      visibleToUser: true,
      hittable: true,
    },
  ]);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Notifications", "Connections"],
  );
});

test("discovery skips Android system chrome instead of tapping Home", () => {
  const controls = discoveryControls([
    {
      label: "Home",
      identifier: "com.android.systemui:id/home",
      bundleId: "com.android.systemui",
      visibleToUser: true,
      hittable: true,
    },
    {
      label: "Back",
      identifier: "com.android.systemui:id/back",
      bundleId: "com.android.systemui",
      visibleToUser: true,
      hittable: true,
    },
    {
      role: "listitem",
      label: "Notifications",
      identifier: "settings-notifications",
      visibleToUser: true,
      hittable: true,
    },
  ]);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Notifications"],
  );
});

test("discovery skips Settings search chrome and the collapsing title", () => {
  const controls = discoveryControls([
    {
      label: "Settings",
      identifier: "com.android.settings:id/collapsing_appbar_extended_title",
      visibleToUser: true,
      hittable: true,
    },
    {
      label: "Voice search",
      identifier: "com.android.settings:id/search_voice_btn",
      visibleToUser: true,
      hittable: true,
    },
    {
      label: "Connections",
      identifier: "android:id/title",
      visibleToUser: true,
      hittable: false,
    },
  ]);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Connections"],
  );
});

test("discovery taps Settings row labels instead of recycler chrome", () => {
  const controls = discoveryControls([
    {
      identifier: "com.android.settings:id/recycler_view",
      type: "androidx.recyclerview.widget.RecyclerView",
      visibleToUser: true,
      hittable: true,
    },
    {
      label: "Connections",
      identifier: "android:id/title",
      ref: "e40",
      type: "android.widget.TextView",
      visibleToUser: true,
      hittable: false,
    },
    {
      label: "Home",
      identifier: "com.android.systemui:id/home",
      bundleId: "com.android.systemui",
      visibleToUser: true,
      hittable: true,
    },
  ]);
  assert.deepEqual(
    controls.map((control) => control.label),
    ["Connections"],
  );
  assert.deepEqual(controls[0]?.target, { label: "Connections" });
});

test("discovery tracks the screen currently visible on the target", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-current-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const session = await createDiscoverySession({
      id: "current",
      name: "Current screen",
      targetId: "phone",
    });
    await setDiscoveryStatus(session.id, "running");
    const first = await recordObservedScreen({
      sessionId: session.id,
      nodes: [{ role: "button", label: "Continue", visibleToUser: true }],
      makeCurrent: true,
    });
    assert.equal((await readDiscoverySession(session.id))?.currentScreenId, first.screen.id);
    const second = await recordObservedScreen({
      sessionId: session.id,
      nodes: [{ role: "button", label: "Done", visibleToUser: true }],
      makeCurrent: true,
    });
    assert.equal((await readDiscoverySession(session.id))?.currentScreenId, second.screen.id);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery screen assets reject traversal session ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-asset-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const outside = join(root, "outside.png");
    await writeFile(outside, "not-a-discovery-asset");
    assert.equal(await readDiscoveryScreenAsset("../etc", "screen-1"), null);
    assert.equal(await readDiscoveryScreenAsset("foo/bar", "screen-1"), null);
    assert.equal(await readDiscoveryScreenAsset("..", "screen-1"), null);
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery sessions are isolated by project", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-scope-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const alpha = await createDiscoverySession({
      id: "alpha-map",
      name: "Alpha",
      targetId: "device-a",
      projectId: "alpha",
    });
    await createDiscoverySession({
      id: "beta-map",
      name: "Beta",
      targetId: "device-b",
      projectId: "beta",
    });
    assert.equal(alpha.projectId, "alpha");
    const listed = await listDiscoverySessions({ projectId: "alpha" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "alpha-map");
    assert.equal(await readDiscoverySession("beta-map", { projectId: "alpha" }), null);
    assert.equal((await readDiscoverySession("beta-map", { projectId: "beta" }))?.name, "Beta");
  } finally {
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery explore refuses to start without an App Map", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-discovery-explore-"));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetDiscoveryExploreJobsForTests();
  try {
    const session = await createDiscoverySession({
      id: "no-map",
      name: "No map",
      targetId: "phone",
    });
    await assert.rejects(
      () => startDiscoveryExplore(session.id),
      /App Map to register screens/,
    );
  } finally {
    resetDiscoveryExploreJobsForTests();
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
