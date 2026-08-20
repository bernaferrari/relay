import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetDeviceClients, setLocalDeviceProvider, type Device } from "@relay/core";
import {
  defineIosMutationTerminalityRegistry,
  verifyIosMutationTerminalityRegistry,
  type IosMutationTerminalityTrace,
} from "@relay/protocol";
import { startServer } from "./index.js";

afterEach(() => {
  setLocalDeviceProvider(undefined);
  resetDeviceClients();
});

function pickerOptionNodes(): Array<Record<string, unknown>> {
  return [
    {
      depth: 0,
      type: "Application",
      label: "Settings",
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    ...["English", "Italiano", "Português (Brasil)"].map((label, index) => ({
      type: "Cell",
      label,
      hittable: true,
      rect: { x: 20, y: 120 + index * 52, width: 340, height: 44 },
    })),
  ];
}

function pickerDevice(
  onDispatch: (command: "entry-selector" | "picker-scroll") => void,
  outcome: "unknown" | "selector-miss",
): Device {
  return {
    capture: {
      snapshot: async () => ({
        nodes:
          outcome === "unknown"
            ? [
                {
                  type: "Button",
                  label: "Open picker",
                  hittable: true,
                  rect: { x: 20, y: 80, width: 180, height: 44 },
                },
              ]
            : pickerOptionNodes(),
      }),
    },
    command: {
      wait: async () => undefined,
    },
    interactions: {
      press: async () => {
        onDispatch("entry-selector");
        throw new Error(
          outcome === "unknown"
            ? "XCTest transport ended after dispatch"
            : "No matching element",
        );
      },
      pan: async () => {
        onDispatch("picker-scroll");
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

type SwitcherScanOperation = "switcher-profile.scan" | "language-profile.scan";
type SwitcherHttpOutcome = "unknown" | "selector-miss" | "validation";

function isSwitcherOutcomeUnknown(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    Boolean(
      error.body &&
        typeof error.body === "object" &&
        (error.body as { code?: unknown }).code === "IOS_MUTATION_OUTCOME_UNKNOWN",
    )
  );
}

function assertTerminalSwitcherPayload(error: ApiError, serial: string): void {
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
  assert.equal(body.switcherScan?.serial, serial);
}

function scanInput(operationId: SwitcherScanOperation, outcome: SwitcherHttpOutcome) {
  const common = {
    serial: "0123456789abcdef0123456789abcdef01234567",
    app: "com.example.picker",
    profileId: "grok-ios",
    save: false,
    openApp: false,
  };
  if (outcome === "validation") {
    return operationId === "switcher-profile.scan"
      ? { ...common, kind: "language", openApp: "not-a-boolean" }
      : { ...common, openApp: "not-a-boolean" };
  }
  const entryPath =
    outcome === "unknown"
      ? [{ kind: "tap", target: { label: "Open picker" } }]
      : [{ kind: "tap", target: { identifier: "optional.chrome" } }];
  return operationId === "switcher-profile.scan"
    ? {
        ...common,
        kind: "language",
        entryPath,
        pickerPath: [{ kind: "wait", ms: 1 }],
        maxScrolls: 1,
      }
    : {
        ...common,
        entryPath,
        languagePath: [{ kind: "wait", ms: 1 }],
        maxScrolls: 1,
      };
}

async function switcherHttpTrace(
  operationId: SwitcherScanOperation,
  outcome: SwitcherHttpOutcome,
): Promise<IosMutationTerminalityTrace> {
  const root = await mkdtemp(join(tmpdir(), "relay-switcher-route-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    state: process.env.RELAY_STATE_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");

  const nativeDispatches: string[] = [];
  if (outcome !== "validation") {
    setLocalDeviceProvider({
      kind: "device",
      create: () => pickerDevice((command) => nativeDispatches.push(command), outcome),
    });
  }

  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const client = clientFor(server.port);
  const input = scanInput(operationId, outcome);

  try {
    let result: unknown;
    try {
      result = await client.invoke(operationId, input as never);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (outcome === "unknown") {
        assertTerminalSwitcherPayload(error, input.serial);
        return { nativeDispatches, status: "terminal", error };
      }
      if (outcome === "validation") {
        assert.equal(error.status, 400);
        assert.notEqual((error.body as { code?: unknown }).code, "IOS_MUTATION_OUTCOME_UNKNOWN");
        return { nativeDispatches, status: "handled" };
      }
      throw error;
    }

    if (outcome === "selector-miss") {
      const scan = result as { optionsFound?: unknown; rowsFound?: unknown };
      assert.equal(scan.optionsFound ?? scan.rowsFound, 3);
      return { nativeDispatches, status: "recovered" };
    }
    throw new Error(`Expected ${outcome} operation to reject`);
  } finally {
    await server.close();
    setLocalDeviceProvider(undefined);
    resetDeviceClients();
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    await rm(root, { recursive: true, force: true });
  }
}

test("registered switcher HTTP operations preserve terminal review evidence", async () => {
  const registry = defineIosMutationTerminalityRegistry([
    {
      id: "server.switcher-profile.scan",
      unknown: async () => await switcherHttpTrace("switcher-profile.scan", "unknown"),
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => await switcherHttpTrace("switcher-profile.scan", "selector-miss"),
      },
    },
    {
      id: "server.language-profile.scan",
      unknown: async () => await switcherHttpTrace("language-profile.scan", "unknown"),
      recovery: {
        expectedStatus: "recovered",
        expectedNativeDispatches: 2,
        run: async () => await switcherHttpTrace("language-profile.scan", "selector-miss"),
      },
    },
  ]);

  await verifyIosMutationTerminalityRegistry(registry, { isOutcomeUnknown: isSwitcherOutcomeUnknown });
});

test("switcher scan validation failures stay ordinary HTTP errors", async () => {
  for (const operationId of ["switcher-profile.scan", "language-profile.scan"] as const) {
    const trace = await switcherHttpTrace(operationId, "validation");
    assert.equal(trace.status, "handled");
    assert.equal(trace.nativeDispatches.length, 0);
  }
});
