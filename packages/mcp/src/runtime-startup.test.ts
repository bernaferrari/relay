import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpConfig, redactedMcpConfig } from "./config.js";
import { prepareMcpRuntime } from "./runtime-startup.js";

const workspace = process.platform === "win32" ? "C:\\relay-tests" : "/tmp/relay-tests";
test("workspace startup is explicit and endpoint overrides stay attach-only", async () => {
  const forbidden = async () => {
    throw new Error("must not load runtime");
  };
  for (const config of [
    parseMcpConfig([], {}),
    parseMcpConfig(["--workspace", workspace, "--server", "https://relay.example"], {}),
    parseMcpConfig([], { RELAY_WORKSPACE_ROOT: workspace, RELAY_URL: "https://relay.example" }),
  ]) {
    assert.equal(await prepareMcpRuntime(config, forbidden), config);
  }
  assert.throws(() => parseMcpConfig(["--workspace", "relative/path"], {}), /absolute/u);
});
test("chosen workspace launches without changing actor, credential or scope", async () => {
  const config = parseMcpConfig(["--workspace", workspace, "--actor", "agent:participant"], {
    RELAY_AUTH_TOKEN: "private-test-token",
  });
  const result = await prepareMcpRuntime(config, async () => async (options) => {
    assert.deepEqual(options, { workspaceRoot: workspace, token: "private-test-token" });
    return { url: "http://127.0.0.1:8999" };
  });
  assert.deepEqual(result.connection, { ...config.connection, url: "http://127.0.0.1:8999" });
  assert.equal(redactedMcpConfig(result).workspace, workspace);
  assert.doesNotMatch(JSON.stringify(redactedMcpConfig(result)), /private-test-token/u);
});
test("startup errors and scope mismatch fail closed without a second attempt", async () => {
  let attempts = 0;
  const config = parseMcpConfig(["--workspace", workspace], {});
  await assert.rejects(
    prepareMcpRuntime(config, async () => async () => {
      attempts++;
      throw new Error("occupied listener");
    }),
    /occupied listener/u,
  );
  assert.equal(attempts, 1);
  await assert.rejects(
    prepareMcpRuntime(
      parseMcpConfig(["--workspace", workspace, "--project", "remote"], {}),
      async () => {
        throw new Error("must not load");
      },
    ),
    /authorized scoped service/u,
  );
});
