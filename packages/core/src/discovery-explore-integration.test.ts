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
import type { ObservedScreen, ObservedTransition, StateFixture } from "@relay/protocol";
import {
  createDiscoverySession,
  readDiscoverySession,
  setDiscoveryStatus,
  writeDiscoveryExploreRun,
} from "./discovery.js";
import {
  loadDiscoveryExploreRun,
  resetDiscoveryExploreJobsForTests,
  setExploreRuntimeForTests,
  startDiscoveryExplore,
  waitDiscoveryExploreForTests,
  type ExploreRuntime,
} from "./discovery-explore-job.js";
import type { DiscoveryHere } from "./discovery-turn.js";
import { GroundingError } from "./grounding.js";

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
  /** Adversarial device behavior: Back lands somewhere other than its reviewed parent. */
  backLandsOn?: string;
  /** Back commits after its command response, as native navigation often does. */
  delayedBack?: boolean;
  /** Controls that cannot be uniquely grounded must become durable Problems. */
  groundingFailsFor?: string;
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
  let pendingBack: string | undefined;

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
    here: async () => {
      if (pendingBack) {
        current = pendingBack;
        pendingBack = undefined;
      }
      return here();
    },
    act: async (input) => {
      const before = current;
      if (input.interaction?.kind === "key" && input.interaction.key === "back") {
        backs.push(before);
        const destination = options.backLandsOn ?? history.pop() ?? current;
        if (options.delayedBack) pendingBack = destination;
        else current = destination;
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
    ground: async ({ target }) => {
      const label = typeof target === "string" ? target : "structured target";
      if (label === options.groundingFailsFor) {
        throw new GroundingError(`${label} matched two controls`);
      }
      return { interaction: { kind: "label", label }, method: "a11y", confidence: 1 };
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

function reviewedAppFixture(): StateFixture {
  return {
    schemaVersion: 1,
    id: "fixture.explore-app",
    name: "Explore disposable app state",
    review: {
      revision: 1,
      reviewedBy: "human:reviewer",
      reviewedAt: 1,
      reason: "The fixture restores the disposable app state after exploration.",
    },
    resetScope: ["app"],
    secrets: [],
    phases: {
      prepare: {
        maxDurationMs: 10_000,
        steps: [{ id: "prepare-app", scope: "app", operation: "reset", timeoutMs: 1_000 }],
      },
      verify: {
        maxDurationMs: 10_000,
        steps: [{ id: "verify-app", scope: "app", operation: "verify", timeoutMs: 1_000 }],
      },
      cleanup: {
        maxDurationMs: 10_000,
        steps: [
          { id: "restore-app", scope: "app", operation: "restore", timeoutMs: 1_000 },
          { id: "prove-app", scope: "app", operation: "prove-cleanup", timeoutMs: 1_000 },
        ],
      },
    },
    reversibility: {
      status: "reviewed-reversible",
      restoresScopes: ["app"],
      cleanupProofRequired: true,
    },
  };
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
    assert.equal(run?.navigationCursor?.status, "proven");
    if (run?.navigationCursor?.status === "proven") {
      assert.equal(run.navigationCursor.screenId, "screen-home");
    }
    assert.equal((await readDiscoverySession(created.id))?.status, "complete");
  });
});

test("explore waits for a native Back destination before declaring drift", async () => {
  await withWorkspace("relay-explore-delayed-back-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "settings", edges: { Appearance: "appearance" } },
        { id: "appearance", edges: {} },
      ],
      delayedBack: true,
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-delayed-back");
    await startDiscoveryExplore(created.id, { strategy: "surface", maxDepth: 1 });
    await waitDiscoveryExploreForTests(created.id);

    assert.equal((await readDiscoverySession(created.id))?.status, "complete");
    assert.equal((await loadDiscoveryExploreRun(created.id))?.stopReason?.code, "complete");
    assert.deepEqual(device.backs, ["appearance"]);
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
    // The handoff is preserved as truth; Explore never silently reopens the app.
    assert.equal(run?.navigationCursor?.status, "external-handoff");
    if (run?.navigationCursor?.status === "external-handoff") {
      assert.equal(run.navigationCursor.foregroundApp, "com.android.vending");
      assert.equal(run.navigationCursor.previous?.screenId, "screen-home");
    }
    assert.equal((await readDiscoverySession(created.id))?.status, "stopped");
  });
});

test("a surprising Back result invalidates proof instead of popping the imagined stack", async () => {
  await withWorkspace("relay-explore-back-drift-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "home", edges: { Settings: "settings" } },
        { id: "settings", edges: {} },
        { id: "rogue", edges: { Dangerous: "home" } },
      ],
      backLandsOn: "rogue",
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-back-drift");
    await startDiscoveryExplore(created.id, { strategy: "surface", maxDepth: 2 });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "error");
    assert.match(run?.stopReason?.message ?? "", /expected screen-home/);
    assert.equal(run?.navigationCursor?.status, "proven");
    if (run?.navigationCursor?.status === "proven") {
      assert.equal(run.navigationCursor.screenId, "screen-rogue");
    }
    assert.deepEqual(device.taps, ["home>Settings"]);
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

test("explore reports an ungrounded row as a durable Problem instead of complete", async () => {
  await withWorkspace("relay-explore-problem-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "home", edges: { Menu: "settings", Profile: "profile" } },
        { id: "profile", edges: {} },
      ],
      groundingFailsFor: "Menu",
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-problem");
    await startDiscoveryExplore(created.id, { strategy: "surface" });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "error");
    assert.match(run?.stopReason?.message ?? "", /1 unresolved problem/);
    assert.deepEqual(
      run?.problems?.map(({ screenId, label, reason }) => ({ screenId, label, reason })),
      [{ screenId: "screen-home", label: "Menu", reason: "Menu matched two controls" }],
    );
    assert.deepEqual(device.taps, ["home>Profile"]);
    assert.equal((await readDiscoverySession(created.id))?.status, "stopped");
  });
});

test("explore never dispatches a destructive control", async () => {
  await withWorkspace("relay-explore-risk-", async () => {
    const device = fakeDevice({
      screens: [{ id: "home", edges: { "Delete-account": "deleted" } }],
    });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-risk");
    await startDiscoveryExplore(created.id, { strategy: "surface" });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "error");
    assert.match(run?.stopReason?.message ?? "", /1 unresolved problem/);
    assert.deepEqual(device.taps, []);
    assert.equal(run?.problems?.[0]?.controlId, "control-home-Delete-account");
  });
});

test("explore bounds a same-screen feed instead of looping forever", async () => {
  await withWorkspace("relay-explore-feed-", async () => {
    let row = 0;
    const here = async (): Promise<DiscoveryHere> => ({
      screen: {
        id: "screen-feed",
        title: "Feed",
        fingerprint: "fp-feed",
        capturedAt: 1,
        controlCount: 1,
      },
      options: [
        {
          id: `feed-row-${row}`,
          label: `Row ${row}`,
          target: { label: `Row ${row}` },
          opened: false,
        },
      ],
      suggestion: null,
      foregroundApp: "com.example.app",
      canBack: false,
    });
    const runtime: Partial<ExploreRuntime> = {
      here,
      foreground: async () => "com.example.app",
      ground: async ({ target }) => ({
        interaction: { kind: "label", label: String(target) },
        method: "a11y",
        confidence: 1,
      }),
      act: async () => {
        row += 1;
        return {
          transition: { id: `feed-transition-${row}` } as unknown as ObservedTransition,
          changedIdentity: false,
          changed: false,
          before: {
            id: "screen-feed",
            title: "Feed",
            fingerprint: "fp-feed",
            capturedAt: 1,
          },
          after: {
            id: "screen-feed",
            title: "Feed",
            fingerprint: "fp-feed",
            capturedAt: 1,
          },
          here: await here(),
        };
      },
    };
    setExploreRuntimeForTests(runtime);

    const created = await session("explore-feed");
    await startDiscoveryExplore(created.id, { strategy: "timeline" });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(row, 40);
    assert.equal(run?.stopReason?.code, "budget");
    assert.match(run?.stopReason?.message ?? "", /possible infinite feed/);
  });
});

test("explore persists an in-flight action and refuses to redispatch after restart", async () => {
  await withWorkspace("relay-explore-in-flight-", async () => {
    const device = fakeDevice({
      screens: [
        { id: "home", edges: { Settings: "settings" } },
        { id: "settings", edges: {} },
      ],
    });
    let dispatchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatchStarted = resolve;
    });
    setExploreRuntimeForTests({
      ...device.runtime,
      act: async () => {
        dispatchStarted();
        return new Promise(() => undefined);
      },
    });

    const created = await session("explore-in-flight");
    await startDiscoveryExplore(created.id, { strategy: "surface" });
    await started;
    const persisted = await loadDiscoveryExploreRun(created.id);
    assert.deepEqual(persisted?.cursor?.inFlight, {
      screenId: "screen-home",
      controlId: "control-home-Settings",
    });

    // Simulate a process restart while the native command is unresolved. The
    // persisted inFlight marker is a terminal review boundary, not a retry.
    resetDiscoveryExploreJobsForTests();
    await assert.rejects(
      () => startDiscoveryExplore(created.id),
      /interrupted action control-home-Settings/,
    );
  });
});

test("explore resumes a paused durable frontier without rebuilding it", async () => {
  await withWorkspace("relay-explore-paused-resume-", async () => {
    const device = fakeDevice({ screens: [{ id: "home", edges: {} }] });
    setExploreRuntimeForTests(device.runtime);

    const created = await session("explore-paused-resume");
    const now = Date.now();
    await writeDiscoveryExploreRun(created.id, {
      strategy: "surface",
      maxDepth: 2,
      navigationCursor: {
        schemaVersion: 1,
        status: "proven",
        screenId: "screen-home",
        proofToken: "discovery:fp-home",
        source: "screen-observation",
        updatedAt: now,
      },
      cursor: {
        schemaVersion: 1,
        stack: [{ screenId: "screen-home", pendingControlIds: [] }],
        exploredEdgeKeys: ["screen-home:already-proved"],
        sameScreenActions: {},
      },
      startedAt: now,
      updatedAt: now,
    });
    await setDiscoveryStatus(created.id, "running");
    await setDiscoveryStatus(created.id, "paused");
    resetDiscoveryExploreJobsForTests();
    setExploreRuntimeForTests(device.runtime);

    await startDiscoveryExplore(created.id);
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "complete");
    assert.ok(run?.cursor?.exploredEdgeKeys.includes("screen-home:already-proved"));
    assert.deepEqual(device.taps, []);
  });
});

test("explore cleans a prepared fixture and resumes after a process restart", async () => {
  await withWorkspace("relay-explore-fixture-resume-", async () => {
    const device = fakeDevice({ screens: [{ id: "home", edges: {} }] });
    const fixture = reviewedAppFixture();
    const calls: string[] = [];
    let firstPrepareStarted!: () => void;
    const prepareStarted = new Promise<void>((resolve) => {
      firstPrepareStarted = resolve;
    });
    let releaseFirstPrepare!: () => void;
    const firstPrepareRelease = new Promise<void>((resolve) => {
      releaseFirstPrepare = resolve;
    });
    let prepareCount = 0;
    const adapter = {
      prepare: async () => {
        prepareCount += 1;
        calls.push(`prepare-${prepareCount}`);
        if (prepareCount === 1) {
          firstPrepareStarted();
          await firstPrepareRelease;
        }
      },
      verify: async () => {
        calls.push("verify");
      },
      cleanup: async () => {
        calls.push("cleanup");
      },
    };
    setExploreRuntimeForTests({ ...device.runtime, fixture: adapter });

    const created = await session("explore-fixture-resume");
    await startDiscoveryExplore(created.id, { fixture });
    await prepareStarted;
    assert.equal((await loadDiscoveryExploreRun(created.id))?.fixture?.phase, "preparing");

    // The original process disappeared after dispatching prepare. A new
    // process must restore first, then prepare and verify the exact fixture.
    resetDiscoveryExploreJobsForTests();
    setExploreRuntimeForTests({ ...device.runtime, fixture: adapter });
    await startDiscoveryExplore(created.id, { fixture });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.deepEqual(calls, ["prepare-1", "cleanup", "prepare-2", "verify", "cleanup"]);
    assert.equal(run?.fixture?.phase, "cleaned");
    assert.equal(run?.stopReason?.code, "complete");
    assert.equal((await readDiscoverySession(created.id))?.status, "complete");

    // Leave the interrupted first adapter call unresolved: that is the test's
    // simulated dead process, and releasing it would let it race the resumed
    // crawl. It has no event-loop handle and is intentionally not reused.
    void releaseFirstPrepare;
  });
});

test("explore remains review-required when fixture cleanup cannot be proved", async () => {
  await withWorkspace("relay-explore-fixture-cleanup-", async () => {
    const device = fakeDevice({ screens: [{ id: "home", edges: {} }] });
    const fixture = reviewedAppFixture();
    setExploreRuntimeForTests({
      ...device.runtime,
      fixture: {
        prepare: async () => undefined,
        verify: async () => undefined,
        cleanup: async () => {
          throw new Error("target stopped responding during restore");
        },
      },
    });

    const created = await session("explore-fixture-cleanup");
    await startDiscoveryExplore(created.id, { fixture });
    await waitDiscoveryExploreForTests(created.id);

    const run = await loadDiscoveryExploreRun(created.id);
    assert.equal(run?.stopReason?.code, "error");
    assert.match(run?.stopReason?.message ?? "", /cleanup failed/);
    assert.equal(run?.fixture?.phase, "cleanup-pending");
    assert.equal((await readDiscoverySession(created.id))?.status, "stopped");
  });
});
