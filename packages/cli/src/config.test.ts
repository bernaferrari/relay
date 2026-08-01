import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, redactedConfig } from "./config.js";

test("global configuration uses CLI over environment over defaults", () => {
  const parsed = parseCli(
    [
      "operation",
      "invoke",
      "system.health.get",
      "--input",
      "{}",
      "--server",
      "https://cli.example",
      "--organization=cli-org",
      "--project",
      "cli-project",
      "--actor",
      "agent:cli",
      "--timeout",
      "321",
      "--no-wait",
    ],
    {
      RELAY_URL: "https://env.example",
      RELAY_ORGANIZATION_ID: "env-org",
      RELAY_PROJECT_ID: "env-project",
      RELAY_ACTOR_ID: "human:env",
      RELAY_TIMEOUT_MS: "999",
      RELAY_WAIT: "true",
    },
  );

  assert.equal(parsed.config.connection.url, "https://cli.example");
  assert.equal(parsed.config.connection.organizationId, "cli-org");
  assert.equal(parsed.config.connection.projectId, "cli-project");
  assert.equal(parsed.config.connection.actorId, "agent:cli");
  assert.equal(parsed.config.connection.actorKind, "agent");
  assert.equal(parsed.config.timeoutMs, 321);
  assert.equal(parsed.config.wait, false);

  const fromEnvironment = parseCli(["operation", "invoke", "system.health.get", "--input", "{}"], {
    RELAY_URL: "https://env.example",
    RELAY_PROJECT_ID: "env-project",
  });
  assert.equal(fromEnvironment.config.connection.url, "https://env.example");
  assert.equal(fromEnvironment.config.connection.projectId, "env-project");
  assert.equal(fromEnvironment.config.connection.organizationId, "local");
});

test("credential source reads a named environment variable and redacts its value", () => {
  const secret = "super-secret-token";
  const parsed = parseCli(
    [
      "operation",
      "invoke",
      "system.health.get",
      "--input",
      "{}",
      "--credential-source",
      "env:MY_RELAY_TOKEN",
    ],
    { MY_RELAY_TOKEN: secret },
  );

  assert.deepEqual(parsed.config.connection.auth, { type: "bearer", token: secret });
  const rendered = JSON.stringify(redactedConfig(parsed.config));
  assert.doesNotMatch(rendered, /super-secret-token/);
  assert.match(rendered, /env:MY_RELAY_TOKEN/);
  assert.match(rendered, /configured/);
});

test("an explicitly selected environment credential must exist", () => {
  assert.throws(
    () =>
      parseCli(
        [
          "operation",
          "invoke",
          "system.health.get",
          "--input",
          "{}",
          "--credential-source",
          "env:MISSING_TOKEN",
        ],
        {},
      ),
    /MISSING_TOKEN is not set/,
  );
  assert.throws(
    () =>
      parseCli(["operation", "invoke", "system.health.get", "--input", "{}"], {
        RELAY_CREDENTIAL_SOURCE: "env:MISSING_FROM_ENV",
      }),
    /MISSING_FROM_ENV is not set/,
  );
});

test("the absent default credential source remains unauthenticated", () => {
  const parsed = parseCli(["operation", "invoke", "system.health.get", "--input", "{}"], {});

  assert.deepEqual(parsed.config.credentialSource, {
    type: "env",
    name: "RELAY_AUTH_TOKEN",
  });
  assert.deepEqual(parsed.config.connection.auth, { type: "none" });
});

test("--help and -h are accepted as global switches", () => {
  assert.equal(parseCli(["--help"], {}).command, "help");
  assert.equal(parseCli(["-h"], {}).command, "help");
  assert.equal(parseCli(["operation", "--help"], {}).command, "help");
  assert.equal(parseCli(["operation", "-h"], {}).command, "help");
});

test("machine output modes and wait switches reject ambiguous combinations", () => {
  assert.throws(() => parseCli(["help", "--json", "--ndjson"], {}), /only one/);
  assert.throws(() => parseCli(["help", "--wait", "--no-wait"], {}), /only one/);
});
