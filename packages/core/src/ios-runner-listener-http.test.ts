import assert from "node:assert/strict";
import test from "node:test";
import { decodeIosRunnerReply, encodeIosRunnerCommand } from "./ios-runner-listener-http.js";

test("adopted commands authenticate in a header without altering their UTF-8 payload", () => {
  const command = { command: "clipboardPaste", text: "olá 👋" };
  const bytes = encodeIosRunnerCommand("fixture-private-token", command);
  const separator = bytes.indexOf("\r\n\r\n");
  const headers = bytes.subarray(0, separator).toString();
  const payload = bytes.subarray(separator + 4);
  assert.match(headers, /^POST \/command HTTP\/1\.1\r\n/u);
  assert.match(headers, /\r\nX-Agent-Device-Runner-Token: fixture-private-token\r\n/u);
  assert.equal(Number(headers.match(/Content-Length: (\d+)/u)?.[1]), payload.byteLength);
  assert.deepEqual(JSON.parse(payload.toString()), command);
  assert.ok(!payload.toString().includes("fixture-private-token"));
});

test("missing and unsafe credentials fail before any listener connection", () => {
  for (const token of [undefined, "", "a\r\nInjected: yes", "a b", "a".repeat(257)]) {
    assert.throws(() => encodeIosRunnerCommand(token, { command: "tap" }), /Reconnect the device/u);
  }
});

function reply(status: number, headers: string, payload: object) {
  return Buffer.from(`HTTP/1.1 ${status} Result\r\n${headers}\r\n\r\n${JSON.stringify(payload)}`);
}

test("a successful body cannot substitute for the runner authentication marker", () => {
  const payload = { ok: true, data: { nodes: [] } };
  for (const headers of [
    "Content-Type: application/json",
    "X-Agent-Device-Runner-Auth: optional",
    "X-Agent-Device-Runner-Auth: required\r\nX-Agent-Device-Runner-Auth: optional",
  ]) {
    assert.throws(() => decodeIosRunnerReply(reply(200, headers, payload)), /authentication/u);
  }
  for (const status of [401, 403]) {
    assert.throws(
      () => decodeIosRunnerReply(reply(status, "X-Agent-Device-Runner-Auth: required", payload)),
      /authentication/u,
    );
  }
  assert.deepEqual(
    decodeIosRunnerReply(reply(200, "x-agent-device-runner-auth: required", payload)),
    payload,
  );
});

test("authenticated busy responses retain their typed failure without a resend", () => {
  const payload = { ok: false, error: { code: "RUNNER_BUSY", message: "Still finishing" } };
  assert.deepEqual(
    decodeIosRunnerReply(reply(503, "X-Agent-Device-Runner-Auth: required", payload)),
    payload,
  );
});
