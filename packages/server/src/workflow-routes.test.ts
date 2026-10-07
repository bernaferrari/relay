import { InputNotDispatchedError } from "@relay/core";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  readDurableWorkflow,
  resetControlDatabaseCache,
  transitionDurableWorkflow,
  currentOperationContext,
  type TestJob,
} from "@relay/core";
import { parseAuthoringSession, type AuthoringSession } from "@relay/protocol";
import { authoringInputReceiptOutcome } from "@relay/workflows";
import { startServer } from "./index.js";
import type { WorkflowRouteRuntime } from "./workflow-routes.js";

const project = { organizationId: "acme", projectId: "mobile" };

function client(port: number, actorId: string, projectId = project.projectId): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: project.organizationId,
    projectId,
    actorId,
    actorKind: "agent",
  });
}

function frozen(requestId = "run-request-1") {
  return {
    appMapId: "settings",
    appMapRevision: 7,
    testId: "smoke",
    planDigest: "compiled-plan",
    workflowRequestId: requestId,
    target: { kind: "device", platform: "android", targetId: "pixel-9" },
  } as const;
}

function runJob(id = "job-1", status = "running", requestId = "run-request-1"): TestJob {
  return {
    id,
    action: "app-map.test.run",
    status,
    queuedAt: 100,
    projectId: project.projectId,
    ownerId: "agent:first",
    serial: "pixel-9",
    platform: "android",
    artifacts: [
      {
        kind: "app-map-test-workflow-request",
        capturedAt: 100,
        data: { schemaVersion: 1, requestId },
      },
      {
        kind: "app-map-test-execution-intent",
        capturedAt: 100,
        data: {
          sourcePlan: {
            appMapId: "settings",
            appMapRevision: 7,
            testId: "smoke",
            rootRecipeId: "open-settings",
            digest: "server-plan",
          },
        },
      },
    ],
  } as TestJob;
}

function frozenAuthor(requestId = "author-request-1") {
  return {
    title: "Settings localization",
    originApplication: "com.android.settings",
    actorId: "agent:first",
    appMapId: "settings",
    appMapRevision: 7,
    workflowRequestId: requestId,
    target: { kind: "device", platform: "android", targetId: "pixel-9" },
  } as const;
}

function nativeRunJob(id: string, requestId: string, profileId = "current-native-setup"): TestJob {
  const job = runJob(id, "running", requestId);
  const execution = job.artifacts.find((item) => item.kind === "app-map-test-execution-intent")!
    .data as Record<string, unknown>;
  const profile = {
    id: profileId,
    targetId: "pixel-9",
    platform: "android",
    viewport: { width: 1080, height: 2400 },
  };
  execution.plan = { rawAccessibilityTargetProfiles: [profile] };
  execution.selectedRuntimeTargetProfile = profile;
  return job;
}

async function withServer(
  operation: (input: {
    port: number;
    runtime: WorkflowRouteRuntime;
    jobs: Map<string, TestJob>;
    cancelCalls: string[];
    targetControlCalls: string[];
    authoringSessions: Map<string, AuthoringSession>;
    authoringTransitionCalls: string[];
    restart: () => Promise<number>;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-workflow-routes-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const jobs = new Map<string, TestJob>();
  const cancelCalls: string[] = [];
  const targetControlCalls: string[] = [];
  const authoring = new Map<string, AuthoringSession>();
  const authoringTransitionCalls: string[] = [];
  let clock = 1_000;
  const runtime: WorkflowRouteRuntime = {
    now: () => clock++,
    getJob: (id) => jobs.get(id),
    listJobs: (limit = 100) => [...jobs.values()].slice(-limit),
    cancelJob: (id) => {
      cancelCalls.push(id);
      const current = jobs.get(id);
      if (!current) throw new Error("Unknown job");
      const cancelled = { ...current, status: "cancelled", finishedAt: clock++ } as TestJob;
      jobs.set(id, cancelled);
      return cancelled;
    },
    assertTargetControl: async (_scope, targetId) => {
      targetControlCalls.push(targetId ?? "");
      return {} as never;
    },
    transitionWorkflow: transitionDurableWorkflow,
    getAuthoringSession: async (id) => {
      const session = authoring.get(id);
      if (!session) throw new Error("No Authoring Session");
      return structuredClone(session);
    },
    listAuthoringSessions: async () => [...authoring.values()].map((item) => structuredClone(item)),
    beginAuthoringSession: async (_scope, value) => {
      const actorId = currentOperationContext()?.actorId ?? "unknown";
      const session = {
        schemaVersion: 1,
        id: `authoring-${authoring.size + 1}`,
        organizationId: project.organizationId,
        projectId: project.projectId,
        actorId,
        actorKind: "agent",
        appMapId: value.appMapId,
        workflowRequestId: value.workflowRequestId,
        testName: value.testName,
        originApplication: value.originApplication,
        state: "recording",
        target: value.target,
        captureProvenance: {
          schemaVersion: 1,
          mode: "control-and-record",
          origin: "relay-control",
        },
        leaseId: value.leaseId,
        expectedAppMapRevision: value.expectedAppMapRevision,
        createdAt: clock,
        updatedAt: clock,
      } as AuthoringSession;
      authoring.set(session.id, session);
      return structuredClone(session);
    },
    assertAuthoringStartAccess: async () => undefined,
    assertAuthoringAccess: async () => undefined,
    transitionAuthoringSession: async (_scope, id, input, _runtime, workflowMutation) => {
      authoringTransitionCalls.push(input.action);
      const session = authoring.get(id);
      if (!session) throw new Error("No Authoring Session");
      const next = structuredClone(session);
      if (workflowMutation) next.workflowMutation = workflowMutation;
      next.updatedAt = clock++;
      if (input.action === "authoring-stop") next.state = "reviewing";
      if (input.action === "authoring-approve") {
        if (input.testName) next.testName = input.testName;
        next.state = "committed";
        next.expectedAppMapRevision += 1;
        next.committedConnectionId = "connection-1";
        next.committedTestId = "test-1";
      }
      if (input.action === "authoring-discard") {
        next.archive = { reason: "discarded", archivedAt: clock++ };
      }
      if (input.action === "authoring-cancel") next.state = "cancelled";
      authoring.set(id, next);
      return structuredClone(next);
    },
    readRepeatCampaign: async () => null,
    findRepeatCampaignsByWorkflow: async () => [],
    projectRepeatCampaign: async (campaign) => campaign,
  };
  let server = await startServer({
    host: "127.0.0.1",
    port: 0,
    workflowRouteRuntime: runtime,
  });
  try {
    await operation({
      port: server.port,
      runtime,
      jobs,
      cancelCalls,
      targetControlCalls,
      authoringSessions: authoring,
      authoringTransitionCalls,
      restart: async () => {
        await server.close();
        resetControlDatabaseCache();
        server = await startServer({
          host: "127.0.0.1",
          port: 0,
          workflowRouteRuntime: runtime,
        });
        return server.port;
      },
    });
  } finally {
    await server.close().catch(() => undefined);
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("request identity is durable across restart and project scope remains authority", async () => {
  await withServer(async ({ port, jobs, restart }) => {
    const first = client(port, "agent:first");
    const created = await first.invoke(
      "workflow.create",
      { kind: "run-test", frozenIdentity: frozen(), expiresAt: 50_000 },
      { requestId: "workflow-request-1" },
    );
    assert.equal(created.disposition, "created");
    const workflowId = created.workflow.record.workflowId;
    assert.notEqual(workflowId, "workflow-request-1");

    const replayed = await client(port, "agent:second").invoke(
      "workflow.create",
      { kind: "run-test", frozenIdentity: frozen(), expiresAt: 50_000 },
      { requestId: "workflow-request-1" },
    );
    assert.equal(replayed.disposition, "existing");
    await assert.rejects(
      first.invoke(
        "workflow.create",
        { kind: "run-test", frozenIdentity: { ...frozen(), testId: "other" } },
        { requestId: "workflow-request-1" },
      ),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );

    jobs.set("job-1", runJob());
    const attached = await first.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "attach-run",
      jobId: "job-1",
    });
    assert.equal(attached.workflow.record.version, 2);
    assert.equal(
      (attached.workflow.record.frozenIdentity as ReturnType<typeof frozen>).planDigest,
      "server-plan",
    );
    const afterAttachReplay = await first.invoke(
      "workflow.create",
      { kind: "run-test", frozenIdentity: frozen(), expiresAt: 50_000 },
      { requestId: "workflow-request-1" },
    );
    assert.equal(afterAttachReplay.disposition, "existing");
    assert.equal(afterAttachReplay.workflow.record.version, 2);

    const otherProjectReservation = await client(port, "agent:reader", "other").invoke(
      "workflow.create",
      { kind: "run-test", frozenIdentity: frozen(), expiresAt: 50_000 },
      { requestId: "workflow-request-1" },
    );
    assert.equal(otherProjectReservation.disposition, "created");
    assert.notEqual(otherProjectReservation.workflow.record.workflowId, workflowId);

    const sameProject = await client(port, "agent:reader").invoke("workflow.get", {
      workflowId,
    });
    assert.equal(sameProject.job?.id, "job-1");
    await assert.rejects(
      client(port, "agent:reader", "other").invoke("workflow.get", {
        workflowId,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );

    const restartedPort = await restart();
    const restored = await client(restartedPort, "agent:reader").invoke("workflow.get", {
      workflowId,
    });
    assert.equal(restored.workflow.record.version, 2);
    assert.deepEqual(
      restored.workflow.audit.map((event) => event.transition),
      ["created", "run-attached"],
    );
  });
});

test("native automatic attach and uncertain-run reconciliation freeze the canonical selected setup", async () => {
  await withServer(async ({ port, jobs }) => {
    const runner = client(port, "agent:first");
    for (const reconcile of [false, true]) {
      const requestId = `native-profile-${reconcile}`;
      const created = await runner.invoke("workflow.create", {
        workflowId: requestId,
        kind: "run-test",
        frozenIdentity: frozen(requestId),
        expiresAt: 50_000,
      });
      const job = nativeRunJob(`native-job-${reconcile}`, requestId);
      jobs.set(job.id, job);
      const attached = reconcile
        ? await runner.invoke("workflow.get", { workflowId: created.workflow.record.workflowId })
        : await runner.invoke("workflow.transition", {
            workflowId: created.workflow.record.workflowId,
            expectedVersion: 1,
            action: "attach-run",
            jobId: job.id,
          });
      const identity = attached.workflow.record.frozenIdentity as Record<string, unknown>;
      assert.equal(identity.targetProfileId, "current-native-setup");
      assert.equal(identity.planDigest, "server-plan");
      assert.equal(identity.rootRecipeId, "open-settings");
      assert.equal(attached.job?.id, job.id);
    }
  });
});

test("native attach rejects missing, malformed, foreign or explicitly different selected profiles", async () => {
  await withServer(async ({ port, jobs }) => {
    const runner = client(port, "agent:first");
    const profiles = [
      undefined,
      { id: "current-native-setup", targetId: "other-device", platform: "android" },
      { id: "current-native-setup", targetId: "pixel-9", platform: "ios" },
      {
        id: "current-native-setup",
        targetId: "pixel-9",
        platform: "android",
        viewport: { width: 0, height: 2400 },
      },
      { id: "different-setup", targetId: "pixel-9", platform: "android" },
    ];
    for (const [index, profile] of profiles.entries()) {
      const requestId = `invalid-profile-${index}`;
      const created = await runner.invoke("workflow.create", {
        workflowId: requestId,
        kind: "run-test",
        frozenIdentity: {
          ...frozen(requestId),
          ...(index === 4 ? { targetProfileId: "explicit-setup" } : {}),
        },
        expiresAt: 50_000,
      });
      const job = nativeRunJob(`invalid-native-job-${index}`, requestId);
      const execution = job.artifacts.find((item) => item.kind === "app-map-test-execution-intent")!
        .data as Record<string, unknown>;
      execution.selectedRuntimeTargetProfile = profile;
      jobs.set(job.id, job);
      await assert.rejects(
        runner.invoke("workflow.transition", {
          workflowId: created.workflow.record.workflowId,
          expectedVersion: 1,
          action: "attach-run",
          jobId: job.id,
        }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
      const inspected = await runner.invoke("workflow.get", {
        workflowId: created.workflow.record.workflowId,
      });
      assert.equal(inspected.workflow.record.resource, undefined);
      assert.equal(inspected.job, undefined);
      assert.equal(inspected.workflow.record.version, 1);
    }
  });
});

test("only a fresh unattached Run reservation can be abandoned", async () => {
  await withServer(async ({ port, jobs }) => {
    const runner = client(port, "agent:first");
    const fresh = await runner.invoke("workflow.create", {
      workflowId: "rejected-before-dispatch",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    const abandoned = await runner.invoke("workflow.transition", {
      workflowId: fresh.workflow.record.workflowId,
      expectedVersion: fresh.workflow.record.version,
      action: "abandon-run",
      reason: "Target profile is unavailable",
    });
    assert.equal(abandoned.workflow.record.status, "terminal");
    assert.equal(abandoned.workflow.record.resolution?.kind, "abandoned");

    jobs.set("job-1", runJob());
    const attached = await runner.invoke("workflow.create", {
      workflowId: "already-dispatched",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    const withJob = await runner.invoke("workflow.transition", {
      workflowId: attached.workflow.record.workflowId,
      expectedVersion: attached.workflow.record.version,
      action: "attach-run",
      jobId: "job-1",
    });
    await assert.rejects(
      runner.invoke("workflow.transition", {
        workflowId: withJob.workflow.record.workflowId,
        expectedVersion: withJob.workflow.record.version,
        action: "abandon-run",
        reason: "Do not detach a canonical job",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    const canonical = await runner.invoke("workflow.get", {
      workflowId: withJob.workflow.record.workflowId,
    });
    assert.equal(canonical.workflow.record.status, "active");
    assert.deepEqual(canonical.workflow.record.resource, { kind: "job", id: "job-1" });
  });
});

test("stale cancellation never reaches mutation and an accepted cancellation runs once", async () => {
  await withServer(async ({ port, jobs, cancelCalls, targetControlCalls }) => {
    jobs.set("job-1", runJob());
    const runner = client(port, "agent:first");
    const created = await runner.invoke("workflow.create", {
      workflowId: "cancel-workflow",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    const workflowId = created.workflow.record.workflowId;
    await runner.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "attach-run",
      jobId: "job-1",
    });
    await assert.rejects(
      runner.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 1,
        action: "cancel-run",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(cancelCalls, []);

    const cancelled = await runner.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 2,
      action: "cancel-run",
    });
    assert.deepEqual(cancelCalls, ["job-1"]);
    assert.deepEqual(targetControlCalls, ["pixel-9"]);
    assert.equal(cancelled.workflow.record.version, 4);
    assert.equal(cancelled.workflow.record.status, "terminal");
    assert.deepEqual(
      cancelled.workflow.audit.map((event) => event.transition),
      ["created", "run-attached", "cancel-requested", "run-cancelled"],
    );
    await assert.rejects(
      runner.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 2,
        action: "cancel-run",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(cancelCalls, ["job-1"]);
  });
});

test("unknown and crash-boundary cancellation states are reconciliation-only", async () => {
  await withServer(async ({ port, jobs, cancelCalls, runtime }) => {
    jobs.set("job-1", runJob());
    const runner = client(port, "agent:first");
    const uncertainCreated = await runner.invoke("workflow.create", {
      workflowId: "unknown-cancel",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    const uncertainWorkflowId = uncertainCreated.workflow.record.workflowId;
    await runner.invoke("workflow.transition", {
      workflowId: uncertainWorkflowId,
      expectedVersion: 1,
      action: "attach-run",
      jobId: "job-1",
    });
    runtime.cancelJob = (id) => {
      cancelCalls.push(id);
      throw new Error("response lost after dispatch");
    };
    await assert.rejects(
      runner.invoke("workflow.transition", {
        workflowId: uncertainWorkflowId,
        expectedVersion: 2,
        action: "cancel-run",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    const uncertain = await runner.invoke("workflow.get", { workflowId: uncertainWorkflowId });
    assert.equal(uncertain.workflow.record.lastTransition, "cancel-outcome-unknown");
    await assert.rejects(
      runner.invoke("workflow.transition", {
        workflowId: uncertainWorkflowId,
        expectedVersion: uncertain.workflow.record.version,
        action: "cancel-run",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(cancelCalls, ["job-1"]);

    jobs.set("job-crash", runJob("job-crash"));
    const crashCreated = await runner.invoke("workflow.create", {
      workflowId: "crash-cancel",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    const crashWorkflowId = crashCreated.workflow.record.workflowId;
    await runner.invoke("workflow.transition", {
      workflowId: crashWorkflowId,
      expectedVersion: 1,
      action: "attach-run",
      jobId: "job-crash",
    });
    const reserved = await transitionDurableWorkflow({
      ...project,
      workflowId: crashWorkflowId,
      expectedVersion: 2,
      actorId: "agent:first",
      transition: "cancel-requested",
      status: "active",
      resource: { kind: "job", id: "job-crash" },
      at: 2_000,
    });
    assert.equal(reserved.status, "updated");
    jobs.set("job-crash", { ...runJob("job-crash"), status: "cancelled" } as TestJob);
    const reconciled = await runner.invoke("workflow.transition", {
      workflowId: crashWorkflowId,
      expectedVersion: 3,
      action: "cancel-run",
    });
    assert.equal(reconciled.workflow.record.status, "terminal");
    assert.deepEqual(cancelCalls, ["job-1"]);
  });
});

test("stale reconciliation adopts the newer canonical resource and never overwrites it", async () => {
  await withServer(async ({ port, jobs, runtime }) => {
    const runner = client(port, "agent:first");
    const created = await runner.invoke("workflow.create", {
      workflowId: "reconciliation-race",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    const workflowId = created.workflow.record.workflowId;
    const staleCandidate = runJob("job-stale", "cancelled");
    const canonical = runJob("job-canonical", "running");
    jobs.set(staleCandidate.id, staleCandidate);
    jobs.set(canonical.id, canonical);
    runtime.listJobs = () => [staleCandidate];
    let raced = false;
    runtime.transitionWorkflow = async (input) => {
      if (!raced && input.transition === "run-reconciled") {
        raced = true;
        const winner = await transitionDurableWorkflow({
          ...input,
          transition: "run-attached-by-winner",
          status: "active",
          resource: { kind: "job", id: canonical.id },
        });
        assert.equal(winner.status, "updated");
      }
      return transitionDurableWorkflow(input);
    };

    const reconciled = await runner.invoke("workflow.get", { workflowId });

    assert.equal(reconciled.workflow.record.resource?.id, canonical.id);
    assert.equal(reconciled.workflow.record.status, "active");
    assert.equal(reconciled.job?.id, canonical.id);
    assert.deepEqual(
      reconciled.workflow.audit.map((event) => event.transition),
      ["created", "run-attached-by-winner"],
    );
  });
});

test("legacy v1 adoption stores only a digest and emits a new durable identity", async () => {
  await withServer(async ({ port, jobs }) => {
    jobs.set("job-legacy", runJob("job-legacy", "running", "unused"));
    const reference = `relay-workflow.v1.${Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "run-test",
        jobId: "job-legacy",
        frozen: { ...frozen(), workflowRequestId: undefined },
      }),
      "utf8",
    ).toString("base64url")}`;
    const adopted = await client(port, "agent:migrator").invoke("workflow.create", {
      workflowId: "adopted-workflow",
      legacyRef: reference,
      expiresAt: 50_000,
    });
    assert.notEqual(adopted.workflow.record.workflowId, "adopted-workflow");
    assert.match(adopted.workflow.record.adoptedLegacyRefDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(adopted).includes(reference), false);
  });
});

test("new Runs require request correlation and non-Run legacy carriers are rejected", async () => {
  await withServer(async ({ port }) => {
    const runner = client(port, "agent:first");
    const { workflowRequestId: _requestId, ...withoutRequestIdentity } = frozen();
    await assert.rejects(
      runner.invoke("workflow.create", {
        workflowId: "missing-correlation",
        kind: "run-test",
        frozenIdentity: withoutRequestIdentity,
        expiresAt: 50_000,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
    const authoringReference = `relay-workflow.v1.${Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "author-test",
        sessionId: "session-1",
        frozen: { title: "Unsafe adoption" },
      }),
      "utf8",
    ).toString("base64url")}`;
    await assert.rejects(
      runner.invoke("workflow.create", {
        workflowId: "unsafe-authoring-adoption",
        legacyRef: authoringReference,
        expiresAt: 50_000,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });
});

test("durable Authoring preserves identity and provenance across restart and clients", async () => {
  await withServer(async ({ port, restart }) => {
    const first = client(port, "agent:first");
    const created = await first.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor(),
        expiresAt: 50_000,
      },
      { requestId: "author-request-1" },
    );
    const workflowId = created.workflow.record.workflowId;
    const started = await first.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    assert.equal(started.workflow.record.version, 3);
    assert.equal(started.session?.testName, "Settings localization");
    assert.equal(started.session?.originApplication, "com.android.settings");
    assert.equal(started.session?.workflowRequestId, "author-request-1");
    assert.equal(
      (started.session?.captureProvenance as { mode?: unknown } | undefined)?.mode,
      "control-and-record",
    );

    const restartedPort = await restart();
    const beforeForeignRead = await readDurableWorkflow({ ...project, workflowId });
    await assert.rejects(
      client(restartedPort, "agent:second").invoke("workflow.get", { workflowId }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    const afterForeignRead = await readDurableWorkflow({ ...project, workflowId });
    assert.deepEqual(afterForeignRead, beforeForeignRead);
    const inspected = await client(restartedPort, "agent:first").invoke("workflow.get", {
      workflowId,
    });
    assert.equal(inspected.workflow.record.version, 3);
    assert.equal(inspected.session?.id, started.session?.id);
    await assert.rejects(
      client(restartedPort, "agent:second").invoke("workflow.transition", {
        workflowId,
        expectedVersion: 3,
        action: "authoring-stop",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
  });
});

test("durable Authoring carries the prepared browser session into its controlled start", async () => {
  await withServer(async ({ port }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: {
          ...frozenAuthor("browser-authoring"),
          originApplication: "https://checkout.example.test",
          target: {
            kind: "browser",
            platform: "browser",
            targetId: "checkout-browser",
            authenticationFixtureId: "authfx:member:1",
            liveSessionId: "prepared-member-session",
          },
        },
        expiresAt: 50_000,
      },
      { requestId: "browser-authoring" },
    );
    const started = await actor.invoke("workflow.transition", {
      workflowId: created.workflow.record.workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    assert.deepEqual(started.session?.target, {
      kind: "browser",
      platform: "browser",
      targetId: "checkout-browser",
      authenticationFixtureId: "authfx:member:1",
      liveSessionId: "prepared-member-session",
    });
  });
});

test("Authoring stale versions do not mutate and approval commits exactly once", async () => {
  await withServer(async ({ port, authoringTransitionCalls }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      { kind: "author-test", frozenIdentity: frozenAuthor("author-stale"), expiresAt: 50_000 },
      { requestId: "author-stale" },
    );
    const workflowId = created.workflow.record.workflowId;
    await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 2,
        action: "authoring-stop",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(authoringTransitionCalls, []);
    const stopped = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 3,
      action: "authoring-stop",
    });
    assert.equal(stopped.session?.state, "reviewing");
    assert.equal(stopped.workflow.record.version, 5);
    const approved = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 5,
      action: "authoring-approve",
      testName: "Renamed during review",
    });
    assert.equal(approved.session?.testName, "Renamed during review");
    assert.equal(approved.workflow.record.status, "terminal");
    assert.equal(approved.session?.committedConnectionId, "connection-1");
    assert.equal(approved.session?.committedTestId, "test-1");
    assert.equal(approved.session?.expectedAppMapRevision, 8);
    assert.deepEqual(authoringTransitionCalls, ["authoring-stop", "authoring-approve"]);
    const inspected = await actor.invoke("workflow.get", { workflowId });
    assert.equal(inspected.workflow.record.status, "terminal");
    assert.equal(inspected.session?.state, "committed");
    assert.equal(inspected.session?.committedTestId, "test-1");
    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: approved.workflow.record.version,
        action: "authoring-approve",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(authoringTransitionCalls, ["authoring-stop", "authoring-approve"]);
  });
});

test("Authoring approval rejects an unproved map revision jump", async () => {
  await withServer(async ({ port, runtime, authoringSessions }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("author-hostile-revision"),
        expiresAt: 50_000,
      },
      { requestId: "author-hostile-revision" },
    );
    const workflowId = created.workflow.record.workflowId;
    await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    const stopped = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 3,
      action: "authoring-stop",
    });
    const transition = runtime.transitionAuthoringSession;
    runtime.transitionAuthoringSession = async (...input) => {
      const committed = await transition(...input);
      if (input[2].action !== "authoring-approve") return committed;
      const hostile = {
        ...committed,
        expectedAppMapRevision: committed.expectedAppMapRevision + 1,
      };
      authoringSessions.set(hostile.id, hostile);
      return hostile;
    };

    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: stopped.workflow.record.version,
        action: "authoring-approve",
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        /different canonical session/u.test(error.message),
    );
    const workflow = await readDurableWorkflow({ ...project, workflowId });
    assert.notEqual(workflow?.record.status, "terminal");
  });
});

test("an uncertain Authoring cancellation is fenced and never dispatched again", async () => {
  await withServer(async ({ port, runtime, authoringTransitionCalls }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      { kind: "author-test", frozenIdentity: frozenAuthor(), expiresAt: 50_000 },
      { requestId: "author-cancel" },
    );
    const workflowId = created.workflow.record.workflowId;
    await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    runtime.transitionAuthoringSession = async (_scope, _id, input) => {
      authoringTransitionCalls.push(input.action);
      throw new Error("response lost after cancel dispatch");
    };
    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 3,
        action: "authoring-cancel",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    const uncertain = await actor.invoke("workflow.get", { workflowId });
    assert.equal(uncertain.workflow.record.status, "needs-attention");
    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: uncertain.workflow.record.version,
        action: "authoring-cancel",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(authoringTransitionCalls, ["authoring-cancel"]);
  });
});

test("a conclusively failed Authoring interaction keeps the durable workflow usable", async () => {
  await withServer(async ({ port, runtime, authoringSessions }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("author-record-failed"),
        expiresAt: 50_000,
      },
      { requestId: "author-record-failed" },
    );
    const workflowId = created.workflow.record.workflowId;
    const started = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    const interaction = { kind: "tap", target: { point: { x: 120, y: 240 } } } as const;
    const transition = runtime.transitionAuthoringSession;
    runtime.transitionAuthoringSession = async (_scope, id, input) => {
      if (input.action !== "authoring-record") throw new Error("Expected Authoring record");
      const session = authoringSessions.get(id)!;
      const source = {
        kind: "authoring-runtime" as const,
        target: structuredClone(session.target),
        captureProvenance: session.captureProvenance,
      };
      const intentId = "raw-failed-intent";
      authoringSessions.set(id, {
        ...session,
        take: {
          rawCaptureVersion: 2,
          rawEvents: [
            {
              id: intentId,
              sequence: 1,
              kind: "interaction-intent",
              recordedAt: 1_010,
              source,
              startedAt: 1_010,
              // Protocol parsing may normalize object property order. The
              // proof must compare this redacted command structurally.
              interaction: {
                kind: "tap",
                target: { point: { x: 120, y: 240 }, strategies: ["point"] },
              },
              links: { evidenceIds: [] },
            },
            {
              id: "raw-failed-outcome",
              sequence: 2,
              kind: "interaction-outcome",
              recordedAt: 1_011,
              source,
              intentEventId: intentId,
              outcome: "failed",
              finishedAt: 1_011,
              links: { evidenceIds: [] },
            },
          ],
        } as unknown as NonNullable<AuthoringSession["take"]>,
      });
      throw new InputNotDispatchedError("Target inspection failed before tap");
    };

    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: started.workflow.record.version,
        action: "authoring-record",
        interaction,
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 422 &&
        error.body &&
        typeof error.body === "object" &&
        "code" in error.body &&
        error.body.code === "input-not-dispatched" &&
        "dispatched" in error.body &&
        error.body.dispatched === false,
    );
    runtime.transitionAuthoringSession = transition;

    const inspectable = await actor.invoke("workflow.get", { workflowId });
    assert.equal(inspectable.workflow.record.status, "active");
    assert.equal(inspectable.workflow.record.lastTransition, "authoring-record-failed");
    assert.equal(inspectable.session?.state, "recording");

    const retried = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: inspectable.workflow.record.version,
      action: "authoring-record",
      interaction: { kind: "wait", ms: 1 },
    });
    assert.equal(retried.workflow.record.status, "active");
    assert.equal(retried.workflow.record.lastTransition, "authoring-record-completed");
  });
});

test("durable Authoring receipts reconcile every completed crash-boundary mutation", async () => {
  await withServer(async ({ port, runtime, authoringSessions }) => {
    const actor = client(port, "agent:first");
    const cases = [
      { action: "authoring-record", interaction: { kind: "wait", ms: 1_000 } },
      { action: "authoring-checkpoint", label: "Ready" },
      { action: "authoring-stop" },
      {
        action: "authoring-edit",
        edit: { kind: "remove", actionIds: ["noise"] as string[] },
      },
      { action: "authoring-replay" },
      { action: "authoring-approve" },
      { action: "authoring-discard" },
      { action: "authoring-cancel" },
    ] as const;
    for (const [index, transition] of cases.entries()) {
      const requestId = `author-crash-${index}`;
      const created = await actor.invoke(
        "workflow.create",
        { kind: "author-test", frozenIdentity: frozenAuthor(requestId), expiresAt: 50_000 },
        { requestId },
      );
      const workflowId = created.workflow.record.workflowId;
      const started = await actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 1,
        action: "start-authoring",
        leaseId: "lease-1",
      });
      const sessionId = started.session?.id as string;
      if (
        ["authoring-edit", "authoring-replay", "authoring-approve", "authoring-discard"].includes(
          transition.action,
        )
      ) {
        const session = authoringSessions.get(sessionId)!;
        authoringSessions.set(sessionId, { ...session, state: "reviewing" });
      }
      const canonicalTransition = runtime.transitionWorkflow;
      let crashed = false;
      runtime.transitionWorkflow = async (input) => {
        if (!crashed && input.transition === `${transition.action}-completed`) {
          crashed = true;
          throw new Error("process stopped after canonical authoring write");
        }
        return canonicalTransition(input);
      };
      await assert.rejects(
        actor.invoke("workflow.transition", {
          workflowId,
          expectedVersion: 3,
          ...transition,
        }),
      );
      runtime.transitionWorkflow = canonicalTransition;
      const reconciled = await actor.invoke("workflow.get", { workflowId });
      assert.equal(reconciled.workflow.record.version, 5, transition.action);
      assert.equal(
        reconciled.workflow.record.lastTransition,
        `${transition.action}-reconciled`,
        transition.action,
      );
      assert.equal(
        reconciled.workflow.record.status,
        ["authoring-approve", "authoring-discard", "authoring-cancel"].includes(transition.action)
          ? "terminal"
          : "active",
        transition.action,
      );
    }
  });
});

test("a persisted Authoring mutation reconciles after its transport throws", async () => {
  await withServer(async ({ port, runtime }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("author-transport-crash"),
        expiresAt: 50_000,
      },
      { requestId: "author-transport-crash" },
    );
    const workflowId = created.workflow.record.workflowId;
    await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    const transition = runtime.transitionAuthoringSession;
    runtime.transitionAuthoringSession = async (...input) => {
      await transition(...input);
      throw new Error("transport closed after canonical Authoring write");
    };
    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 3,
        action: "authoring-stop",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    runtime.transitionAuthoringSession = transition;

    const uncertain = await readDurableWorkflow({ ...project, workflowId });
    assert.equal(uncertain?.record.lastTransition, "authoring-stop-outcome-unknown");
    assert.equal(uncertain?.record.status, "needs-attention");
    const reconciled = await actor.invoke("workflow.get", { workflowId });
    assert.equal(reconciled.workflow.record.lastTransition, "authoring-stop-reconciled");
    assert.equal(reconciled.workflow.record.status, "active");
  });
});

test("low-level Authoring state cannot prove a durable mutation without its exact receipt", async () => {
  await withServer(async ({ port, authoringSessions }) => {
    const actor = client(port, "agent:first");
    const cases = [
      {
        action: "authoring-stop",
        mutate: (session: AuthoringSession) => ({ ...session, state: "reviewing" as const }),
      },
      {
        action: "authoring-approve",
        mutate: (session: AuthoringSession) => ({ ...session, state: "committed" as const }),
      },
      {
        action: "authoring-discard",
        mutate: (session: AuthoringSession) => ({
          ...session,
          state: "reviewing" as const,
          archive: { reason: "discarded" as const, archivedAt: 2_000 },
        }),
      },
      {
        action: "authoring-cancel",
        mutate: (session: AuthoringSession) => ({ ...session, state: "cancelled" as const }),
      },
    ] as const;
    for (const [index, value] of cases.entries()) {
      const requestId = `author-unrelated-state-${index}`;
      const created = await actor.invoke(
        "workflow.create",
        { kind: "author-test", frozenIdentity: frozenAuthor(requestId), expiresAt: 50_000 },
        { requestId },
      );
      const workflowId = created.workflow.record.workflowId;
      const started = await actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 1,
        action: "start-authoring",
        leaseId: "lease-1",
      });
      const sessionId = started.session?.id as string;
      authoringSessions.set(sessionId, value.mutate(authoringSessions.get(sessionId)!));
      const reserved = await transitionDurableWorkflow({
        ...project,
        workflowId,
        expectedVersion: 3,
        actorId: "agent:first",
        transition: `${value.action}-requested`,
        status: "active",
        resource: { kind: "authoring-session", id: sessionId },
        at: 2_000 + index,
      });
      assert.equal(reserved.status, "updated");

      const inspected = await actor.invoke("workflow.get", { workflowId });
      assert.equal(inspected.workflow.record.lastTransition, `${value.action}-outcome-unknown`);
      assert.equal(inspected.workflow.record.status, "needs-attention");
    }
  });
});

test("explicit observation recovers an interrupted recording for review without confirming its input", async () => {
  await withServer(async ({ port, authoringSessions, authoringTransitionCalls }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("review-after-restart"),
        expiresAt: 50_000,
      },
      { requestId: "review-after-restart" },
    );
    const workflowId = created.workflow.record.workflowId;
    const started = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    const sessionId = started.session!.id as string;
    const original = authoringSessions.get(sessionId)!;
    await transitionDurableWorkflow({
      ...project,
      workflowId,
      expectedVersion: 3,
      actorId: "agent:first",
      transition: "authoring-record-requested",
      status: "active",
      at: 2_000,
    });
    authoringSessions.set(sessionId, {
      ...original,
      state: "failed",
      recoveredAt: 2_100,
      recoverable: true,
      error: "Restarted during capture",
    });
    const uncertain = await actor.invoke("workflow.get", { workflowId });
    assert.equal(uncertain.workflow.record.status, "needs-attention");
    // A state change alone is not evidence of the user's recovery observation.
    authoringSessions.set(sessionId, { ...original, state: "reviewing", recoveredAt: 2_100 });
    assert.equal(
      (await actor.invoke("workflow.get", { workflowId })).workflow.record.status,
      "needs-attention",
    );
    const rawEvents = [
      {
        id: "recovery-observation",
        sequence: 1,
        kind: "observation",
        recordedAt: 2_200,
        source: { kind: "authoring-runtime", target: original.target },
        observation: { id: "current-screen", evidenceIds: [] },
      },
    ];
    authoringSessions.set(sessionId, {
      ...original,
      state: "reviewing",
      recoveredAt: 2_100,
      take: { rawCaptureVersion: 2, rawEvents } as unknown as NonNullable<AuthoringSession["take"]>,
    });
    const recovered = await actor.invoke("workflow.get", { workflowId });
    assert.equal(recovered.workflow.record.status, "active");
    assert.equal(recovered.workflow.record.lastTransition, "authoring-review-recovered");
    assert.deepEqual(authoringSessions.get(sessionId)!.take!.rawEvents, rawEvents);
    assert.deepEqual(authoringTransitionCalls, []);
  });
});

test("only a new observation reopens interrupted replay, without proving replay or approval", async () => {
  await withServer(async ({ port, authoringSessions, authoringTransitionCalls }) => {
    const actor = client(port, "agent:first");
    for (const action of ["authoring-replay", "authoring-approve"] as const) {
      const requestId = `observe-${action}`;
      const created = await actor.invoke(
        "workflow.create",
        {
          kind: "author-test",
          frozenIdentity: frozenAuthor(requestId),
          expiresAt: 50_000,
        },
        { requestId },
      );
      const workflowId = created.workflow.record.workflowId;
      const started = await actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 1,
        action: "start-authoring",
        leaseId: "lease-1",
      });
      const sessionId = started.session!.id as string;
      const original = authoringSessions.get(sessionId)!;
      authoringSessions.set(sessionId, { ...original, state: "reviewing" });
      await transitionDurableWorkflow({
        ...project,
        workflowId,
        expectedVersion: 3,
        actorId: "agent:first",
        transition: `${action}-requested`,
        status: "active",
        at: 2_000,
      });
      const unknown = await actor.invoke("workflow.get", { workflowId });
      const observed = (recordedAt: number) => ({
        ...original,
        state: "reviewing" as const,
        take: {
          rawCaptureVersion: 2,
          rawEvents: [
            {
              id: "observation",
              sequence: 1,
              kind: "observation",
              recordedAt,
              source: { kind: "authoring-runtime", target: original.target },
              observation: { id: "screen", evidenceIds: [] },
            },
          ],
        } as unknown as NonNullable<AuthoringSession["take"]>,
      });
      authoringSessions.set(sessionId, observed(unknown.workflow.record.updatedAt));
      assert.equal(
        (await actor.invoke("workflow.get", { workflowId })).workflow.record.status,
        "needs-attention",
      );
      authoringSessions.set(sessionId, observed(unknown.workflow.record.updatedAt + 1));
      const recovered = await actor.invoke("workflow.get", { workflowId });
      assert.equal(
        recovered.workflow.record.status,
        action === "authoring-replay" ? "active" : "needs-attention",
      );
      if (action === "authoring-replay") {
        assert.equal(recovered.workflow.record.lastTransition, "authoring-review-recovered");
        assert.ok(
          recovered.workflow.audit.some(
            (event) => event.transition === "authoring-replay-outcome-unknown",
          ),
        );
        assert.deepEqual(recovered.session?.workflowMutation, original.workflowMutation);
      }
    }
    assert.deepEqual(authoringTransitionCalls, []);
  });
});

test("foreign Authoring transitions do not reveal or mutate stale or expired state", async () => {
  await withServer(async ({ port }) => {
    const owner = client(port, "agent:first");
    const created = await owner.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("author-expired-owner-fence"),
        expiresAt: 1_001,
      },
      { requestId: "author-expired-owner-fence" },
    );
    const workflowId = created.workflow.record.workflowId;
    const before = await readDurableWorkflow({ ...project, workflowId });
    await assert.rejects(
      client(port, "agent:second").invoke("workflow.transition", {
        workflowId,
        expectedVersion: 999,
        action: "authoring-abandon",
        reason: "probe another actor's workflow",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    const after = await readDurableWorkflow({ ...project, workflowId });
    assert.deepEqual(after, before);
  });
});

test("an owner can abandon an unproven Authoring start without redispatch", async () => {
  await withServer(async ({ port }) => {
    const actor = client(port, "agent:first");
    const requestId = "author-unproven-start";
    const created = await actor.invoke(
      "workflow.create",
      { kind: "author-test", frozenIdentity: frozenAuthor(requestId), expiresAt: 50_000 },
      { requestId },
    );
    const workflowId = created.workflow.record.workflowId;
    const reserved = await transitionDurableWorkflow({
      ...project,
      workflowId,
      expectedVersion: 1,
      actorId: "agent:first",
      transition: "start-authoring-requested",
      status: "active",
      at: 2_000,
    });
    assert.equal(reserved.status, "updated");
    await assert.rejects(
      client(port, "agent:second").invoke("workflow.transition", {
        workflowId,
        expectedVersion: 2,
        action: "authoring-abandon",
        reason: "Unable to prove whether target capture began",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    const abandoned = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 2,
      action: "authoring-abandon",
      reason: "Unable to prove whether target capture began",
    });
    assert.equal(abandoned.workflow.record.status, "terminal");
    assert.deepEqual(abandoned.workflow.record.resolution, {
      kind: "abandoned",
      reason: "Unable to prove whether target capture began",
      at: 1_002,
    });
    assert.equal(abandoned.workflow.audit.at(-1)?.resolution?.kind, "abandoned");
  });
});

test("a healthy Authoring session cannot be abandoned and orphaned", async () => {
  await withServer(async ({ port, authoringSessions }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("author-healthy-abandon"),
        expiresAt: 50_000,
      },
      { requestId: "author-healthy-abandon" },
    );
    const workflowId = created.workflow.record.workflowId;
    const started = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    const before = await readDurableWorkflow({ ...project, workflowId });
    await assert.rejects(
      actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 3,
        action: "authoring-abandon",
        reason: "do not orphan a healthy recording",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    const after = await readDurableWorkflow({ ...project, workflowId });
    assert.deepEqual(after, before);
    assert.equal(authoringSessions.get(started.session?.id as string)?.state, "recording");
  });
});

test("a network workflow cannot attach or adopt another principal's canonical job", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-workflow-authority-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    redaction: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
  };
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_REDACTION_MODE = "on";
  process.env.RELAY_AUTH_ROLE = "runner";
  process.env.RELAY_AUTH_ORGANIZATION_ID = project.organizationId;
  process.env.RELAY_AUTH_PROJECT_IDS = project.projectId;
  resetControlDatabaseCache();
  const token = "workflow-authority-test-token-32-chars";
  const foreignJob = runJob();
  const foreignJobs = [foreignJob];
  const runtime: WorkflowRouteRuntime = {
    now: () => 1_000,
    getJob: (id) => (id === foreignJob.id ? foreignJob : undefined),
    listJobs: () => foreignJobs,
    cancelJob: () => foreignJob,
    assertTargetControl: async () => ({}) as never,
    transitionWorkflow: transitionDurableWorkflow,
    getAuthoringSession: async () => {
      throw new Error("No Authoring Session");
    },
    listAuthoringSessions: async () => [],
    beginAuthoringSession: async () => {
      throw new Error("Authoring is not configured");
    },
    assertAuthoringStartAccess: async () => undefined,
    assertAuthoringAccess: async () => undefined,
    transitionAuthoringSession: async () => {
      throw new Error("Authoring is not configured");
    },
    readRepeatCampaign: async () => null,
    findRepeatCampaignsByWorkflow: async () => [],
    projectRepeatCampaign: async (campaign) => campaign,
  };
  const server = await startServer({
    host: "0.0.0.0",
    port: 0,
    token,
    workflowRouteRuntime: runtime,
  });
  const network = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "bearer", token },
    organizationId: project.organizationId,
    projectId: project.projectId,
    actorId: "configured-service",
    actorKind: "agent",
  });
  try {
    const created = await network.invoke("workflow.create", {
      workflowId: "network-run",
      kind: "run-test",
      frozenIdentity: frozen(),
      expiresAt: 50_000,
    });
    await assert.rejects(
      network.invoke("workflow.get", { workflowId: created.workflow.record.workflowId }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    let unchanged = await readDurableWorkflow({
      ...project,
      workflowId: created.workflow.record.workflowId,
    });
    assert.equal(unchanged?.record.version, 1);
    assert.deepEqual(
      unchanged?.audit.map((event) => event.transition),
      ["created"],
    );

    foreignJobs.push(runJob("job-2"));
    await assert.rejects(
      network.invoke("workflow.get", { workflowId: created.workflow.record.workflowId }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    unchanged = await readDurableWorkflow({
      ...project,
      workflowId: created.workflow.record.workflowId,
    });
    assert.equal(unchanged?.record.version, 1);
    assert.deepEqual(
      unchanged?.audit.map((event) => event.transition),
      ["created"],
    );
    await assert.rejects(
      network.invoke("workflow.transition", {
        workflowId: created.workflow.record.workflowId,
        expectedVersion: 1,
        action: "attach-run",
        jobId: foreignJob.id,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    const reference = `relay-workflow.v1.${Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: "run-test",
        jobId: foreignJob.id,
        frozen: { ...frozen(), workflowRequestId: undefined },
      }),
      "utf8",
    ).toString("base64url")}`;
    await assert.rejects(
      network.invoke("workflow.create", {
        workflowId: "foreign-adoption",
        legacyRef: reference,
        expiresAt: 50_000,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent identical inputs preserve only the winning mutation receipt", async () => {
  await withServer(async ({ port, runtime }) => {
    const actor = client(port, "agent:first");
    const created = await actor.invoke(
      "workflow.create",
      {
        kind: "author-test",
        frozenIdentity: frozenAuthor("author-active-dispatch"),
        expiresAt: 50_000,
      },
      { requestId: "author-active-dispatch" },
    );
    const workflowId = created.workflow.record.workflowId;
    const started = await actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: 1,
      action: "start-authoring",
      leaseId: "lease-1",
    });
    const original = runtime.transitionAuthoringSession;
    let entered!: () => void;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.transitionAuthoringSession = async (...args) => {
      entered();
      await gate;
      return original(...args);
    };
    const recording = actor.invoke("workflow.transition", {
      workflowId,
      expectedVersion: started.workflow.record.version,
      action: "authoring-record",
      mutationId: "recording-winner",
      interaction: { kind: "wait", ms: 1 },
    });
    await pending;
    try {
      const inspected = await actor.invoke("workflow.get", { workflowId });
      assert.equal(inspected.workflow.record.lastTransition, "authoring-record-requested");
      assert.equal(inspected.workflow.record.status, "active");
      await assert.rejects(
        actor.invoke("workflow.transition", {
          workflowId,
          expectedVersion: started.workflow.record.version,
          action: "authoring-record",
          mutationId: "recording-loser",
          interaction: { kind: "wait", ms: 1 },
        }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
    } finally {
      release();
    }
    const completed = await recording;
    assert.equal(completed.workflow.record.lastTransition, "authoring-record-completed");
    assert.equal(completed.workflow.record.status, "active");
    const completedSession = parseAuthoringSession(completed.session);
    const startedSession = parseAuthoringSession(started.session);
    assert.equal(completedSession.workflowMutation?.mutationId, "recording-winner");
    const reference = {
      workflowId,
      sessionId: startedSession.id,
      transitionVersion: started.workflow.record.version + 1,
      target: startedSession.target,
    };
    assert.equal(
      authoringInputReceiptOutcome(completed, { ...reference, mutationId: "recording-winner" }),
      "applied",
    );
    assert.equal(
      authoringInputReceiptOutcome(completed, { ...reference, mutationId: "recording-loser" }),
      "unknown",
    );
  });
});

for (const retainedMutationId of [undefined, "another-input"]) {
  test(`completion rejects a recording receipt with ${retainedMutationId ?? "missing"} identity`, async () => {
    await withServer(async ({ port, runtime }) => {
      const actor = client(port, "agent:first");
      const created = await actor.invoke(
        "workflow.create",
        {
          kind: "author-test",
          frozenIdentity: frozenAuthor("nonce-validation"),
          expiresAt: 50_000,
        },
        { requestId: "nonce-validation" },
      );
      const workflowId = created.workflow.record.workflowId;
      const started = await actor.invoke("workflow.transition", {
        workflowId,
        expectedVersion: 1,
        action: "start-authoring",
        leaseId: "lease-1",
      });
      const original = runtime.transitionAuthoringSession;
      runtime.transitionAuthoringSession = async (...args) => {
        const next = await original(...args);
        next.workflowMutation!.mutationId = retainedMutationId;
        return next;
      };
      await assert.rejects(
        actor.invoke("workflow.transition", {
          workflowId,
          expectedVersion: started.workflow.record.version,
          action: "authoring-record",
          mutationId: "recording-expected",
          interaction: { kind: "wait", ms: 1 },
        }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
    });
  });
}
