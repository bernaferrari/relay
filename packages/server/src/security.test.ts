import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedBrowserOrigin,
  assertSafeBinding,
  authorizationMatches,
  isLoopbackHost,
  isLocalWorkspacePath,
  resolveRequestContext,
} from "./security.js";

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

  it("allows only loopback browser origins for the local API", () => {
    assert.equal(allowedBrowserOrigin(undefined), null);
    assert.equal(allowedBrowserOrigin("http://localhost:5173"), "http://localhost:5173");
    assert.equal(allowedBrowserOrigin("http://127.0.0.1:4173"), "http://127.0.0.1:4173");
    assert.equal(allowedBrowserOrigin("https://relay.example"), null);
    assert.equal(allowedBrowserOrigin("null"), null);
  });

  it("keeps unowned workspace assets on the local control plane", () => {
    assert.equal(isLocalWorkspacePath("/recipes"), true);
    assert.equal(isLocalWorkspacePath("/recipes/custom-login"), true);
    assert.equal(isLocalWorkspacePath("/suites/smoke/run"), true);
    assert.equal(isLocalWorkspacePath("/runs"), false);
    assert.equal(isLocalWorkspacePath("/jobs/123"), false);
  });

  it("derives service scope from configuration and rejects header broadening", () => {
    const previous = {
      organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
      projects: process.env.RELAY_AUTH_PROJECT_IDS,
    };
    process.env.RELAY_AUTH_ORGANIZATION_ID = "org-a";
    process.env.RELAY_AUTH_PROJECT_IDS = "project-a,project-b";
    try {
      const context = resolveRequestContext(
        { "x-organization-id": "org-a", "x-project-id": "project-b" },
        { authenticated: true, localTrusted: false },
      );
      assert.equal(context.projectId, "project-b");
      assert.throws(
        () =>
          resolveRequestContext(
            { "x-organization-id": "org-a", "x-project-id": "project-c" },
            { authenticated: true, localTrusted: false },
          ),
        /not authorized/,
      );
    } finally {
      if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
      else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
      if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
      else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    }
  });
});
