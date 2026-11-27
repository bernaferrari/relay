import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { queryIosSnapshotCatalogViaListener } from "./ios-snapshot-catalog.js";
import { emptyCatalogResult } from "./ios-snapshot-catalog.fixtures.js";

const vendorRoot = fileURLToPath(new URL("../../../../vendor/agent-device/", import.meta.url));
const commandIdKeys = ["commandId", "statusCommandId"];

function wireRunnerRequest(sent: unknown): Record<string, unknown> {
  const request = JSON.parse(JSON.stringify(sent)) as Record<string, unknown>;
  for (const key of commandIdKeys) if (key in request) request[key] = "<commandId>";
  return request;
}

function runnerRequestFixture() {
  return JSON.parse(
    readFileSync(path.join(vendorRoot, "contracts/fixtures/runner-requests.json"), "utf8"),
  ) as Array<{ name: string; producer: string; request: Record<string, unknown> }>;
}

function assertProducedRunnerRequests(
  producerFile: string,
  captured: ReadonlyArray<readonly [name: string, sent: unknown]>,
): void {
  const producer = path.relative(vendorRoot, producerFile);
  const produced = captured
    .map(([name, sent]) => ({ name, producer, request: wireRunnerRequest(sent) }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  assert.deepEqual(
    produced,
    runnerRequestFixture().filter((entry) => entry.producer === producer),
  );
}

test("the actual Relay catalog producer pins the native decoder request fixture", async () => {
  const captured: Array<readonly [string, unknown]> = [];
  await queryIosSnapshotCatalogViaListener(
    {
      serial: "fixture",
      port: 50937,
      runnerToken: "relay-listener-fixture-token",
      runnerPid: process.pid,
    },
    async (_listener, command) => {
      captured.push(["ios-device.selector-catalog.chrome", command]);
      return emptyCatalogResult(command);
    },
    { appBundleId: "com.example.app" },
    20_000,
  );
  assertProducedRunnerRequests(import.meta.filename, captured);
});
