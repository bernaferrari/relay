import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./http.js";
import { assertAndroidLiveInputPlatform } from "./live-input-platform.js";

test("only Android can use the live scrcpy input transport", () => {
  assert.doesNotThrow(() => assertAndroidLiveInputPlatform("android"));

  for (const platform of ["ios", "browser", undefined] as const) {
    assert.throws(
      () => assertAndroidLiveInputPlatform(platform),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 409 &&
        (platform === "ios"
          ? /canonical interaction/i.test(error.message)
          : platform === "browser"
            ? /device interact with kind: type/i.test(error.message)
            : /attached Android/i.test(error.message)),
    );
  }
});
