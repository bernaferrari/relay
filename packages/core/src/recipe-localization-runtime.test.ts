import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createSessionJob } from "./session-job-factory.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import { resolveLocalizedRecipeTarget } from "./recipe-localized-target.js";
import { runWithTargetContext } from "./target-context.js";
import { localizeExpectedObservation } from "./recipe-localization.js";
import { compareScreenIdentity } from "./screen-identity.js";
import type { RecipeAndroidLocalization } from "./recipe-localization.js";
import type { Device } from "./device.js";
import type { SnapshotNode } from "./device.js";
import type { ScreenIdentityObservation } from "./screen-identity.js";
import { localizedScreenIdentityMatches } from "./recipe-localization.js";

const pkg = "com.example.app";
const english = [
  { role: "view", identifier: `${pkg}:id/root`, bundleId: pkg },
  { role: "text", identifier: `${pkg}:id/title`, label: "Settings", bundleId: pkg },
  { role: "button", identifier: `${pkg}:id/network`, label: "Network & internet", bundleId: pkg },
];
const japanese = english.map((node, index) => ({
  ...node,
  ...(index > 0 ? { rect: { x: 20, y: index * 100, width: 300, height: 60 }, hittable: true } : {}),
  ...(node.label === "Settings" ? { label: "設定" } : {}),
  ...(node.label === "Network & internet" ? { label: "ネットワークとインターネット" } : {}),
}));

function stubDevice(nodes: SnapshotNode[]): Device {
  return {
    interactions: {
      find: () => Promise.resolve({}),
      press: () => Promise.resolve({}),
      longPress: () => Promise.resolve({}),
      fill: () => Promise.resolve({}),
      type: () => Promise.resolve({}),
      swipe: () => Promise.resolve({}),
      scroll: () => Promise.resolve({}),
      pan: () => Promise.resolve({}),
    },
    command: {
      wait: () => Promise.resolve({}),
      back: () => Promise.resolve({}),
      home: () => Promise.resolve({}),
    },
    capture: { snapshot: () => Promise.resolve({ nodes }) },
  } as unknown as Device;
}

function job() {
  return createSessionJob(
    { recipe: "localized", serial: "localized-runtime", platform: "android" },
    { findJob: () => undefined, toTransport: (value) => value },
  );
}

function localization(): RecipeAndroidLocalization {
  const translations = new Map([
    ["settings", "設定"],
    ["network & internet", "ネットワークとインターネット"],
  ]);
  return {
    packageName: pkg,
    locale: "ja",
    translate: (text) => translations.get(text.toLocaleLowerCase()),
    lookup: (text) => {
      const target = translations.get(text.toLocaleLowerCase());
      return target
        ? { status: "matched", key: text, source: text, target }
        : { status: "missing", source: text };
    },
  };
}

test("runExpectScreenStep proves Japanese screen through translated expected labels", async () => {
  const targetJob = job();
  const observation = observeScreenIdentity(english);
  await runWithTargetContext(
    { kind: "device", platform: "android", serial: targetJob.serial! },
    () =>
      runExpectScreenStep(
        stubDevice(japanese),
        {
          kind: "expect-screen",
          screenId: "settings",
          screenTitle: "Settings",
          fingerprint: observation.fingerprint,
          observations: [observation],
          timeoutMs: 0,
        },
        { job: targetJob, runtime: {}, log: () => {} },
        {
          getLocalization: async () => localization(),
        },
      ),
  );
  assert.deepEqual(japanese.map((node) => node.label).filter(Boolean), [
    "設定",
    "ネットワークとインターネット",
  ]);
});

test("translated target requires one current app control and never uses recorded point", () => {
  const target = resolveLocalizedRecipeTarget(
    japanese,
    { label: "Network & internet", point: { x: 4, y: 4 } },
    localization(),
  );
  assert.equal(target?.outcome.status, "resolved");
  assert.equal(target?.target.point, undefined);
  assert.equal(
    resolveLocalizedRecipeTarget(
      japanese.map((node) => ({ ...node, bundleId: "com.other.app" })),
      { label: "Network & internet" },
      localization(),
    )?.outcome.status,
    "absent",
  );
  assert.equal(
    resolveLocalizedRecipeTarget(
      [...japanese, { ...japanese[2]!, rect: { x: 20, y: 400, width: 300, height: 60 } }],
      { label: "Network & internet" },
      localization(),
    )?.outcome.status,
    "ambiguous",
  );
  const noResources = { ...localization(), translate: () => undefined };
  assert.equal(resolveLocalizedRecipeTarget(japanese, { label: "Delete" }, noResources), undefined);
});

test("localized Settings data usage screen survives changed German usage values", async () => {
  const fixture = JSON.parse(
    fs.readFileSync(new URL("./fixtures/german-data-usage-replay.json", import.meta.url), "utf8"),
  ) as {
    sourceRunId: string;
    expectedObservation: ScreenIdentityObservation;
    observedNodes: SnapshotNode[];
  };
  const expected = {
    kind: "expect-screen" as const,
    screenId: "screen-7571dc48d02fb037",
    screenTitle: "Non-carrier data usage",
    fingerprint: "4411b3c3f0e8bb9aaf0b35467b266a7170a10c188015f0293c7c6810a1a932f4",
    observations: [fixture.expectedObservation],
    timeoutMs: 0,
  };
  const observedNodes = fixture.observedNodes;
  const observed = observeScreenIdentity(observedNodes);
  const translations = new Map([
    ["non-carrier data usage", "Datennutzung ohne Mobilfunkdaten"],
    [
      "graph showing data usage between <date> and <date>.; <date>, <percentage>; <date> – 29, <percentage>; <date> – <date>, <percentage>; <date>, <percentage>",
      "Grafik zeigt Datennutzung zwischen dem 2. August und dem 30. August.; 2.–9. August, 0%; 9.–12. August, 26%; 12.–29. August, 72%; 29. August, 100%",
    ],
  ]);
  const localization: RecipeAndroidLocalization = {
    packageName: "com.android.settings",
    locale: "de",
    translate: (text) => translations.get(text.toLocaleLowerCase()),
    lookup: (text) => {
      const target = translations.get(text.toLocaleLowerCase());
      return target
        ? { status: "matched", key: text, source: text, target }
        : { status: "missing", source: text };
    },
  };
  const sourceObservation = expected.observations[0]!;
  const localized = localizeExpectedObservation(sourceObservation, localization, observed)!;
  assert.equal(compareScreenIdentity(observed, localized).decision, "possible");
  await runWithTargetContext(
    { kind: "device", platform: "android", serial: "settings-regression" },
    () =>
      runExpectScreenStep(
        stubDevice(observedNodes),
        expected,
        { job: job(), runtime: {}, log: () => {} },
        { getLocalization: async () => localization },
      ),
  );
  const wrongTitle = {
    ...observed,
    nodes: observed.nodes.map((node) =>
      node.identifier?.endsWith(":id/collapsing_toolbar")
        ? { ...node, label: "Netzwerk & Internet" }
        : node,
    ),
  };
  assert.equal(
    localizedScreenIdentityMatches(wrongTitle, localized, sourceObservation, localization),
    false,
  );
  const foreign = {
    ...observed,
    nodes: observed.nodes.map((node) =>
      node.identifier?.startsWith("com.android.settings:")
        ? {
            ...node,
            identifier: node.identifier.replace("com.android.settings:", "com.android.systemui:"),
          }
        : node,
    ),
  };
  assert.equal(
    localizedScreenIdentityMatches(foreign, localized, sourceObservation, localization),
    false,
  );
});
