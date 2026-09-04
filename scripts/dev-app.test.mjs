import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedBrowserOriginsWith,
  relayAppPackage,
  relayBrowserOrigin,
  relayBrowserOrigins,
  relayDevelopmentOrigins,
} from "./dev-app.mjs";

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

test("a fallback development port preserves the preferred browser origin", () => {
  assert.deepEqual(relayDevelopmentOrigins(3000, 3001), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ]);
  assert.deepEqual(relayDevelopmentOrigins(3000, 3000), [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("browser development uses the React product by default and keeps an explicit legacy escape hatch", () => {
  assert.equal(relayAppPackage([]), "@relay/app-v2");
  assert.equal(relayAppPackage(["--v2"]), "@relay/app-v2");
  assert.equal(relayAppPackage(["--legacy"]), "@relay/app");
  assert.throws(() => relayAppPackage(["--v2", "--legacy"]), /Choose either --v2 or --legacy/u);
  assert.throws(() => relayAppPackage(["--unknown"]), /Unknown Relay app option/u);
});
