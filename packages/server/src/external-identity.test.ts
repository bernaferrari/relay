import assert from "node:assert/strict";
import test from "node:test";
import {
  verifiedExternalIdentity,
  verifyExternalBearerToken,
  type ExternalIdentityVerifier,
  type VerifiedExternalIdentity,
} from "./external-identity.js";
import { startServer } from "./index.js";
import { authenticateRequest, resolveCommandActor, resolveRequestContext } from "./security.js";

function identity(expiresAt = Date.now() + 60_000) {
  return verifiedExternalIdentity({
    subject: "user:ada",
    organizationId: "acme",
    projectRoles: { mobile: "viewer", web: "runner" },
    expiresAt,
  });
}

function untrustedIdentity(): VerifiedExternalIdentity {
  return {
    subject: "user:mallory",
    organizationId: "acme",
    projectRoles: { mobile: "admin" },
    expiresAt: Date.now() + 60_000,
    actorKind: "human",
  } as unknown as VerifiedExternalIdentity;
}

function externalVerifier(): ExternalIdentityVerifier {
  const valid = identity();
  const expired = identity(1);
  return {
    verifyBearerToken({ token }) {
      if (token === "verified-opaque-credential") return valid;
      if (token === "decoded-claims") return untrustedIdentity();
      if (token === "expired-credential") return expired;
      if (token === "verifier-error") throw new Error("upstream identity provider unavailable");
      return undefined;
    },
  };
}

test("external identities require a branded verifier result and an unexpired, valid scope", async () => {
  const verifier = externalVerifier();
  const now = Date.now();
  const valid = await verifyExternalBearerToken(verifier, "verified-opaque-credential", now);
  assert.equal(valid?.subject, "user:ada");
  assert.equal(await verifyExternalBearerToken(verifier, "decoded-claims", now), undefined);
  assert.equal(await verifyExternalBearerToken(verifier, "expired-credential", now), undefined);
  assert.equal(await verifyExternalBearerToken(verifier, "verifier-error", now), undefined);
  assert.throws(
    () =>
      verifiedExternalIdentity({
        subject: "user:ada",
        organizationId: "acme",
        projectRoles: { mobile: "owner" as "viewer" },
        expiresAt: now + 60_000,
      }),
    /project role/,
  );
  assert.throws(
    () =>
      verifiedExternalIdentity({
        subject: "user:\u0001ada",
        organizationId: "acme",
        projectRoles: { mobile: "viewer" },
        expiresAt: now + 60_000,
      }),
    /control characters/,
  );
});

test("external scope is verifier-owned while static and loopback authentication stay unchanged", async () => {
  const verifier = externalVerifier();
  const external = await authenticateRequest("Bearer verified-opaque-credential", {
    externalIdentityVerifier: verifier,
    localTrusted: false,
  });
  assert.equal(external?.kind, "external");
  assert.equal((await authenticateRequest("Bearer any", { localTrusted: false }))?.kind, undefined);
  assert.equal(
    (
      await authenticateRequest("Bearer configured-service-token", {
        token: "configured-service-token",
        localTrusted: false,
      })
    )?.kind,
    "service",
  );
  assert.equal((await authenticateRequest(undefined, { localTrusted: true }))?.kind, "local");
  assert.equal(
    (
      await authenticateRequest(undefined, {
        externalIdentityVerifier: verifier,
        localTrusted: true,
      })
    )?.kind,
    "local",
  );

  assert.ok(external && external.kind === "external");
  const context = resolveRequestContext(
    { "x-project-id": "web" },
    {
      authenticated: true,
      localTrusted: false,
      externalIdentity: external.identity,
    },
  );
  assert.deepEqual(
    {
      subject: context.subject,
      organizationId: context.organizationId,
      projectId: context.projectId,
      allowedProjects: context.allowedProjects,
      role: context.role,
      tokenKind: context.tokenKind,
      localTrusted: context.localTrusted,
    },
    {
      subject: "user:ada",
      organizationId: "acme",
      projectId: "web",
      allowedProjects: ["mobile", "web"],
      role: "runner",
      tokenKind: "external",
      localTrusted: false,
    },
  );
  assert.deepEqual(resolveCommandActor({}, context), { actorId: "user:ada", actorKind: "human" });
  assert.throws(
    () => resolveCommandActor({ "x-relay-actor-id": "human:other" }, context),
    /must match the authenticated subject/,
  );
  assert.throws(
    () => resolveCommandActor({ "x-relay-actor-kind": "agent" }, context),
    /external actors must use actorKind human/,
  );
  assert.throws(
    () =>
      resolveRequestContext(
        {},
        {
          authenticated: true,
          localTrusted: false,
          externalIdentity: external.identity,
        },
      ),
    /requested project/,
  );
  assert.throws(
    () =>
      resolveRequestContext(
        { "x-project-id": "other" },
        {
          authenticated: true,
          localTrusted: false,
          externalIdentity: external.identity,
        },
      ),
    /requested project/,
  );
});

test("network routes fail closed for untrusted, expired, and unknown external bearer credentials", async () => {
  const previous = {
    authToken: process.env.RELAY_AUTH_TOKEN,
    redactionMode: process.env.RELAY_REDACTION_MODE,
  };
  delete process.env.RELAY_AUTH_TOKEN;
  process.env.RELAY_REDACTION_MODE = "on";
  const server = await startServer({
    host: "0.0.0.0",
    port: 0,
    externalIdentityVerifier: externalVerifier(),
  });
  const health = `http://127.0.0.1:${server.port}/health`;
  try {
    for (const token of [
      "decoded-claims",
      "expired-credential",
      "unknown-credential",
      "verifier-error",
    ]) {
      const response = await fetch(health, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 401, token);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="relay"');
    }

    const response = await fetch(health, {
      headers: {
        Authorization: "Bearer verified-opaque-credential",
        "x-organization-id": "acme",
        "x-project-id": "web",
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      access: { role: string; organizationId: string; projectId: string };
    };
    assert.deepEqual(body.access, {
      role: "runner",
      organizationId: "acme",
      projectId: "web",
    });

    const wrongScope = await fetch(health, {
      headers: {
        Authorization: "Bearer verified-opaque-credential",
        "x-project-id": "other",
      },
    });
    assert.equal(wrongScope.status, 403);
  } finally {
    await server.close();
    if (previous.authToken === undefined) delete process.env.RELAY_AUTH_TOKEN;
    else process.env.RELAY_AUTH_TOKEN = previous.authToken;
    if (previous.redactionMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redactionMode;
  }
});

test("an exact static service token keeps its existing route scope alongside an external verifier", async () => {
  const previous = {
    redactionMode: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
  };
  process.env.RELAY_REDACTION_MODE = "on";
  process.env.RELAY_AUTH_ROLE = "author";
  process.env.RELAY_AUTH_ORGANIZATION_ID = "static-org";
  process.env.RELAY_AUTH_PROJECT_IDS = "static-project";
  const staticToken = "static-service-token-with-32-characters";
  const server = await startServer({
    host: "0.0.0.0",
    port: 0,
    token: staticToken,
    externalIdentityVerifier: externalVerifier(),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: {
        Authorization: `Bearer ${staticToken}`,
        "x-project-id": "static-project",
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      access: { role: string; organizationId: string; projectId: string };
    };
    assert.deepEqual(body.access, {
      role: "author",
      organizationId: "static-org",
      projectId: "static-project",
    });
  } finally {
    await server.close();
    if (previous.redactionMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redactionMode;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
  }
});

test("loopback retains local trust while an external bearer remains remotely scoped", async () => {
  const previousToken = process.env.RELAY_AUTH_TOKEN;
  delete process.env.RELAY_AUTH_TOKEN;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    externalIdentityVerifier: externalVerifier(),
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  try {
    const local = await fetch(`${baseUrl}/health`);
    assert.equal(local.status, 200);
    const localBody = (await local.json()) as {
      access: { role: string; organizationId: string; projectId: string };
    };
    assert.deepEqual(localBody.access, {
      role: "admin",
      organizationId: "local",
      projectId: "default",
    });

    const scoped = await fetch(`${baseUrl}/health`, {
      headers: {
        Authorization: "Bearer verified-opaque-credential",
        "x-project-id": "mobile",
      },
    });
    assert.equal(scoped.status, 200);
    const scopedBody = (await scoped.json()) as {
      access: { role: string; organizationId: string; projectId: string };
    };
    assert.deepEqual(scopedBody.access, {
      role: "viewer",
      organizationId: "acme",
      projectId: "mobile",
    });

    const localOnly = await fetch(`${baseUrl}/recipes`, {
      headers: {
        Authorization: "Bearer verified-opaque-credential",
        "x-project-id": "mobile",
      },
    });
    assert.equal(localOnly.status, 403);
  } finally {
    await server.close();
    if (previousToken === undefined) delete process.env.RELAY_AUTH_TOKEN;
    else process.env.RELAY_AUTH_TOKEN = previousToken;
  }
});
