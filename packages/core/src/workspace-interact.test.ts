import assert from "node:assert/strict";
import test from "node:test";
import { interact } from "./workspace-interact.js";
import { IosMutationOutcomeUnknownError } from "./ios-mutation-policy.js";
import { IOS_POINT_TAP_RECOVER, setIosPixelTapForTests } from "./workspace-ios-raw.js";
import { runWithTargetContext } from "./target-context.js";
import type { Device } from "./device.js";

test("iOS point interact uses CoreDevice HID when the helper lands", async () => {
  const taps: unknown[] = [];
  setIosPixelTapForTests(async (input) => {
    taps.push(input);
  });
  const device = {
    interactions: {
      press: () => {
        throw new Error("XCTest pressPoint must not run when HID lands");
      },
    },
  } as unknown as Device;
  try {
    const result = await runWithTargetContext(
      { kind: "device", platform: "ios", serial: "db0c9b7c" },
      () => interact({ kind: "point", x: 1112, y: 1010 }, { device, verifyIosScreenChange: false }),
    );
    assert.deepEqual(result.resolution, {
      method: "point",
      point: { x: 1112, y: 1010 },
      bounds: { x: 1112, y: 1010, width: 1, height: 1 },
    });
    assert.deepEqual(taps, [{ serial: "db0c9b7c", x: 1112, y: 1010 }]);
  } finally {
    setIosPixelTapForTests();
  }
});

test("iOS point interact falls back to XCTest when HID is absent from the DDI", async () => {
  const presses: unknown[] = [];
  setIosPixelTapForTests(async () => {
    throw new Error(
      "service 'com.apple.coredevice.hid.universalhidservice' is not available in RSD",
    );
  });
  const device = {
    interactions: {
      press: (options: unknown) => {
        presses.push(options);
        return Promise.resolve({});
      },
    },
  } as unknown as Device;
  try {
    await runWithTargetContext({ kind: "device", platform: "ios", serial: "db0c9b7c" }, () =>
      interact({ kind: "point", x: 1112, y: 1010 }, { device, verifyIosScreenChange: false }),
    );
    assert.equal(presses.length, 1);
    assert.equal((presses[0] as { x: number }).x, 1112);
    assert.equal((presses[0] as { y: number }).y, 1010);
  } finally {
    setIosPixelTapForTests();
  }
});

test("iOS point interact asks for recover when HID and XCTest both cannot press", async () => {
  setIosPixelTapForTests(async () => {
    throw new Error("this DDI/RSD has no dtuhidd surface");
  });
  const device = {
    interactions: {
      press: () => Promise.reject(new Error("No active session. Run open first.")),
    },
  } as unknown as Device;
  try {
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial: "db0c9b7c" }, () =>
          interact({ kind: "point", x: 1112, y: 1010 }, { device, verifyIosScreenChange: false }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof IosMutationOutcomeUnknownError));
        assert.match(error.message, new RegExp(IOS_POINT_TAP_RECOVER));
        assert.doesNotMatch(error.message, /Retry the tap/);
        assert.match(error.message, /Recover the runner/);
        return true;
      },
    );
  } finally {
    setIosPixelTapForTests();
  }
});
