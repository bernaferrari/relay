import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  persistCapturedAuthoringObservation,
  rememberTargetApplication,
  runWithTargetContext,
  seedAuthoringRawRecording,
  type AuthoringRuntime,
  type CapturedAuthoringObservation,
} from "@relay/core";
import {
  deviceTestDouble,
  recordAuthoringInteraction,
  setLiveIosRunnerCommandPostForTests,
  type LiveIosRunnerCommand,
} from "@relay/core/testing";
import type { AuthoringObservation, AuthoringSession } from "@relay/protocol";
import { createAuthoringRuntime } from "./authoring-routes.js";

const appBundleId = "ai.x.GrokApp";
const copy = {
  type: "Button",
  label: "Copy",
  identifier: "message.copy",
  hittable: true,
  bundleId: appBundleId,
  rect: { x: 1012, y: 600, width: 44, height: 44 },
};

test("a recorded label wait reads the adopted iOS session without SDK find or input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-ios-recorded-wait-"));
  const serial = directory.split("/").at(-1)!;
  const context = { kind: "device", platform: "ios", serial } as const;
  const target = { kind: "device", platform: "ios", targetId: serial } as const;
  const previousLease = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = directory;
  process.env.RELAY_WORKSPACE_ROOT = directory;
  await writeFile(
    join(directory, `${serial}.json`),
    JSON.stringify({ runnerPid: process.pid, ownerPid: process.pid, port: 50937 }),
  );
  const observation: AuthoringObservation = {
    id: "old-before",
    capturedAt: 1,
    screen: { id: "old", fingerprint: "old", capturedAt: 1, source: "recording", deviceId: serial },
    evidenceIds: [],
  };
  const session: AuthoringSession = {
    schemaVersion: 1,
    id: "recorded-label-wait",
    organizationId: "org",
    projectId: "project",
    actorId: "human",
    actorKind: "human",
    appMapId: "map",
    originApplication: appBundleId,
    state: "recording",
    target,
    leaseId: "lease",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 1,
    take: {
      id: "take",
      state: "recording",
      createdAt: 1,
      updatedAt: 1,
      currentRevision: 1,
      revisions: [
        {
          id: "take:1",
          takeId: "take",
          revision: 1,
          createdAt: 1,
          createdBy: "human",
          reason: "recording",
          actions: [],
          evidence: [],
          observations: [observation],
          before: observation,
          after: observation,
        },
      ],
      replayAttempts: [],
      ...seedAuthoringRawRecording({ target, trigger: "recording", recordedAt: 1, observation }),
    },
  };
  const intentPath = join(directory, "intent.json");
  const commands: LiveIosRunnerCommand[] = [];
  const restorePost = setLiveIosRunnerCommandPostForTests(async (listener, command) => {
    assert.equal(listener.serial, serial);
    assert.equal(command.appBundleId, appBundleId);
    const durable = JSON.parse(await readFile(intentPath, "utf8")) as AuthoringSession;
    assert.equal(durable.take!.rawEvents!.at(-1)!.kind, "interaction-intent");
    commands.push(command);
    assert.equal(command.command, "querySelector");
    assert.equal(command.selectorKey, "label");
    assert.equal(command.selectorValue, "Copy");
    return { ok: true, data: { found: true, nodes: [copy] } };
  });
  const device = deviceTestDouble({
    interactions: {
      async find() {
        throw new Error(
          "iOS find requires an active app session on the target device. Run open first",
        );
      },
    },
    command: { wait: async () => assert.fail("visible Copy must not poll") },
    capture: { snapshot: async () => assert.fail("must read the same adopted listener") },
  });
  let clock = Date.now();
  let captures = 0;
  const runtime: AuthoringRuntime = {
    ...createAuthoringRuntime({}, { resolveDevice: async () => device }),
    settle: async () => {},
    async observe(): Promise<CapturedAuthoringObservation> {
      captures += 1;
      return {
        capturedAt: ++clock,
        targetId: serial,
        fingerprint: `fresh-${captures}`,
        foregroundApp: appBundleId,
        bounds: { width: 1112, height: 834 },
        nodes: [copy],
      };
    },
  };
  try {
    await rememberTargetApplication(appBundleId, context);
    const recorded = await runWithTargetContext(context, () =>
      recordAuthoringInteraction<CapturedAuthoringObservation>(
        session,
        {
          kind: "steps",
          label: "Wait for Copy",
          steps: [{ kind: "wait-for", target: { label: "Copy" }, timeoutMs: 120_000 }],
        },
        runtime,
        {
          now: () => ++clock,
          persistObservation: persistCapturedAuthoringObservation,
          persistEvidence: async () => {
            throw new Error("no video");
          },
          writeSession: (updated) => writeFile(intentPath, JSON.stringify(updated)),
          nextRevision(updated, reason, mutate) {
            const previous = updated.take!.revisions.at(-1)!;
            const revision = mutate(structuredClone(previous));
            revision.revision = previous.revision + 1;
            revision.reason = reason;
            revision.id = `take:${revision.revision}`;
            return {
              ...updated,
              take: {
                ...updated.take!,
                currentRevision: revision.revision,
                revisions: [...updated.take!.revisions, revision],
              },
            };
          },
        },
      ),
    );
    assert.equal(recorded.take!.revisions.at(-1)!.actions.length, 1);
    assert.equal(commands.length, 1);
    assert.equal(captures, 1);
    const after = recorded.take!.revisions.at(-1)!.after!;
    assert.equal(after.screen.fingerprint, "fresh-1");
    assert.equal(after.screen.deviceId, serial);
    assert.equal(after.nodes?.[0]?.label, "Copy");
    const outcome = recorded.take!.rawEvents!.at(-1)!;
    assert.equal(outcome.kind, "interaction-outcome");
    assert.equal(outcome.kind === "interaction-outcome" && outcome.outcome, "succeeded");
  } finally {
    restorePost();
    if (previousLease === undefined) delete process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR;
    else process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR = previousLease;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(directory, { recursive: true, force: true });
  }
});
