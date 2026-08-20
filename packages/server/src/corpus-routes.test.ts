import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetDeviceClients, setLocalDeviceProvider, type Device } from "@relay/core";
import { startServer } from "./index.js";

afterEach(() => {
  setLocalDeviceProvider(undefined);
  resetDeviceClients();
});

function ambiguousPickerDevice(onDispatch: () => void): Device {
  return {
    capture: {
      snapshot: async () => ({
        nodes: [
          {
            type: "Button",
            label: "Open picker",
            hittable: true,
            rect: { x: 20, y: 80, width: 180, height: 44 },
          },
        ],
      }),
    },
    command: {
      wait: async () => undefined,
    },
    interactions: {
      press: async () => {
        onDispatch();
        throw new Error("XCTest transport ended after dispatch");
      },
    },
  } as unknown as Device;
}

function clientFor(port: number): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "default",
    actorId: "agent:switcher-route-test",
    actorKind: "agent",
  });
}

test("switcher scan operations preserve an uncertain iOS command as terminal review evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-switcher-route-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    state: process.env.RELAY_STATE_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");

  let nativeDispatches = 0;
  setLocalDeviceProvider({
    kind: "device",
    create: () => ambiguousPickerDevice(() => nativeDispatches++),
  });

  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = clientFor(server.port);
  const common = {
    serial: "0123456789abcdef0123456789abcdef01234567",
    app: "com.example.picker",
    profileId: "grok-ios",
    save: false,
    openApp: false,
    entryPath: [{ kind: "tap", target: { label: "Open picker" } }],
  };

  try {
    for (const input of [
      {
        operationId: "switcher-profile.scan" as const,
        input: {
          ...common,
          kind: "language",
          pickerPath: [{ kind: "wait", ms: 1 }],
        },
      },
      {
        operationId: "language-profile.scan" as const,
        input: {
          ...common,
          languagePath: [{ kind: "wait", ms: 1 }],
        },
      },
    ]) {
      const before = nativeDispatches;
      await assert.rejects(
        client.invoke(input.operationId, input.input as never),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, 409, JSON.stringify(error.body));
          const body = error.body as {
            code?: unknown;
            iosMutation?: { nativeAttempts?: unknown; operation?: unknown; retry?: unknown };
            switcherScan?: {
              status?: unknown;
              phase?: unknown;
              serial?: unknown;
              repair?: { terminal?: unknown; nextAction?: unknown; blocked?: unknown };
            };
          };
          assert.equal(body.code, "IOS_MUTATION_OUTCOME_UNKNOWN");
          assert.equal(body.iosMutation?.operation, "press");
          assert.equal(body.iosMutation?.nativeAttempts, 1);
          assert.deepEqual(body.iosMutation?.retry, {
            attempts: 0,
            decision: "blocked",
            reason: "native-command-outcome-unknown",
          });
          assert.deepEqual(body.switcherScan?.repair, {
            terminal: true,
            nextAction: "capture-current-screen-before-any-retry",
            blocked: [
              "fallback-target",
              "retry-launch",
              "path-step",
              "next-scan-page",
              "second-scan-pass",
            ],
          });
          assert.equal(body.switcherScan?.status, "interrupted");
          assert.equal(body.switcherScan?.phase, "entry-path");
          assert.equal(body.switcherScan?.serial, common.serial);
          return true;
        },
      );
      // This must stay exact-once even though the public operation now exposes
      // the repair package. A 409 is a stop for inspection, never a retry cue.
      assert.equal(nativeDispatches - before, 1);
    }

    await assert.rejects(
      client.invoke("switcher-profile.scan", { serial: common.serial, app: common.app } as never),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.notEqual((error.body as { code?: unknown }).code, "IOS_MUTATION_OUTCOME_UNKNOWN");
        return true;
      },
    );
  } finally {
    await server.close();
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    await rm(root, { recursive: true, force: true });
  }
});
