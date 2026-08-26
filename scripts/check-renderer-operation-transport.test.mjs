import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  formatViolations,
  loadOperationDefinitions,
  pathPattern,
  scanRendererSource,
  scanRendererOperationTransport,
} from "./check-renderer-operation-transport.mjs";

test("path matching preserves dynamic template and encoded path parameters", () => {
  assert.equal(pathPattern("`/matrices/${encodeURIComponent(id)}/resolve`"), "/matrices/__DYNAMIC__/resolve");
  assert.equal(pathPattern("`/runs/${encodeURIComponent(runId)}/signals?${query}`"), "/runs/__DYNAMIC__/signals?__DYNAMIC__");
  assert.equal(pathPattern('"/matrices/" + encodeURIComponent(id)'), "/matrices/__DYNAMIC__");
});

test("the source guard catches resource, helper, and fetch calls without flagging unrelated resources", () => {
  const definitions = [
    { id: "matrix.delete", transport: { method: "DELETE", path: "/matrices/:matrixId" } },
    { id: "target.app.locales", transport: { method: "GET", path: "/device/app/locales" } },
  ];
  const source = [
    'client.resource(`/matrices/${encodeURIComponent(id)}`, { method: "DELETE" });',
    'request(`/device/app/locales?${query}`);',
    'fetch("/device/app/locales");',
    'fetch("/unregistered-read");',
  ].join("\n");
  assert.deepEqual(
    scanRendererSource("fixture.ts", source, definitions).map((item) => [item.kind, item.method]),
    [
      ["RelayClient.resource", "DELETE"],
      ["generic request helper", "GET"],
      ["raw fetch", "GET"],
    ],
  );
});

test("RelayClient.resource is restricted to explicit unregistered GET resources", () => {
  const definitions = [
    { id: "event.stream", transport: { method: "GET", path: "/events" } },
  ];
  const source = [
    'client.resource("/settings/devices/apple");',
    'client.resource("/events");',
    'client.resource("/new-endpoint");',
    'client.resource("/target-profiles", { method: "POST" });',
  ].join("\n");

  assert.deepEqual(
    scanRendererSource("fixture.ts", source, definitions).map((item) => [
      item.method,
      item.path,
      item.operations,
    ]),
    [
      ["GET", "/events", ["event.stream"]],
      ["GET", "/new-endpoint", []],
      ["POST", "/target-profiles", []],
    ],
  );
});

test("the production renderer scan derives registered operations at runtime", async () => {
  // The test is executed with the app package's TypeScript loader in the
  // focused command; this assertion prevents a silently empty registry from
  // making the guard vacuous if package resolution changes.
  const operationDefinitions = await loadOperationDefinitions();
  assert.ok(operationDefinitions.length > 0, "@relay/protocol operation registry is empty or unavailable");
  const violations = await scanRendererOperationTransport(operationDefinitions);
  if (violations.length) {
    assert.fail(
      `Current renderer violations (leave these visible until migrated):\n${formatViolations(violations).join("\n")}`,
    );
  }
});

test("the documented plain-node guard command boots through the local TypeScript loader", () => {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(process.execPath, ["scripts/check-renderer-operation-transport.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.doesNotMatch(output, /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|parameter property/u);
  assert.match(output, /Renderer operation transport guard (?:passed|found)/u);
  assert.ok(result.status === 0 || result.status === 1);
});
