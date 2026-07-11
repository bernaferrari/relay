import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafeBinding, authorizationMatches, isLoopbackHost } from "./security.js";

describe("server security", () => {
  it("recognizes loopback hosts", () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("0.0.0.0"), false);
  });

  it("refuses unauthenticated network bindings", () => {
    assert.throws(() => assertSafeBinding("0.0.0.0"), /Refusing to bind/);
    assert.throws(() => assertSafeBinding("0.0.0.0", "short"), /at least 24/);
    assert.doesNotThrow(() => assertSafeBinding("0.0.0.0", "a-secure-token-with-24-chars"));
  });

  it("compares bearer tokens without accepting malformed headers", () => {
    const token = "a-secure-token-with-24-chars";
    assert.equal(authorizationMatches(undefined, undefined), true);
    assert.equal(authorizationMatches(undefined, token), false);
    assert.equal(authorizationMatches(`Basic ${token}`, token), false);
    assert.equal(authorizationMatches("Bearer wrong", token), false);
    assert.equal(authorizationMatches(`Bearer ${token}`, token), true);
  });
});
