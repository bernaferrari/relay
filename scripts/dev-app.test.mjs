import assert from "node:assert/strict";
import test from "node:test";
import { allowedBrowserOriginsWith, relayBrowserOrigin, relayBrowserOrigins } from "./dev-app.mjs";

test("browser development binds the exact chosen loopback origin", () => {
  assert.equal(relayBrowserOrigin(5175), "http://127.0.0.1:5175");
  assert.throws(() => relayBrowserOrigin(0), /Invalid Relay app port/u);
});

test("browser development accepts the friendly localhost URL and exact loopback host", () => {
  assert.deepEqual(relayBrowserOrigins(3000), ["http://localhost:3000", "http://127.0.0.1:3000"]);
});

test("browser development preserves reviewed origins without duplicates", () => {
  assert.equal(
    allowedBrowserOriginsWith(
      "http://127.0.0.1:5175",
      "https://relay.example, http://127.0.0.1:5175",
    ),
    "https://relay.example,http://127.0.0.1:5175",
  );
});
