import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  createDiscoverySession,
  recordObservedScreen,
  recordObservedTransition,
  setDiscoveryStatus,
} from "@relay/core";
import { startServer } from "./index.js";
import { explicitTargetAvailability } from "./app-map-run-routes.js";

test("explicit target preflight distinguishes disconnected and not-ready devices", () => {
  assert.equal(explicitTargetAvailability("phone-1", []), "missing");
  assert.equal(
    explicitTargetAvailability("phone-1", [
      { serial: "phone-2", booted: true, connectionState: "connected" },
    ]),
    "missing",
  );
  assert.equal(
    explicitTargetAvailability("phone-1", [
      { serial: "phone-1", booted: true, connectionState: "offline" },
    ]),
    "not-ready",
  );
  assert.equal(
    explicitTargetAvailability("phone-1", [
      { serial: "phone-1", booted: true, connectionState: "connected" },
    ]),
    "connected",
  );
});

test("App Map operations are equivalent for human and agent actors", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-server-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const connection = {
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" as const },
      organizationId: "acme",
      projectId: "mobile",
    };
    const human = new RelayClient({
      ...connection,
      actorId: "human:designer",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:mapper",
      actorKind: "agent",
    });

    const created = await human.invoke("app-map.create", {
      appMapId: "store",
      name: "Store",
    });
    assert.equal(created.appMap.revision, 0);

    const added = await agent.invoke(
      "app-map.screen.add",
      {
        appMapId: "store",
        expectedRevision: 0,
        eventId: "agent-add-welcome",
        screen: {
          id: "welcome",
          title: "Welcome",
        },
      },
      { requestId: "request-agent-add-welcome" },
    );
    assert.equal(added.appMap.revision, 1);
    assert.equal(added.appMap.activity["agent-add-welcome"]?.actorKind, "agent");

    const visibleToHuman = await human.invoke("app-map.get", { appMapId: "store" });
    assert.equal(visibleToHuman.appMap.screens.welcome?.title, "Welcome");

    const renamed = await human.invoke("app-map.update", {
      appMapId: "store",
      expectedRevision: 1,
      eventId: "human-rename-map",
      patch: { name: "Storefront" },
    });
    assert.equal(renamed.appMap.name, "Storefront");
    assert.equal(renamed.appMap.revision, 2);

    const duplicated = await human.invoke("app-map.duplicate", {
      sourceAppMapId: "store",
      appMapId: "store-copy",
      name: "Storefront copy",
    });
    assert.equal(duplicated.appMap.name, "Storefront copy");
    assert.equal(duplicated.appMap.screens.welcome?.appMapId, "store-copy");
    assert.equal(duplicated.appMap.revision, 0);
    assert.deepEqual(duplicated.appMap.activity, {});

    const submitted = await agent.invoke("app-map.proposal.submit", {
      appMapId: "store",
      expectedRevision: 2,
      eventId: "agent-proposes-start-title",
      proposal: {
        id: "proposal-start-title",
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "store",
        title: "Clarify the start screen",
        status: "pending",
        baseRevision: 2,
        changes: [
          {
            kind: "screen.update",
            screenId: "welcome",
            input: { patch: { title: "Start" } },
          },
        ],
        createdAt: renamed.appMap.updatedAt,
        updatedAt: renamed.appMap.updatedAt,
      },
    });
    assert.equal(submitted.appMap.revision, 3);
    assert.equal(submitted.appMap.screens.welcome?.title, "Welcome");

    const approved = await human.invoke("app-map.proposal.approve", {
      appMapId: "store",
      proposalId: "proposal-start-title",
      expectedRevision: 3,
      eventId: "human-approves-start-title",
    });
    assert.equal(approved.appMap.screens.welcome?.title, "Start");
    assert.equal(approved.appMap.proposals["proposal-start-title"]?.status, "approved");

    await assert.rejects(
      agent.invoke("app-map.screen.update", {
        appMapId: "store",
        screenId: "welcome",
        expectedRevision: 3,
        input: { patch: { title: "Start" } },
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal((error.body as { code?: string }).code, "revision-conflict");
        assert.match((error.body as { recovery?: string }).recovery ?? "", /reload/iu);
        return true;
      },
    );

    assert.deepEqual(await human.invoke("app-map.remove", { appMapId: "store" }), { ok: true });
    assert.deepEqual(await human.invoke("app-map.remove", { appMapId: "store-copy" }), {
      ok: true,
    });
    await assert.rejects(human.invoke("app-map.get", { appMapId: "store" }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      return true;
    });
    assert.deepEqual(await human.invoke("app-map.list", {}), { appMaps: [] });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicitly confirmed lease takeover hands control to the requesting actor", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-lease-takeover-server-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const connection = {
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" as const },
      organizationId: "local",
      projectId: "default",
    };
    const human = new RelayClient({
      ...connection,
      actorId: "human:designer",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:mapper",
      actorKind: "agent",
    });
    const original = await human.lease({
      poolId: "local",
      deviceSerial: "physical-device",
      expiresAt: Date.now() + 60_000,
    });

    await assert.rejects(
      agent.invoke("lease.takeover", {
        leaseId: original.lease.id,
        expiresAt: Date.now() + 120_000,
        reason: "User delegated this unattended run",
        confirm: false as never,
      }),
      /confirm must be true/u,
    );
    const handedOff = await agent.takeOverLease({
      leaseId: original.lease.id,
      reason: "User delegated this unattended run",
      confirm: true,
    });
    assert.equal(handedOff.lease.ownerId, "agent:mapper");
    assert.ok(handedOff.lease.expiresAt > Date.now());
    assert.equal(handedOff.lease.handoffFromLeaseId, original.lease.id);
    const history = await agent.invoke("lease.list", { status: "all" });
    assert.equal(
      history.leases.find((lease) => lease.id === original.lease.id)?.status,
      "released",
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("App Maps export and import through their canonical YAML contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-yaml-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "checkout", name: "Checkout" });
    const exported = await client.invoke("app-map.export", { appMapId: "checkout" });
    assert.equal(exported.filename, "checkout.relay.map.yaml");
    assert.match(exported.yaml, /schemaVersion: 1/u);

    const dryRun = await client.invoke("app-map.import", {
      yaml: exported.yaml,
      dryRun: true,
    });
    assert.equal(dryRun.imported, false);

    const copied = await client.invoke("app-map.import", {
      yaml: exported.yaml,
      conflict: "copy",
    });
    assert.equal(copied.imported, true);
    assert.equal(copied.appMap.id, "checkout-copy");
    assert.equal(copied.appMap.projectId, "mobile");
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an agent turns observations into a proposal that a human must approve", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-observation-proposal-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const connection = {
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" as const },
      organizationId: "acme",
      projectId: "mobile",
    };
    const human = new RelayClient({
      ...connection,
      actorId: "human:reviewer",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:explorer",
      actorKind: "agent",
    });
    await human.invoke("app-map.create", { appMapId: "observed", name: "Observed app" });
    const session = await createDiscoverySession({
      id: "agent-observation",
      name: "Agent exploration",
      targetId: "pixel",
      scope: { maxScreens: 4, maxTransitions: 4, maxDurationMs: 60_000 },
    });
    await setDiscoveryStatus(session.id, "running");
    const source = await recordObservedScreen({
      sessionId: session.id,
      nodes: [{ role: "button", label: "Cart", visibleToUser: true }],
    });
    const destination = await recordObservedScreen({
      sessionId: session.id,
      nodes: [{ role: "heading", label: "Your cart", visibleToUser: true }],
    });
    const transition = await recordObservedTransition({
      sessionId: session.id,
      fromScreenId: source.screen.id,
      toScreenId: destination.screen.id,
      kind: "tap",
      label: "Open cart",
      target: { label: "Cart" },
      changedScreen: true,
    });

    const proposed = await agent.invoke("app-map.observations.propose", {
      appMapId: "observed",
      sessionId: session.id,
      expectedRevision: 0,
      proposalId: "proposal-agent-observation",
      transitionIds: [transition.id],
    });
    assert.equal(Object.keys(proposed.appMap.screens).length, 0);
    assert.equal(proposed.appMap.proposals[proposed.proposalId]?.status, "pending");

    const parallel = await agent.invoke("app-map.observations.propose", {
      appMapId: "observed",
      sessionId: session.id,
      expectedRevision: 0,
      proposalId: "proposal-agent-parallel",
      transitionIds: [transition.id],
    });
    assert.equal(Object.keys(parallel.appMap.proposals).length, 2);
    assert.equal(parallel.appMap.proposals[parallel.proposalId]?.sourceRevision, 0);

    const approved = await human.invoke("app-map.proposal.approve", {
      appMapId: "observed",
      proposalId: proposed.proposalId,
      expectedRevision: parallel.appMap.revision,
    });
    assert.equal(Object.keys(approved.appMap.screens).length, 2);
    assert.equal(Object.keys(approved.appMap.connections).length, 1);
    assert.equal(
      approved.appMap.activity[Object.keys(approved.appMap.activity).at(-1)!]?.actorKind,
      "human",
    );
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("a saved App Map flow runs without an auxiliary canvas document", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-run-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:runner",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
    const scoped = (id: string) => ({
      id,
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      createdAt: 100,
      updatedAt: 100,
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "store",
      expectedRevision: 0,
      screen: {
        id: "welcome",
        title: "Welcome",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "store",
      expectedRevision: 1,
      screen: {
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
    });
    await client.invoke("app-map.connection.create", {
      appMapId: "store",
      expectedRevision: 2,
      connection: {
        id: "continue",
        fromScreenId: "welcome",
        destination: { kind: "screen", screenId: "home" },
        state: "ready",
        actions: [{ id: "tap-continue", kind: "tap", target: { label: "Continue" } }],
      },
    });
    await client.updateVariables({
      expectedRevision: 0,
      value: [
        {
          id: "thinking-level",
          name: "thinking_level",
          scope: "shared",
          source: "list",
          values: ["low", "medium", "high", "xhigh", "pro"],
        },
        {
          id: "login",
          name: "login_email",
          scope: "private",
          source: "static",
        },
      ],
    });
    await client.invoke("app-map.case-stack.attach", {
      appMapId: "store",
      connectionId: "continue",
      caseStackId: "thinking-levels",
      expectedRevision: 3,
      caseStack: {
        ...scoped("thinking-levels"),
        name: "Thinking levels",
        dataIds: ["thinking-level", "login"],
        strategy: "zip",
        maxCases: 10,
      },
    });
    await client.invoke("app-map.routine.save", {
      appMapId: "store",
      routineId: "start-clean",
      expectedRevision: 4,
      routine: {
        name: "Start clean",
        actions: [{ id: "new-conversation", kind: "tap", target: { identifier: "grok-compose" } }],
      },
    });
    await client.invoke("app-map.flow.save", {
      appMapId: "store",
      flowId: "main",
      expectedRevision: 5,
      flow: {
        name: "Main",
        startScreenId: "welcome",
        setup: { routineId: "start-clean" },
        connectionIds: ["continue"],
      },
    });
    const virtualLease = await client.invoke("lease.create", {
      poolId: "local",
      deviceSerial: "virtual-target",
      expiresAt: Date.now() + 60_000,
    });

    const result = await client.invoke("app-map.flow.run", {
      appMapId: "store",
      flowId: "main",
      serial: "virtual-target",
      platform: "android",
      targetKind: "device",
      variables: { login_email: "person@example.test" },
    });
    assert.equal(result.plan.appMapId, "store");
    assert.equal(result.plan.appMapRevision, 6);
    assert.equal(result.plan.flow.id, "main");
    assert.equal(result.plan.flow.setup?.routineId, "start-clean");
    assert.deepEqual(
      result.plan.recipes[result.plan.rootRecipeId]!.steps.map((step) => step.kind),
      ["module", "expect-screen", "tap", "expect-screen"],
    );
    assert.equal((result.job as { projectId?: string }).projectId, "mobile");
    assert.equal(result.jobs.length, 5);
    assert.deepEqual(
      result.matrix?.cases.map((item) => item.name),
      ["Private case 1", "Private case 2", "Private case 3", "Private case 4", "Private case 5"],
    );
    assert.equal(
      (result.jobs[0] as { resolvedInputs?: Record<string, unknown> }).resolvedInputs?.login_email,
      "[private]",
    );
    assert.equal(JSON.stringify(result).includes("person@example.test"), false);

    const connectionResult = await client.invoke("app-map.connection.run", {
      appMapId: "store",
      connectionId: "continue",
      serial: "virtual-target",
      platform: "android",
      targetKind: "device",
      variables: { login_email: "person@example.test" },
    });
    assert.equal(connectionResult.plan.connection.id, "continue");
    assert.deepEqual(
      connectionResult.plan.recipes[connectionResult.plan.rootRecipeId]!.steps.map(
        (step) => step.kind,
      ),
      ["expect-screen", "tap", "expect-screen"],
    );
    assert.equal(connectionResult.jobs.length, 5);
    assert.equal(JSON.stringify(connectionResult).includes("person@example.test"), false);

    // A lease is the explicit escape hatch used by remote workers and test
    // doubles. Once it is gone, a stale serial must fail before the case stack
    // expands or any child job is enqueued.
    await client.invoke("lease.release", { leaseId: virtualLease.lease.id });
    const jobsBeforeStaleTarget = await client.invoke("job.list", { limit: 100 });
    await assert.rejects(
      client.invoke("app-map.connection.run", {
        appMapId: "store",
        connectionId: "continue",
        serial: "virtual-target",
        platform: "android",
        targetKind: "device",
        variables: { login_email: "person@example.test" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.ok(error.status === 409 || error.status === 503);
        const body = error.body as { code?: string } | undefined;
        assert.ok(
          body?.code === "TARGET_NOT_CONNECTED" || body?.code === "TARGET_DISCOVERY_UNAVAILABLE",
        );
        return true;
      },
    );
    const jobsAfterStaleTarget = await client.invoke("job.list", { limit: 100 });
    assert.deepEqual(
      jobsAfterStaleTarget.jobs.map((job) => job.id),
      jobsBeforeStaleTarget.jobs.map((job) => job.id),
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
