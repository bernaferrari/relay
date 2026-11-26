import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchIosHidTap,
  IOS_PIXEL_TAP_FAILED,
  IOS_PIXEL_TAP_MISSING_HELPER,
  IOS_POINT_TAP_RECOVER,
  IosHidUnavailableError,
  isIosHidUnavailable,
  iosPointTapRecoverError,
  setIosPixelTapForTests,
  tapIosPointViaPixels,
} from "./workspace-ios-raw.js";

test("iOS point tap shells to the HID helper with screenshot pixels", async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  await tapIosPointViaPixels({
    serial: "db0c9b7c",
    x: 1112,
    y: 1010,
    width: 2224,
    height: 1668,
    bin: "/tmp/relay-ios-hid-tap",
    run: async (file, args) => {
      calls.push({ file, args });
      return { exitCode: 0, stdout: "tapped hid=32768,39682\n", stderr: "" };
    },
  });
  assert.deepEqual(calls, [
    {
      file: "/tmp/relay-ios-hid-tap",
      args: [
        "--udid",
        "db0c9b7c",
        "--x",
        "1112",
        "--y",
        "1010",
        "--width",
        "2224",
        "--height",
        "1668",
      ],
    },
  ]);
});

test("a missing HID helper is not an XCTest retry", async () => {
  const previous = process.env.RELAY_IOS_HID_TAP_BIN;
  process.env.RELAY_IOS_HID_TAP_BIN = "/tmp/relay-missing-ios-hid-tap";
  try {
    await assert.rejects(
      () => tapIosPointViaPixels({ serial: "ipad", x: 1, y: 2 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, IOS_PIXEL_TAP_MISSING_HELPER);
        assert.doesNotMatch(error.message, /Retry the tap/);
        return true;
      },
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_IOS_HID_TAP_BIN;
    else process.env.RELAY_IOS_HID_TAP_BIN = previous;
  }
});

test("HID helper failure tells recover for AX, not retry tap", async () => {
  await assert.rejects(
    () =>
      tapIosPointViaPixels({
        serial: "ipad",
        x: 8,
        y: 9,
        bin: "/tmp/relay-ios-hid-tap",
        run: async () => ({ exitCode: 1, stdout: "", stderr: "no tunnel" }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(IOS_PIXEL_TAP_FAILED.slice(0, 24)));
      assert.match(error.message, /Do not retry the same XCTest press/);
      assert.match(error.message, /no tunnel/);
      return true;
    },
  );
});

test("HID absence is classified so interact can fall back to XCTest", () => {
  assert.equal(
    isIosHidUnavailable(
      new Error("service 'com.apple.coredevice.hid.universalhidservice' is not available in RSD"),
    ),
    true,
  );
  assert.equal(isIosHidUnavailable(new Error(IOS_PIXEL_TAP_MISSING_HELPER)), true);
  assert.equal(isIosHidUnavailable(new Error("no tunnel")), false);
  const recover = iosPointTapRecoverError(new Error("no dtuhidd"), new Error("No active session"));
  assert.match(recover.message, new RegExp(IOS_POINT_TAP_RECOVER));
  assert.doesNotMatch(recover.message, /Retry the tap/);
});

test("tests may inject a pixel tap without spawning the helper", async () => {
  const seen: unknown[] = [];
  setIosPixelTapForTests(async (input) => {
    seen.push(input);
  });
  try {
    await tapIosPointViaPixels({ serial: "ipad", x: 3, y: 4 });
    assert.deepEqual(seen, [{ serial: "ipad", x: 3, y: 4 }]);
  } finally {
    setIosPixelTapForTests();
  }
});

test("an unauthenticated HID surface is a pre-dispatch miss, not a failed tap", async () => {
  const refused = await dispatchIosHidTap({
    serial: "ipad",
    x: 1181,
    y: 1228,
    bin: "/tmp/relay-ios-hid-tap",
    run: async () => ({
      exitCode: 1,
      stdout: "",
      stderr:
        "relay-ios-hid-tap: universalhidservice touch was not dispatched: no CoreDevice media stream is authenticating the digitizer, so backboardd drops the report. Remote control requires iOS 27",
    }),
  });
  assert.equal(refused.status, "not-dispatched");
  assert.equal(
    refused.status === "not-dispatched" && refused.error instanceof IosHidUnavailableError,
    true,
  );
  assert.doesNotMatch(
    refused.status === "not-dispatched" ? refused.error.message : "",
    /Do not retry the same XCTest press/,
  );
});

test("HID dispatch reports completed, pre-dispatch refusal, and unknown separately", async () => {
  setIosPixelTapForTests(async () => undefined);
  try {
    assert.deepEqual(await dispatchIosHidTap({ serial: "ipad", x: 1, y: 2 }), {
      status: "completed",
    });
  } finally {
    setIosPixelTapForTests();
  }

  setIosPixelTapForTests(async () => {
    throw new Error(
      "service 'com.apple.coredevice.hid.universalhidservice' is not available in RSD",
    );
  });
  try {
    const refused = await dispatchIosHidTap({ serial: "ipad", x: 1, y: 2 });
    assert.equal(refused.status, "not-dispatched");
    assert.ok(
      refused.status === "not-dispatched" && refused.error instanceof IosHidUnavailableError,
    );
  } finally {
    setIosPixelTapForTests();
  }

  setIosPixelTapForTests(async () => {
    throw new Error("connection reset");
  });
  try {
    const unknown = await dispatchIosHidTap({ serial: "ipad", x: 1, y: 2 });
    assert.equal(unknown.status, "outcome-unknown");
    assert.equal(unknown.status === "outcome-unknown" && unknown.error.message, "connection reset");
  } finally {
    setIosPixelTapForTests();
  }
});
