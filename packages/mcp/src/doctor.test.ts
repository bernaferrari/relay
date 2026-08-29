import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinitions } from "@relay/protocol";
import { relayMcpToolsForProfile } from "./tools.js";
import { formatRelayMcpDoctor, runRelayMcpDoctor } from "./doctor.js";

const env = {
  RELAY_URL: "http://relay.test:8787",
  RELAY_ORGANIZATION_ID: "org-test",
  RELAY_PROJECT_ID: "project-test",
  RELAY_ACTOR_ID: "agent:codex",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(missing: readonly string[] = []): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return response({
        ok: true,
        access: { role: "admin", organizationId: "org-test", projectId: "project-test" },
      });
    }
    if (url.endsWith("/meta")) {
      return response({
        operations: operationDefinitions
          .filter(({ id }) => !missing.includes(id))
          .map(({ id }) => ({ id })),
      });
    }
    return response({ error: "not found" }, 404);
  };
}

test("doctor validates the live Proof profile without exposing credentials", async () => {
  const report = await runRelayMcpDoctor([], env, fakeFetch());

  assert.equal(report.ok, true);
  assert.deepEqual(report.config, {
    server: "http://relay.test:8787",
    organization: "org-test",
    project: "project-test",
    actor: "agent:codex",
    actorKind: "agent",
    profile: "proof",
  });
  assert.deepEqual(
    report.proofTools,
    relayMcpToolsForProfile("proof")
      .filter(({ operationId }) => operationId.startsWith("proof."))
      .map(({ name }) => name),
  );
  assert.ok(report.checks.every(({ message }) => !message.includes("secret")));
  assert.match(formatRelayMcpDoctor(report), /Relay doctor: READY/u);
});

test("doctor fails clearly when the server is missing a canonical Proof operation", async () => {
  const report = await runRelayMcpDoctor([], env, fakeFetch(["proof.rerun-affected"]));

  assert.equal(report.ok, false);
  const proofCheck = report.checks.find(({ name }) => name === "proof-tools");
  assert.equal(proofCheck?.ok, false);
  assert.match(proofCheck?.message ?? "", /proof\.rerun-affected/u);
});

test("doctor rejects an agent profile that cannot expose the complete Proof surface", async () => {
  const report = await runRelayMcpDoctor(["--profile", "observe"], env, fakeFetch());

  assert.equal(report.ok, false);
  const profileCheck = report.checks.find(({ name }) => name === "profile");
  assert.equal(profileCheck?.ok, false);
  assert.match(profileCheck?.message ?? "", /--profile proof/u);
});

test("doctor reports unreachable Relay and does not leak bearer configuration", async () => {
  const report = await runRelayMcpDoctor(
    [],
    { ...env, RELAY_AUTH_TOKEN: "do-not-print" },
    async () => {
      throw new Error("network detail must remain private");
    },
  );

  assert.equal(report.ok, false);
  assert.match(
    report.checks.find(({ name }) => name === "reachability")?.message ?? "",
    /unreachable/u,
  );
  assert.doesNotMatch(JSON.stringify(report), /do-not-print/u);
  assert.doesNotMatch(JSON.stringify(report), /network detail/u);
});
