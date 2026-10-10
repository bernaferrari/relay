import assert from "node:assert/strict";
import test from "node:test";
import { runMcp } from "./index.js";

for (const argv of [["--help"], ["-h"], ["help"], ["doctor", "--help"]]) {
  test(`${argv.join(" ")} explains agent setup before validating or starting a runtime`, async () => {
    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await runMcp(argv, {
        RELAY_CREDENTIAL_SOURCE: "env:UNSET_HELP_CREDENTIAL",
        RELAY_WORKSPACE_ROOT: "relative-invalid-workspace",
        RELAY_RUNTIME_PORT: "invalid-port",
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.match(output, /relay-mcp \[options\]/u);
    assert.match(output, /relay-mcp doctor/u);
    assert.match(output, /relay-mcp guide/u);
    assert.match(output, /--workspace/u);
    assert.match(output, /--server/u);
    assert.match(output, /relay_list_tests/u);
    assert.doesNotMatch(output, /UNSET_HELP_CREDENTIAL/u);
  });
}

test("guide help retains its offline task catalog", async () => {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await runMcp(["guide", "--help"], { RELAY_WORKSPACE_ROOT: "relative-invalid-workspace" });
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.match(output, /Task guides:/u);
  assert.match(output, /relay-mcp guide record/u);
  assert.doesNotMatch(output, /Serve MCP tools over stdio/u);
});
