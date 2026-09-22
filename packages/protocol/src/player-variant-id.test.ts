import assert from "node:assert/strict";
import test from "node:test";
import { playerVariantIdForConfiguration } from "./player-variant-id.js";

test("a case variant id is the configuration key, not an account or environment label", () => {
  assert.equal(
    playerVariantIdForConfiguration({ account: "member", browser: "firefox", locale: "ar" }),
    "account=member · browser=firefox · locale=ar",
  );
  assert.equal(playerVariantIdForConfiguration({}), undefined);
  assert.equal(playerVariantIdForConfiguration(undefined), undefined);
});
