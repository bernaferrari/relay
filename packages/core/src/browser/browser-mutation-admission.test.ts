import assert from "node:assert/strict";
import test from "node:test";
import {
  browserMutationAdmissionStats,
  BrowserDeviceInputOverloadedError,
  MAX_BROWSER_DEVICE_INPUT_QUEUE,
  resetBrowserMutationAdmissionsForTests,
  runBrowserMutationAdmission,
} from "./browser-mutation-admission.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("browser mutation admission rejects an input flood at a fixed bound", async () => {
  resetBrowserMutationAdmissionsForTests();
  const targetId = "browser-admission-stress";
  const first = deferred();
  const running = runBrowserMutationAdmission(targetId, async () => first.promise);
  const queued = Array.from({ length: MAX_BROWSER_DEVICE_INPUT_QUEUE - 1 }, (_, index) =>
    runBrowserMutationAdmission(targetId, async () => index),
  );

  assert.deepEqual(browserMutationAdmissionStats(targetId), {
    pending: MAX_BROWSER_DEVICE_INPUT_QUEUE,
    limit: MAX_BROWSER_DEVICE_INPUT_QUEUE,
  });
  await assert.rejects(
    runBrowserMutationAdmission(targetId, async () => undefined),
    (error) =>
      error instanceof BrowserDeviceInputOverloadedError &&
      error.code === "BROWSER_INPUT_OVERLOADED" &&
      error.pending === MAX_BROWSER_DEVICE_INPUT_QUEUE,
  );

  first.resolve();
  await Promise.all([running, ...queued]);
  assert.deepEqual(browserMutationAdmissionStats(targetId), {
    pending: 0,
    limit: MAX_BROWSER_DEVICE_INPUT_QUEUE,
  });
  resetBrowserMutationAdmissionsForTests();
});

test("generic browser mutations and Browser Device inputs share one admission lane", async () => {
  resetBrowserMutationAdmissionsForTests();
  const targetId = "browser-admission-order";
  const first = deferred();
  const order: string[] = [];
  const browserDevice = runBrowserMutationAdmission(targetId, async () => {
    order.push("browser-device-start");
    await first.promise;
    order.push("browser-device-end");
  });
  const generic = runBrowserMutationAdmission(targetId, async () => {
    order.push("generic");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["browser-device-start"]);
  first.resolve();
  await Promise.all([browserDevice, generic]);
  assert.deepEqual(order, ["browser-device-start", "browser-device-end", "generic"]);
  resetBrowserMutationAdmissionsForTests();
});
