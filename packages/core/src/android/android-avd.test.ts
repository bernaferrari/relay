import assert from "node:assert/strict";
import test from "node:test";
import {
  AndroidAvdError,
  bootAndroidAvd,
  listAndroidAvds,
  parseAndroidAvdNames,
  resetAndroidAvdIdentityCache,
} from "./android-avd.js";

test.afterEach(() => resetAndroidAvdIdentityCache());

test("parses a bounded, distinct AVD inventory without inventing names", () => {
  assert.deepEqual(parseAndroidAvdNames(" Pixel_9_API_36\n\nPixel_9_API_36\nTV_API_35\n"), [
    "Pixel_9_API_36",
    "TV_API_35",
  ]);
});

test("keeps configured AVDs distinct from connected devices and observes only matching serials", async () => {
  const inventory = await listAndroidAvds({
    listAvdNames: async () => ["Pixel_9_API_36", "TV_API_35"],
    listConnected: async () => [
      {
        serial: "emulator-5554",
        name: "Pixel 9",
        kind: "Emulator",
        connectionState: "connected",
      },
    ],
    readAvdName: async () => "Pixel_9_API_36",
    readBootCompleted: async () => true,
  });

  assert.deepEqual(inventory, {
    source: "android-sdk",
    available: true,
    avds: [
      {
        avdName: "Pixel_9_API_36",
        serial: "emulator-5554",
        name: "Pixel_9_API_36",
        platform: "android",
        kind: "emulator",
        target: "mobile",
        booted: true,
        status: "booted",
        source: "android-sdk",
      },
      {
        avdName: "TV_API_35",
        name: "TV_API_35",
        platform: "android",
        kind: "emulator",
        target: "tv",
        booted: false,
        status: "stopped",
        source: "android-sdk",
      },
    ],
  });
});

test("reports SDK absence explicitly instead of claiming emulator availability", async () => {
  const inventory = await listAndroidAvds({
    listAvdNames: async () => {
      throw new AndroidAvdError("sdk-unavailable", "missing emulator");
    },
  });
  assert.deepEqual(inventory, {
    source: "unavailable",
    available: false,
    avds: [],
    reason: "sdk-unavailable",
  });
});

test("reports a connected but not-ready emulator as booting", async () => {
  const inventory = await listAndroidAvds({
    listAvdNames: async () => ["Pixel_9_API_36"],
    listConnected: async () => [
      {
        serial: "emulator-5554",
        name: "Pixel 9",
        kind: "Emulator",
        connectionState: "connected",
      },
    ],
    readAvdName: async () => "Pixel_9_API_36",
    readBootCompleted: async () => false,
  });
  assert.equal(inventory.avds[0]?.status, "booting");
  assert.equal(inventory.avds[0]?.booted, false);
  assert.equal(inventory.avds[0]?.serial, "emulator-5554");
});

test("does not bind an AVD when two connected serials claim the same configured identity", async () => {
  const inventory = await listAndroidAvds({
    listAvdNames: async () => ["Pixel_9_API_36"],
    listConnected: async () => [
      {
        serial: "emulator-5554",
        name: "Pixel 9 A",
        kind: "Emulator",
        connectionState: "connected",
      },
      {
        serial: "emulator-5556",
        name: "Pixel 9 B",
        kind: "Emulator",
        connectionState: "connected",
      },
    ],
    readAvdName: async () => "Pixel_9_API_36",
    readBootCompleted: async () => true,
  });

  assert.equal(inventory.avds[0]?.status, "stopped");
  assert.equal(inventory.avds[0]?.serial, undefined);
});

test("boots one exact AVD and returns its observed runtime serial after readiness", async () => {
  let launched = false;
  let polls = 0;
  const result = await bootAndroidAvd(
    "Pixel_9_API_36",
    { timeoutMs: 5_000, headless: true },
    {
      listAvdNames: async () => ["Pixel_9_API_36"],
      listConnected: async () =>
        polls++ > 0
          ? [
              {
                serial: "emulator-5554",
                name: "Android emulator",
                kind: "Emulator",
                connectionState: "connected",
              },
            ]
          : [],
      readAvdName: async () => "Pixel_9_API_36",
      readBootCompleted: async () => launched,
      launch: async (avdName, headless) => {
        assert.equal(avdName, "Pixel_9_API_36");
        assert.equal(headless, true);
        launched = true;
      },
      sleep: async () => undefined,
      now: () => 123,
    },
  );

  assert.deepEqual(result, {
    avdName: "Pixel_9_API_36",
    serial: "emulator-5554",
    platform: "android",
    kind: "emulator",
    booted: true,
    status: "booted",
    reused: false,
    observedAt: 123,
  });
});

test("requires consecutive coherent readiness observations before returning an AVD serial", async () => {
  let launched = false;
  let poll = 0;
  const observations = [true, false, true, true, true];
  const result = await bootAndroidAvd(
    "Pixel_9_API_36",
    { timeoutMs: 5_000 },
    {
      listAvdNames: async () => ["Pixel_9_API_36"],
      listConnected: async () =>
        launched
          ? [
              {
                serial: "emulator-5554",
                name: "Pixel 9",
                kind: "Emulator",
                connectionState: "connected",
              },
            ]
          : [],
      readAvdName: async () => "Pixel_9_API_36",
      readBootCompleted: async () => observations[Math.min(poll++, observations.length - 1)]!,
      launch: async () => {
        launched = true;
      },
      sleep: async () => undefined,
    },
  );

  assert.equal(result.serial, "emulator-5554");
  assert.equal(poll, 5);
});

test("reuses an already booted exact AVD and rejects a concurrent duplicate boot", async () => {
  const already = await bootAndroidAvd(
    "Pixel_9_API_36",
    {},
    {
      listAvdNames: async () => ["Pixel_9_API_36"],
      listConnected: async () => [
        {
          serial: "emulator-5554",
          name: "Pixel",
          kind: "Emulator",
          connectionState: "connected",
        },
      ],
      readAvdName: async () => "Pixel_9_API_36",
      readBootCompleted: async () => true,
    },
  );
  assert.equal(already.status, "already-booted");
  assert.equal(already.reused, true);

  let releaseLaunch!: () => void;
  let booted = false;
  const launchStarted = new Promise<void>((resolve) => {
    releaseLaunch = resolve;
  });
  const first = bootAndroidAvd(
    "Pixel_9_API_36",
    { timeoutMs: 5_000 },
    {
      listAvdNames: async () => ["Pixel_9_API_36"],
      listConnected: async () =>
        booted
          ? [
              {
                serial: "emulator-5554",
                name: "Pixel",
                kind: "Emulator",
                connectionState: "connected",
              },
            ]
          : [],
      readAvdName: async () => "Pixel_9_API_36",
      readBootCompleted: async () => booted,
      launch: async () => {
        await launchStarted;
        booted = true;
      },
      sleep: async () => undefined,
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(
    bootAndroidAvd("Pixel_9_API_36", {}, { listAvdNames: async () => ["Pixel_9_API_36"] }),
    (error: unknown) => error instanceof AndroidAvdError && error.code === "avd-boot-in-progress",
  );
  releaseLaunch();
  const completed = await first;
  assert.equal(completed.serial, "emulator-5554");
});

test("requires the exact configured AVD identity instead of fuzzy selection", async () => {
  await assert.rejects(
    bootAndroidAvd("pixel_9_api_36", {}, { listAvdNames: async () => ["Pixel_9_API_36"] }),
    (error: unknown) => error instanceof AndroidAvdError && error.code === "avd-not-found",
  );
});
