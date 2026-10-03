import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSession, DurableWorkflowRead } from "@relay/protocol";
import type { RelayInvokeClient } from "@relay/workflows/operation-port";
import { listProductRecordingDrafts } from "./recording-drafts.js";

function session(id: string, changes: Partial<AuthoringSession> = {}): AuthoringSession {
  return {
    schemaVersion: 1,
    id,
    organizationId: "local",
    projectId: "default",
    actorId: "human:one",
    actorKind: "human",
    appMapId: "shop",
    state: "reviewing",
    testName: `Review ${id}`,
    target: { kind: "browser", platform: "browser", targetId: "browser-one" },
    leaseId: "lease-one",
    expectedAppMapRevision: 1,
    createdAt: 1,
    updatedAt: 2,
    workflowMutation: {
      workflowId: `wf-${id}`,
      action: "authoring-stop",
      transitionVersion: 3,
      completedAt: 2,
    },
    ...changes,
  };
}

function workflow(
  value: AuthoringSession,
  changes: Partial<DurableWorkflowRead["record"]> = {},
): DurableWorkflowRead {
  return {
    record: {
      schemaVersion: 1,
      workflowId: `wf-${value.id}`,
      organizationId: "local",
      projectId: "default",
      kind: "author-test",
      version: 3,
      status: "active",
      frozenIdentity: {},
      resource: { kind: "authoring-session", id: value.id },
      createdBy: value.actorId,
      lastActorId: value.actorId,
      createdAt: 1,
      updatedAt: 2,
      expiresAt: 1_000_000,
      lastTransition: "authoring-stop",
      ...changes,
    },
    audit: [],
  };
}

function clientFor(
  sessions: AuthoringSession[],
  records: Record<string, DurableWorkflowRead>,
): { client: RelayInvokeClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async invoke(id, input) {
        calls.push(id);
        if (id === "authoring.session.list") {
          assert.deepEqual(input, { includeHistory: true, latestRevisionOnly: true });
          return { sessions };
        }
        if (id === "workflow.get") {
          const value = records[(input as { workflowId: string }).workflowId];
          if (!value) throw new Error("Recording lookup unavailable");
          return { workflow: value };
        }
        throw new Error(`Unexpected operation ${id}`);
      },
    },
  };
}

test("finds multiple reviews using exact durable handles, independently of the active pointer", async () => {
  const first = session("first", { updatedAt: 10 });
  const second = session("second", { updatedAt: 20 });
  const { client, calls } = clientFor([first, second], {
    "wf-first": workflow(first),
    "wf-second": workflow(second),
  });
  const drafts = await listProductRecordingDrafts({ client, actorId: "human:one" });
  assert.deepEqual(
    drafts.map((draft) => [draft.workflowId, draft.name]),
    [
      ["wf-second", "Review second"],
      ["wf-first", "Review first"],
    ],
  );
  assert.deepEqual(calls.sort(), ["authoring.session.list", "workflow.get", "workflow.get"]);
});

test("excludes other actors, archived or legacy reviews and terminal workflows, but includes explicitly adopted work", async () => {
  const other = session("other", { actorId: "human:other" });
  const adopted = session("adopted");
  const terminal = session("terminal");
  const archived = session("archived", { archive: { reason: "superseded", archivedAt: 2 } });
  const legacy = session("legacy", { workflowMutation: undefined });
  const { client, calls } = clientFor([other, adopted, terminal, archived, legacy], {
    "wf-other": workflow(other),
    "wf-adopted": workflow(adopted, { createdBy: "human:other", lastActorId: "human:one" }),
    "wf-terminal": workflow(terminal, { status: "terminal" }),
  });
  assert.deepEqual(
    (await listProductRecordingDrafts({ client, actorId: "human:one" })).map(
      (draft) => draft.workflowId,
    ),
    ["wf-adopted"],
  );
  assert.equal(calls.filter((id) => id === "workflow.get").length, 2);
});

test("fails visibly on mismatched resources or a failed canonical lookup instead of claiming no drafts", async () => {
  const value = session("one");
  const mismatch = clientFor([value], {
    "wf-one": workflow(value, { resource: { kind: "authoring-session", id: "different" } }),
  });
  await assert.rejects(
    listProductRecordingDrafts({ client: mismatch.client, actorId: "human:one" }),
    /matched to its review/,
  );
  await assert.rejects(
    listProductRecordingDrafts({ client: clientFor([value], {}).client, actorId: "human:one" }),
    /lookup unavailable/,
  );
});
