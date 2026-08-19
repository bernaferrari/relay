/**
 * Integration test for the one real explore crawl.
 *
 * The loop under test is production `runExploreJob`, reached through
 * `startDiscoveryExplore`. Only the device seam is faked, so the depth cap,
 * the back walk, and the left-app stop are the shipped ones — not a copy.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ObservedScreen, ObservedTransition } from "@relay/protocol";
import { createDiscoverySession, readDiscoverySession } from "./discovery.js";
import {
  loadDiscoveryExploreRun,
  resetDiscoveryExploreJobsForTests,
  setExploreRuntimeForTests,
  startDiscoveryExplore,
  waitDiscoveryExploreForTests,
  type ExploreRuntime,
} from "./discovery-explore-job.js";
import type { DiscoveryHere } from "./discovery-turn.js";

type FakeScreen = {
  id: string;
  /** Control label → screen the tap navigates to. */
  edges: Record<string, string>;
};

type FakeDeviceOptions = {
  screens: FakeScreen[];
  /** Screen whose first tap sends the device into another app. */
  leavesAppFrom?: string;
  originApp?: string;
  otherApp?: string;
};

/**
 * In-memory device: a screen graph plus a navigation stack for Back.
 * Records the tap and back sequence so a test can assert how far it descended.
 */
function fakeDevice(options: FakeDeviceOptions) {
  const byId = new Map(options.screens.map((screen) => [screen.id, screen]));
  const originApp = options.originApp ?? "com.example.app";
  const history: string[] = [];
  let current = options.screens[0]!.id;
  let foregroundApp = originApp;

  const taps: string[] = [];
  const backs: string[] = [];
  /** Deepest navigation-stack length the crawl reached. */
  let deepest = 0;

  const screenshot = (id: string): ObservedScreen => ({
    id: `screen-${id}`,
    title: id,
    fingerprint: `fp-${id}`,
    capturedAt: 1,
    controls: [],
  });

  const here = (): DiscoveryHere => {
    const screen = byId.get(current)!;
    return {
      screen: {
        id: `screen-${current}`,
        title: current,
        fingerprint: `fp-${current}`,
        capturedAt: 1,
        controlCount: Object.keys(screen.edges).length,
      },
      options: Object.keys(screen.edges).map((label) => ({
        id: `control-${current}-${label}`,
        label,
        target: { label },
        opened: false,
      })),
      suggestion: null,
      foregroundApp,
      canBack: history.length > 0,
    };
  };

  const runtime: Partial<ExploreRuntime> = {
    here: async () => here(),
    act: async (input) => {
      const before = current;
      if (input.interaction?.kind === "key" && input.interaction.key === "back") {
        backs.push(before);
        current = history.pop() ?? current;
      } else {
        const label = input.controlId?.replace(`control-${before}-`, "");
        const target = label ? byId.get(before)?.edges[label] : undefined;
        taps.push(`${before}>${label ?? "?"}`);
        if (target) {
          history.push(before);
          deepest = Math.max(deepest, history.length);
          current = target;
        }
        if (options.leavesAppFrom === before) {
          foregroundApp = options.otherApp ?? "com.other.app";
        }
      }
      const transition = {
        id: `t-${taps.length + backs.length}`,
      } as unknown as ObservedTransition;
      return {
        transition,
        changedIdentity: current !== before,
        changed: current !== before,
        before: screenshot(before),
        after: screenshot(current),
        here: here(),
      };
    },
    foreground: async () => foregroundApp,
    returnToApp: async () => {
      // A device that refuses to come back is exactly the left-app case.
      if (options.leavesAppFrom === undefined) foregroundApp = originApp;
    },
  };

  return {
    runtime,
    taps,
    backs,
    originApp,
    get deepest() {
      return deepest;
    },
  };
}

async function withWorkspace<T>(prefix: string, body: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetDiscoveryExploreJobsForTests();
  try {
    return await body();
  } finally {
    resetDiscoveryExploreJobsForTests();
    setExploreRuntimeForTests(undefined);
    if (previous === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function session(id: string) {
  return createDiscoverySession({
    id,
    name: id,
    targetId: "fake-serial",
    agent: {
      workerId: "w1",
      appMapId: "map-1",
      goal: "Explore integration",
      provider: "relay",
      source: "cli",
    },
  });
}

test("explore stops descending at maxDepth and walks back out", async () => {
  await withWorkspace("relay-explore-depth-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "home", edges: { Settings: "settings" } },
        { id: "settings", edges: { Appearance: "appearance" } },
        { id: "appearance", edges: { Theme: "theme" } },
        { id: "theme", edges: {} },
      ],
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-depth");
    await startDiscoveryExplore(created.id, { strategy: "surface", maxDepth: 1 });
    await waitDiscoveryExploreForTests(created.id);

    // maxDepth 1 allows one push past the seed; the next hop must back out.
    assert.equal(device.deepest, 2);
    assert.deepEqual(device.taps, ["home>Settings", "settings>Appearance"]);
    // Back out of appearance, then back out of settings once its rows are done.
    assert.deepEqual(device.backs, ["appearance", "settings"]);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.maxDepth, 1);
    assert.equal(run?.stopReason?.code, "complete");
    assert.equal((await readDiscoverySession(created.id))?.status, "complete");
  });
});

test("raising maxDepth lets the same graph be explored one level deeper", async () => {
  await withWorkspace("relay-explore-depth2-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "home", edges: { Settings: "settings" } },
        { id: "settings", edges: { Appearance: "appearance" } },
        { id: "appearance", edges: { Theme: "theme" } },
        { id: "theme", edges: {} },
      ],
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-depth-2");
    await startDiscoveryExplore(created.id, { strategy: "surface", maxDepth: 2 });
    await waitDiscoveryExploreForTests(created.id);

    assert.equal(device.deepest, 3);
    assert.deepEqual(device.taps, ["home>Settings", "settings>Appearance", "appearance>Theme"]);
  });
});

test("explore stops with left_app when the device will not come back", async () => {
  await withWorkspace("relay-explore-left-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "home", edges: { Update: "store" } },
        { id: "store", edges: {} },
      ],
      leavesAppFrom: "home",
      originApp: "com.example.app",
      otherApp: "com.android.vending",
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-left");
    await startDiscoveryExplore(created.id, { strategy: "surface", maxDepth: 3 });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "left_app");
    assert.match(run?.stopReason?.message ?? "", /com\.example\.app/);
    // One soft recover attempt was spent and it did not land back in the app.
    assert.equal(run?.softRecoveries, 0);
    assert.equal((await readDiscoverySession(created.id))?.status, "stopped");
  });
});

test("explore finishes cleanly when the seed screen has nothing to open", async () => {
  await withWorkspace("relay-explore-empty-", async () => {
    const device = fakeDevice({ screens: [{ id: "home", edges: {} }] });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-empty");
    await startDiscoveryExplore(created.id, { strategy: "surface" });
    await waitDiscoveryExploreForTests(created.id);

    assert.deepEqual(device.taps, []);
    assert.deepEqual(device.backs, []);
    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "complete");
  });
});
