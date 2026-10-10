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

test("doctor defaults to the qa profile", async () => {
  const report = await runRelayMcpDoctor([], env, fakeFetch());
  assert.equal(report.ok, true);
  assert.equal(report.config.profile, "qa");
});

test("doctor validates the device surface without exposing credentials", async () => {
  const report = await runRelayMcpDoctor(["--profile", "device"], env, fakeFetch());

  assert.equal(report.ok, true);
  assert.equal(report.config.profile, "device");
  const profileCheck = report.checks.find(({ name }) => name === "profile");
  assert.equal(profileCheck?.ok, true);
  assert.match(profileCheck?.message ?? "", /device/u);
  const manifestCheck = report.checks.find(({ name }) => name === "proof-tools");
  assert.equal(manifestCheck?.ok, true);
  assert.match(manifestCheck?.message ?? "", /for profile device/u);
  assert.ok(report.checks.every(({ message }) => !message.includes("secret")));
  assert.match(formatRelayMcpDoctor(report), /Relay doctor: READY/u);
});

test("doctor validates the live Proof lifecycle under the full profile", async () => {
  const report = await runRelayMcpDoctor(["--profile", "full"], env, fakeFetch());

  assert.equal(report.ok, true);
  assert.deepEqual(report.config, {
    server: "http://relay.test:8787",
    organization: "org-test",
    project: "project-test",
    actor: "agent:codex",
    actorKind: "agent",
    profile: "full",
  });
  assert.deepEqual(
    report.proofTools,
    relayMcpToolsForProfile("full")
      .filter(({ operationId }) => operationId.startsWith("proof."))
      .map(({ name }) => name),
  );
  assert.match(formatRelayMcpDoctor(report), /Relay doctor: READY/u);
});

test("doctor fails clearly when the server is missing a canonical Proof operation", async () => {
  const report = await runRelayMcpDoctor(
    ["--profile", "full"],
    env,
    fakeFetch(["proof.rerun-affected"]),
  );

  assert.equal(report.ok, false);
  const proofCheck = report.checks.find(({ name }) => name === "proof-tools");
  assert.equal(proofCheck?.ok, false);
  assert.match(proofCheck?.message ?? "", /proof\.rerun-affected/u);
});

test("doctor fails when the device profile cannot tap, launch, or cancel", async () => {
  const report = await runRelayMcpDoctor(
    ["--profile", "device"],
    env,
    fakeFetch(["job.cancel", "target.interact", "target.app.launch"]),
  );
  assert.equal(report.ok, false);
  const tools = report.checks.find(({ name }) => name === "proof-tools");
  assert.equal(tools?.ok, false);
  assert.match(tools?.message ?? "", /job\.cancel/u);
  assert.match(tools?.message ?? "", /target\.interact/u);
  assert.match(tools?.message ?? "", /target\.app\.launch/u);
});

test("doctor validates qa honestly instead of demanding Proof", async () => {
  const report = await runRelayMcpDoctor(["--profile", "qa"], env, fakeFetch());

  assert.equal(report.config.profile, "qa");
  const profileCheck = report.checks.find(({ name }) => name === "profile");
  assert.equal(profileCheck?.ok, true);
  assert.match(profileCheck?.message ?? "", /--profile full/u);
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

test("QA doctor checks workflow dependencies and gives a concrete recovery step", async () => {
  const healthy = await runRelayMcpDoctor(["--profile", "qa"], env, fakeFetch());
  assert.equal(healthy.ok, true);
  const report = await runRelayMcpDoctor(
    ["--profile", "qa"],
    env,
    fakeFetch(["workflow.transition"]),
  );
  assert.equal(report.ok, false);
  assert.match(formatRelayMcpDoctor(report), /workflow.transition/u);
  assert.match(formatRelayMcpDoctor(report), /Next: Connect to a compatible Relay runtime/u);
  assert.doesNotMatch(formatRelayMcpDoctor(report), /Proof tools:/u);
});

test("QA doctor checks required roles rather than only read-only raw descriptors", async () => {
  const fixture = fakeFetch();
  const report = await runRelayMcpDoctor(["--profile", "qa"], env, async (input, init) => {
    if (String(input).endsWith("/health"))
      return response({
        ok: true,
        access: { role: "viewer", organizationId: "org-test", projectId: "project-test" },
      });
    return fixture(input, init);
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(({ name }) => name === "capabilities")?.ok, false);
});
