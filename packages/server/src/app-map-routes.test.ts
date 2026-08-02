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

test("App Map operations are equivalent for human and agent actors", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-server-"));
  const previous = process.env.GROK_DEVICE_STATE_DIR;
  process.env.GROK_DEVICE_STATE_DIR = root;
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
        input: {
          screen: {
            id: "welcome",
            organizationId: "acme",
            projectId: "mobile",
            appMapId: "store",
            title: "Welcome",
            variantIds: [],
            createdAt: 100,
            updatedAt: 100,
          },
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
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an agent turns observations into a proposal that a human must approve", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-observation-proposal-"));
  const previousState = process.env.GROK_DEVICE_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.GROK_DEVICE_STATE_DIR = root;
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

    const approved = await human.invoke("app-map.proposal.approve", {
      appMapId: "observed",
      proposalId: proposed.proposalId,
      expectedRevision: proposed.appMap.revision,
    });
    assert.equal(Object.keys(approved.appMap.screens).length, 2);
    assert.equal(Object.keys(approved.appMap.connections).length, 1);
    assert.equal(
      approved.appMap.activity[Object.keys(approved.appMap.activity).at(-1)!]?.actorKind,
      "human",
    );
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
