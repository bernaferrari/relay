import test from "node:test";
import { queryIosSnapshotCatalogViaListener } from "./ios-snapshot-catalog.js";
import { emptyCatalogResult } from "./ios-snapshot-catalog.fixtures.js";

test("the actual Relay catalog producer pins the native decoder request fixture", async () => {
  const { assertProducedRunnerRequests } = await import(
    new URL(
      "../../../vendor/agent-device/packages/platform-apple/src/runner/runner-requests.fixtures.ts",
      import.meta.url,
    ).href
  );
  const captured: Array<readonly [string, unknown]> = [];
  await queryIosSnapshotCatalogViaListener(
    { serial: "fixture", port: 50937, runnerPid: process.pid },
    async (_listener, command) => {
      captured.push(["ios-device.selector-catalog.chrome", command]);
      return emptyCatalogResult(command);
    },
    { appBundleId: "com.example.app" },
    20_000,
  );
  assertProducedRunnerRequests(import.meta.filename, captured);
});
