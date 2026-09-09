import assert from "node:assert/strict";
import test from "node:test";
import type { Device, SnapshotNode } from "./device.js";
import { createAndroidResourceStringIndex } from "./android-resource-strings.js";
import { getRecipeAndroidLocalization } from "./recipe-localization.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import { tapRecordedTarget } from "./recipe-runner-support.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { createSessionJob } from "./session-job-factory.js";
import { runWithTargetContext } from "./target-context.js";

const pkg = "com.example.preferences";
const translations = createAndroidResourceStringIndex(
  [
    'resource 0x1 string/title\n  () "Settings"\n  (ja) "設定"',
    'resource 0x2 string/network\n  () "Network"\n  (ja) "ネットワーク"',
    'resource 0x3 string/connect\n  () "Connect"\n  (ja) "接続"',
  ].join("\n"),
  { targetLocale: "ja" },
);

function screen(title: string, row: string): SnapshotNode[] {
  return [
    { index: 0, type: "View", identifier: `${pkg}:id/root`, bundleId: pkg },
    { index: 1, type: "Text", identifier: `${pkg}:id/title`, label: title, bundleId: pkg },
    {
      index: 2,
      type: "Button",
      identifier: `${pkg}:id/preference`,
      label: row,
      bundleId: pkg,
      hittable: true,
      rect: { x: 20, y: 200, width: 300, height: 60 },
    },
  ];
}

function setup(screens: SnapshotNode[][]) {
  let reads = 0;
  const presses: unknown[] = [];
  const logs: string[] = [];
  const job = createSessionJob(
    { recipe: "localized-guards", serial: "offline-localized-guards", platform: "android" },
    { findJob: () => undefined, toTransport: (value) => value },
  );
  const ctx: RecipeStepContext = {
    job,
    runtime: {},
    log: (line) => logs.push(line),
    observeVisualFingerprint: async () => undefined,
  };
  const device = {
    capture: { snapshot: async () => ({ nodes: screens[Math.min(reads++, screens.length - 1)] }) },
    command: { wait: async () => ({}) },
    interactions: {
      press: async (input: unknown) => {
        presses.push(input);
        return {};
      },
    },
  } as unknown as Device;
  const within = <T>(run: () => Promise<T>) =>
    runWithTargetContext({ kind: "device", platform: "android", serial: job.serial! }, run);
  const localization = () =>
    getRecipeAndroidLocalization(ctx, screens[0]!, {
      load: async () => ({ index: translations, currentAppLocale: "ja" }),
    });
  return { ctx, device, presses, logs, within, localization };
}

test("in-app destination without expectedApp records Japanese proof, not translated evidence", async () => {
  const live = screen("設定", "ネットワーク");
  const harness = setup([live]);
  const expected = observeScreenIdentity(screen("Settings", "Network"));
  await harness.within(async () => {
    const localization = await harness.localization();
    await runExpectScreenStep(
      harness.device,
      {
        id: "relay-source-settings",
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: expected.fingerprint,
        observations: [expected],
        timeoutMs: 0,
      },
      harness.ctx,
      { getLocalization: async () => localization },
    );
  });
  assert.ok(harness.logs.some((line) => line.includes("using ja app resources")));
  assert.deepEqual(harness.ctx.runtime?.observation?.nodes, live);
  assert.equal(harness.ctx.runtime?.navigationCursor?.status, "proven");
});

test("localized destination rejects a different preference page with the same reusable shell", async () => {
  const harness = setup([screen("設定", "通知")]);
  const expected = observeScreenIdentity(screen("Settings", "Network"));
  await harness.within(async () => {
    const localization = await harness.localization();
    await assert.rejects(
      runExpectScreenStep(
        harness.device,
        {
          id: "relay-source-settings",
          kind: "expect-screen",
          screenId: "network",
          screenTitle: "Settings",
          fingerprint: expected.fingerprint,
          observations: [expected],
          timeoutMs: 0,
        },
        harness.ctx,
        { getLocalization: async () => localization },
      ),
      /expect-screen:/,
    );
  });
  assert.equal(harness.ctx.runtime?.navigationCursor?.status, "unknown");
});

test("actual recorded tap emits the translated selector and retains the authored target", async () => {
  const harness = setup([screen("設定", "接続")]);
  const target = { label: "Connect", point: { x: 4, y: 4 } };
  await harness.within(async () => {
    await harness.localization();
    await tapRecordedTarget(harness.device, { target }, harness.ctx);
  });
  assert.equal(harness.presses.length, 1);
  assert.match(JSON.stringify(harness.presses[0]), /接続/);
  const artifact = harness.ctx.job!.artifacts.find((item) => item.kind === "target-resolution");
  const data = artifact?.data;
  assert.ok(
    data &&
      typeof data === "object" &&
      "target" in data &&
      "localizedTarget" in data &&
      "point" in data,
  );
  assert.deepEqual(data.target, target);
  assert.deepEqual(data.localizedTarget, { label: "接続", locale: "ja" });
  assert.deepEqual(data.point, { x: 170, y: 230 });
});

test("localized tap retries cannot activate another application's matching control", async () => {
  const initial = screen("設定", "接続");
  initial.push({ ...initial[2]!, index: 3, rect: { x: 20, y: 400, width: 300, height: 60 } });
  const otherApp = screen("別のアプリ", "接続").map((node) => ({
    ...node,
    bundleId: "com.example.other",
    identifier: node.identifier?.replace(pkg, "com.example.other"),
  }));
  const harness = setup([initial, otherApp]);
  await harness.within(async () => {
    await harness.localization();
    await assert.rejects(
      tapRecordedTarget(harness.device, { target: { label: "Connect" } }, harness.ctx),
    );
  });
  assert.equal(harness.presses.length, 0);
});

test("concurrent screen and target localization share one resource load within a run", async () => {
  const nodes = screen("設定", "ネットワーク");
  const harness = setup([nodes]);
  let loads = 0;
  const load = async () => {
    loads += 1;
    await Promise.resolve();
    return { index: translations, currentAppLocale: "ja" };
  };
  const resolved = await harness.within(() =>
    Promise.all(
      Array.from({ length: 12 }, () => getRecipeAndroidLocalization(harness.ctx, nodes, { load })),
    ),
  );
  assert.equal(loads, 1);
  assert.ok(resolved.every((localization) => localization === resolved[0]));
  assert.equal(resolved[0]?.translate("NETWORK"), "ネットワーク");
  const nextRun = setup([nodes]);
  await nextRun.within(() => getRecipeAndroidLocalization(nextRun.ctx, nodes, { load }));
  assert.equal(loads, 2, "separate runs must re-read the installed app and its current locale");
});

test("normalized lookups build the large source catalogue once per loaded index", async () => {
  const nodes = screen("設定", "ネットワーク");
  const harness = setup([nodes]);
  let catalogueReads = 0;
  const index = {
    lookup: translations.lookup,
    values: translations.values,
    get sources() {
      catalogueReads += 1;
      return [
        ...Array.from({ length: 10_000 }, (_, index) => `Unrelated caption ${index}`),
        ...translations.sources,
      ];
    },
  };
  const localization = await harness.within(() =>
    getRecipeAndroidLocalization(harness.ctx, nodes, {
      load: async () => ({ index, currentAppLocale: "ja" }),
    }),
  );
  for (let index = 0; index < 100; index += 1) {
    assert.equal(localization?.translate("  NETWORK  "), "ネットワーク");
  }
  assert.equal(
    catalogueReads,
    1,
    "each control must not rescan the APK's complete resource catalogue",
  );
});
