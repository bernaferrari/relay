import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authenticatedBrowserOrigin,
  allowedBrowserOrigin,
  assertExplicitRemoteServiceTokenScope,
  assertSafeBinding,
  authorizationMatches,
  configuredBrowserOrigins,
  isLoopbackHost,
  isLocalWorkspacePath,
  resolveCommandActor,
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

  it("allows only explicitly configured Relay browser origins for local trust", () => {
    const origins = configuredBrowserOrigins("http://relay.local:5173,https://console.relay.test");
    assert.equal(allowedBrowserOrigin(undefined, origins), null);
    assert.equal(
      allowedBrowserOrigin("http://relay.local:5173", origins),
      "http://relay.local:5173",
    );
    assert.equal(allowedBrowserOrigin("http://localhost:5173", origins), null);
    assert.equal(allowedBrowserOrigin("http://127.0.0.1:4173", origins), null);
    assert.equal(
      allowedBrowserOrigin("https://console.relay.test", origins),
      "https://console.relay.test",
    );
    assert.equal(allowedBrowserOrigin("null", origins), null);
    assert.equal(
      authenticatedBrowserOrigin("https://self-managed.relay.test"),
      "https://self-managed.relay.test",
    );
    assert.equal(authenticatedBrowserOrigin("file://relay"), null);
    assert.throws(
      () => configuredBrowserOrigins("http://relay.local:5173/not-an-origin"),
      /invalid origin/,
    );
    assert.throws(() => configuredBrowserOrigins("*"), /invalid origin/);
  });

  it("requires an explicit role and scope for a network-visible static token", () => {
    const previous = {
      organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
      projects: process.env.RELAY_AUTH_PROJECT_IDS,
      role: process.env.RELAY_AUTH_ROLE,
    };
    delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    delete process.env.RELAY_AUTH_PROJECT_IDS;
    delete process.env.RELAY_AUTH_ROLE;
    try {
      assert.throws(
        () => assertExplicitRemoteServiceTokenScope("0.0.0.0", "a-secure-token-with-24-chars"),
        /RELAY_AUTH_ROLE.*RELAY_AUTH_ORGANIZATION_ID.*RELAY_AUTH_PROJECT_IDS/,
      );
      process.env.RELAY_AUTH_ROLE = "runner";
      process.env.RELAY_AUTH_ORGANIZATION_ID = "acme";
      process.env.RELAY_AUTH_PROJECT_IDS = "mobile-ios,mobile-android";
      assert.doesNotThrow(() =>
        assertExplicitRemoteServiceTokenScope("0.0.0.0", "a-secure-token-with-24-chars"),
      );
      assert.doesNotThrow(() =>
        assertExplicitRemoteServiceTokenScope("127.0.0.1", "a-secure-token-with-24-chars"),
      );
    } finally {
      if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
      else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
      if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
      else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
      if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
      else process.env.RELAY_AUTH_ROLE = previous.role;
    }
  });

  it("keeps unowned workspace assets on the local control plane", () => {
    assert.equal(isLocalWorkspacePath("/recipes"), false);
    assert.equal(isLocalWorkspacePath("/recipes/custom-login"), false);
    assert.equal(isLocalWorkspacePath("/discovery"), true);
    assert.equal(isLocalWorkspacePath("/discovery/x"), true);
    assert.equal(isLocalWorkspacePath("/app-maps"), false);
    assert.equal(isLocalWorkspacePath("/runs"), false);
    assert.equal(isLocalWorkspacePath("/jobs/123"), false);
  });

  it("derives service scope from configuration and rejects header broadening", () => {
    const previous = {
      organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
      projects: process.env.RELAY_AUTH_PROJECT_IDS,
      role: process.env.RELAY_AUTH_ROLE,
    };
    process.env.RELAY_AUTH_ORGANIZATION_ID = "org-a";
    process.env.RELAY_AUTH_PROJECT_IDS = "project-a,project-b";
    process.env.RELAY_AUTH_ROLE = "runner";
    try {
      const context = resolveRequestContext(
        { "x-organization-id": "org-a", "x-project-id": "project-b" },
        { authenticated: true, localTrusted: false },
      );
      assert.equal(context.projectId, "project-b");
      assert.equal(context.role, "runner");
      assert.throws(
        () =>
          resolveRequestContext(
            { "x-organization-id": "org-a", "x-project-id": "project-c" },
            { authenticated: true, localTrusted: false },
          ),
        /not authorized/,
      );
      process.env.RELAY_AUTH_ROLE = "superuser";
      assert.throws(
        () =>
          resolveRequestContext(
            { "x-organization-id": "org-a", "x-project-id": "project-a" },
            { authenticated: true, localTrusted: false },
          ),
        /RELAY_AUTH_ROLE/,
      );
    } finally {
      if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
      else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
      if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
      else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
      if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
      else process.env.RELAY_AUTH_ROLE = previous.role;
    }
  });

  it("accepts normalized local human, agent, and system identities", () => {
    const context = resolveRequestContext({}, { authenticated: false, localTrusted: true });
    assert.equal(context.role, "admin");
    assert.deepEqual(
      resolveCommandActor(
        { "x-relay-actor-id": "agent:explorer-1", "x-relay-actor-kind": "agent" },
        context,
      ),
      { actorId: "agent:explorer-1", actorKind: "agent" },
    );
    assert.throws(
      () =>
        resolveCommandActor(
          { "x-relay-actor-id": "bad actor", "x-relay-actor-kind": "human" },
          context,
        ),
      /unsupported characters/,
    );
    assert.deepEqual(
      resolveCommandActor(
        { "x-relay-actor-id": "system:desktop-main", "x-relay-actor-kind": "system" },
        context,
      ),
      { actorId: "system:desktop-main", actorKind: "system" },
    );
  });

  it("binds authenticated requests to the configured service actor", () => {
    const context = {
      subject: "service:indexer",
      organizationId: "org-a",
      projectId: "project-a",
      allowedProjects: ["project-a"],
      tokenKind: "service" as const,
      localTrusted: false,
      role: "admin" as const,
    };
    assert.deepEqual(resolveCommandActor({}, context), {
      actorId: "service:indexer",
      actorKind: "agent",
    });
    assert.throws(
      () =>
        resolveCommandActor(
          { "x-relay-actor-id": "human:admin", "x-relay-actor-kind": "human" },
          context,
        ),
      /must match the authenticated subject/,
    );
    assert.throws(
      () => resolveCommandActor({ "x-relay-actor-kind": "system" }, context),
      /must use actorKind agent/,
    );
  });
});
