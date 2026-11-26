import assert from "node:assert/strict";
import test from "node:test";
import { createIosTunnelReadiness, tunnelListingLooksReady } from "./ios-tunnel-readiness.js";

test("iOS tunnel readiness belongs to the requested device, not another listed tunnel", () => {
  const listing = JSON.stringify([
    {
      udid: "other-ipad",
      address: "fd00::1",
      rsdPort: 58783,
      userspaceTun: true,
      userspaceTunPort: 28101,
    },
  ]);
  assert.equal(tunnelListingLooksReady(listing, "requested-ipad"), false);
  assert.equal(tunnelListingLooksReady(listing, "other-ipad"), true);
});

test("iOS tunnel readiness requires a usable native listing rather than diagnostic text", () => {
  assert.equal(
    tunnelListingLooksReady(
      'failed tunnel for {"udid":"requested-ipad","rsdPort":58783}',
      "requested-ipad",
    ),
    false,
  );
  assert.equal(
    tunnelListingLooksReady(
      JSON.stringify([{ udid: "requested-ipad", address: "fd00::1", rsdPort: 0 }]),
      "requested-ipad",
    ),
    false,
  );
  assert.equal(
    tunnelListingLooksReady(
      JSON.stringify([
        {
          udid: "requested-ipad",
          address: "fd00::1",
          rsdPort: 58783,
          userspaceTun: true,
          userspaceTunPort: 0,
        },
      ]),
      "requested-ipad",
    ),
    false,
  );
});

test("concurrent iOS preview startup verifies each waiter's own device tunnel", async () => {
  let finishStartup!: () => void;
  let markStarted!: () => void;
  const starting = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const startup = new Promise<void>((resolve) => {
    finishStartup = resolve;
  });
  const starts: string[] = [];
  const waits: string[] = [];
  let firstDeviceReady = false;
  const ensureGoIosTunnel = createIosTunnelReadiness({
    hasTunnel: async (_bin, _args, serial) => {
      if (!firstDeviceReady) throw new Error("tunnel-info is not serving yet");
      return serial === "first-ipad";
    },
    startTunnel: async (_bin, _args, serial) => {
      starts.push(serial);
      markStarted();
      await startup;
      firstDeviceReady = true;
    },
    waitForDevice: async (_bin, _args, serial) => {
      waits.push(serial);
      throw new Error(`No usable tunnel for ${serial}`);
    },
    ownedTunnel: () =>
      firstDeviceReady
        ? {
            running: true,
            stop: async () => {
              throw new Error("healthy tunnel must remain owned");
            },
          }
        : undefined,
  });
  const first = ensureGoIosTunnel("ios", [], "first-ipad");
  await starting;
  const second = ensureGoIosTunnel("ios", [], "second-ipad");
  finishStartup();
  await first;
  await assert.rejects(second, /No usable tunnel for second-ipad/);
  assert.deepEqual(starts, ["first-ipad"]);
  assert.deepEqual(waits, ["second-ipad"]);
});

test("a responding owned iOS tunnel is preserved when the requested device is not listed", async () => {
  let stops = 0;
  let starts = 0;
  const ensureGoIosTunnel = createIosTunnelReadiness({
    hasTunnel: async () => false,
    ownedTunnel: () => ({
      running: true,
      stop: async () => {
        stops += 1;
        return true;
      },
    }),
    waitForDevice: async () => {
      throw new Error("requested device did not become ready within its budget");
    },
    startTunnel: async () => {
      starts += 1;
    },
  });
  await assert.rejects(ensureGoIosTunnel("ios", [], "missing-ipad"), /within its budget/);
  assert.equal(stops, 0);
  assert.equal(starts, 0);
});

test("an owned iOS tunnel that no longer answers retains its bounded restart path", async () => {
  let stops = 0;
  const starts: string[] = [];
  const ensureGoIosTunnel = createIosTunnelReadiness({
    hasTunnel: async () => {
      throw new Error("tunnel-info timed out");
    },
    ownedTunnel: () => ({
      running: true,
      stop: async () => {
        stops += 1;
        return true;
      },
    }),
    startTunnel: async (_bin, _args, serial) => {
      starts.push(serial);
    },
    waitForDevice: async () => {
      throw new Error("unresponsive owner must not be preserved");
    },
  });
  await ensureGoIosTunnel("ios", [], "requested-ipad");
  assert.equal(stops, 1);
  assert.deepEqual(starts, ["requested-ipad"]);
});

test("a responding external iOS tunnel service is not replaced for a missing target", async () => {
  let starts = 0;
  const waits: string[] = [];
  const ensureGoIosTunnel = createIosTunnelReadiness({
    hasTunnel: async () => false,
    ownedTunnel: () => undefined,
    waitForDevice: async (_bin, _args, serial) => {
      waits.push(serial);
      throw new Error("requested device did not become ready within its budget");
    },
    startTunnel: async () => {
      starts += 1;
    },
  });
  await assert.rejects(ensureGoIosTunnel("ios", [], "missing-ipad"), /within its budget/);
  assert.equal(starts, 0);
  assert.deepEqual(waits, ["missing-ipad"]);
});
