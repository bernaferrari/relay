import assert from "node:assert/strict";
import test from "node:test";
import { createRelayRecordingOutcomeJobs } from "./recording-outcome-jobs.js";
import { createRelayOperationPort, type RelayInvokeClient } from "./operation-port.js";
import { selectTarget } from "./target-catalog.js";

const phone = {
  id: "samsung",
  serial: "samsung",
  name: "Samsung",
  kind: "physical",
  platform: "android",
  booted: true,
};
const browser = {
  id: "unrelated-browser",
  serial: "unrelated-browser",
  name: "Browser",
  kind: "Managed browser",
  platform: "browser",
  booted: true,
};

function stalledBrowser() {
  const calls: string[] = [];
  const client: RelayInvokeClient = {
    async invoke(id) {
      calls.push(id);
      if (id === "target.devices.list") return { devices: [phone, browser] };
      if (id === "target.list")
        return {
          targets: [
            {
              id: browser.id,
              name: "Browser",
              kind: "browser",
              createdAt: 1,
              updatedAt: 1,
              browser: { startUrl: "https://example.test", headless: true },
            },
          ],
        };
      if (id === "target.preflight") return new Promise(() => {});
      throw new Error(`Unexpected ${id}`);
    },
  };
  return { client, calls };
}

async function settlesWithoutBrowser<T>(pending: Promise<T>): Promise<T> {
  const stuck = Symbol("unrelated browser blocked native discovery");
  const result = await Promise.race([
    pending,
    new Promise<typeof stuck>((resolve) => setImmediate(() => resolve(stuck))),
  ]);
  assert.notEqual(
    result,
    stuck,
    "Phone discovery must settle even if an unrelated browser never completes preflight",
  );
  return result as T;
}

test("Phone connect does not wait for an unrelated browser preflight", async () => {
  const { client, calls } = stalledBrowser();
  const jobs = createRelayRecordingOutcomeJobs(client, { actorId: "agent:test" });
  const intent = { kind: "connect-target" as const, targetKind: "device" as const };
  assert.deepEqual(await settlesWithoutBrowser(jobs.connect(intent)), {
    targets: [{ kind: "device", platform: "android", targetId: "samsung" }],
    current: { kind: "device", platform: "android", targetId: "samsung" },
  });
  assert.deepEqual(calls, ["target.devices.list"]);
});

test("recording an exact phone does not preflight unrelated browsers again", async () => {
  const { client, calls } = stalledBrowser();
  const result = await settlesWithoutBrowser(
    selectTarget(createRelayOperationPort(client), "samsung"),
  );
  assert.deepEqual(result, { kind: "device", platform: "android", targetId: "samsung" });
  assert.deepEqual(calls, ["target.devices.list"]);
});

test("device-only discovery still excludes an offline phone", async () => {
  const { client, calls } = stalledBrowser();
  const list = client.invoke.bind(client);
  client.invoke = async (id, input) =>
    id === "target.devices.list"
      ? { devices: [{ ...phone, connectionState: "offline" }, browser] }
      : list(id, input);
  const jobs = createRelayRecordingOutcomeJobs(client, { actorId: "agent:test" });
  assert.deepEqual(
    await settlesWithoutBrowser(jobs.connect({ kind: "connect-target", targetKind: "device" })),
    { targets: [] },
  );
  assert.deepEqual(calls, []);
  await assert.rejects(selectTarget(createRelayOperationPort(client), phone.id), /not ready/u);
});

function readyBrowser() {
  const calls: { id: string; input: unknown }[] = [];
  const client: RelayInvokeClient = {
    async invoke(id, input) {
      calls.push({ id, input });
      if (id === "target.devices.list")
        return {
          devices: [phone, browser, { ...browser, id: "other-browser", serial: "other-browser" }],
        };
      if (id === "target.list")
        return {
          targets: [browser.id, "other-browser"].map((id) => ({
            id,
            name: "Browser",
            kind: "browser",
            createdAt: 1,
            updatedAt: 1,
            browser: { startUrl: "https://example.test", headless: true },
          })),
        };
      if (id === "target.preflight")
        return {
          preflight: {
            targetId: (input as { targetId: string }).targetId,
            ok: true,
            checkedAt: 1,
            capabilities: ["snapshot", "screenshot", "recording"],
            checks: [],
          },
        };
      throw new Error(`Unexpected ${id}`);
    },
  };
  return { client, calls };
}

test("browser-only connect still preflights each browser and excludes phones", async () => {
  const { client, calls } = readyBrowser();
  const jobs = createRelayRecordingOutcomeJobs(client, { actorId: "agent:test" });
  const result = await jobs.connect({ kind: "connect-target", targetKind: "browser" });
  assert.equal(result.targets.length, 2);
  assert.ok(result.targets.every((target) => target.kind === "browser"));
  assert.deepEqual(
    calls.filter((call) => call.id === "target.preflight").map((call) => call.input),
    [{ targetId: browser.id }, { targetId: "other-browser" }],
  );
});

test("exact browser selection only preflights the selected browser", async () => {
  const { client, calls } = readyBrowser();
  const invoke = client.invoke.bind(client);
  client.invoke = async (id, input) =>
    id === "target.preflight" && (input as { targetId: string }).targetId === "other-browser"
      ? new Promise(() => {})
      : invoke(id, input);
  assert.deepEqual(
    await settlesWithoutBrowser(selectTarget(createRelayOperationPort(client), browser.id)),
    {
      kind: "browser",
      platform: "browser",
      targetId: browser.id,
    },
  );
  assert.equal(calls.filter((call) => call.id === "target.preflight").length, 1);
});

test("default connect continues to discover and preflight all target kinds", async () => {
  const { client, calls } = readyBrowser();
  const result = await createRelayRecordingOutcomeJobs(client, { actorId: "agent:test" }).connect();
  assert.equal(result.targets.length, 3);
  assert.equal(calls.filter((call) => call.id === "target.preflight").length, 2);
});

test("scoped browser connect does not make a failed preflight ready", async () => {
  const { client } = readyBrowser();
  const invoke = client.invoke.bind(client);
  client.invoke = async (id, input) =>
    id === "target.preflight"
      ? {
          preflight: {
            targetId: (input as { targetId: string }).targetId,
            ok: false,
            checkedAt: 1,
            capabilities: [],
            checks: [
              {
                id: "navigation",
                label: "Start page",
                status: "fail",
                message: "Navigation failed",
              },
            ],
          },
        }
      : invoke(id, input);
  const jobs = createRelayRecordingOutcomeJobs(client, { actorId: "agent:test" });
  assert.deepEqual(await jobs.connect({ kind: "connect-target", targetKind: "browser" }), {
    targets: [],
  });
  await assert.rejects(
    selectTarget(createRelayOperationPort(client), browser.id),
    /Navigation failed/u,
  );
  await assert.rejects(
    selectTarget(createRelayOperationPort(client), "missing"),
    /not a connected/u,
  );
});
