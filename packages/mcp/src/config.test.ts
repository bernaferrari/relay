import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpConfig, redactedMcpConfig } from "./config.js";

test("configuration uses arguments over environment over CLI-compatible defaults", () => {
  const config = parseMcpConfig(
    [
      "--server",
      "https://args.example",
      "--organization=args-org",
      "--project",
      "args-project",
      "--actor",
      "agent:explicit",
      "--timeout",
      "321",
      "--profile",
      "review",
    ],
    {
      RELAY_URL: "https://env.example",
      RELAY_ORGANIZATION_ID: "env-org",
      RELAY_PROJECT_ID: "env-project",
      RELAY_ACTOR_ID: "agent:env",
      RELAY_TIMEOUT_MS: "999",
      RELAY_MCP_PROFILE: "execute",
    },
    42,
  );

  assert.equal(config.connection.url, "https://args.example");
  assert.equal(config.connection.organizationId, "args-org");
  assert.equal(config.connection.projectId, "args-project");
  assert.equal(config.connection.actorId, "agent:explicit");
  assert.equal(config.connection.actorKind, "agent");
  assert.equal(config.timeoutMs, 321);
  assert.equal(config.profile, "review");

  const defaults = parseMcpConfig([], {}, 42);
  assert.equal(defaults.connection.url, "http://127.0.0.1:8787");
  assert.equal(defaults.connection.organizationId, "local");
  assert.equal(defaults.connection.projectId, "default");
  assert.equal(defaults.connection.actorId, "agent:mcp:42");
  assert.equal(defaults.connection.actorKind, "agent");
  assert.equal(defaults.profile, "outcome");
  assert.equal(defaults.timeoutMs, 180000);
});

test("explicit actor IDs remain agent actors", () => {
  const config = parseMcpConfig(["--actor", "human:operator"], {}, 42);

  assert.equal(config.connection.actorId, "human:operator");
  assert.equal(config.connection.actorKind, "agent");
});

test("credential source reads a named environment variable without exposing it", () => {
  const secret = "super-secret-token";
  const config = parseMcpConfig(
    ["--credential-source", "env:MY_RELAY_TOKEN"],
    { MY_RELAY_TOKEN: secret },
    42,
  );

  assert.deepEqual(config.connection.auth, { type: "bearer", token: secret });
  const rendered = JSON.stringify(redactedMcpConfig(config));
  assert.doesNotMatch(rendered, /super-secret-token/);
  assert.match(rendered, /env:MY_RELAY_TOKEN/);
  assert.match(rendered, /configured/);
  assert.match(rendered, /outcome/);
});

test("credential validation matches CLI semantics", () => {
  assert.throws(
    () => parseMcpConfig(["--credential-source", "env:MISSING"], {}, 42),
    /MISSING is not set/,
  );
  assert.throws(
    () => parseMcpConfig([], { RELAY_CREDENTIAL_SOURCE: "env:MISSING_FROM_ENV" }, 42),
    /MISSING_FROM_ENV is not set/,
  );

  const defaultCredential = parseMcpConfig([], {}, 42);
  assert.deepEqual(defaultCredential.credentialSource, {
    type: "env",
    name: "RELAY_AUTH_TOKEN",
  });
  assert.deepEqual(defaultCredential.connection.auth, { type: "none" });

  const noCredential = parseMcpConfig(["--credential-source", "none"], {}, 42);
  assert.deepEqual(noCredential.connection.auth, { type: "none" });
});

test("invalid options and timeouts are rejected before stdio starts", () => {
  assert.throws(() => parseMcpConfig(["unexpected"], {}, 42), /Unknown option/);
  assert.throws(() => parseMcpConfig(["--timeout", "0"], {}, 42), /positive integer/);
  assert.throws(() => parseMcpConfig(["--project"], {}, 42), /requires a value/);
  assert.throws(() => parseMcpConfig(["--profile", "everything"], {}, 42), /profile must be/);
});

test("profile selection supports environment configuration", () => {
  assert.equal(parseMcpConfig([], { RELAY_MCP_PROFILE: "observe" }, 42).profile, "observe");
  assert.equal(
    parseMcpConfig(["--profile", "full"], { RELAY_MCP_PROFILE: "observe" }, 42).profile,
    "full",
  );
});
