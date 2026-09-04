import assert from "node:assert/strict";
import test from "node:test";
import { createProductMapService, projectProductMap } from "./map-exploration.js";

test("map projection presents bounded known screens, paths, coverage, and failures", () => {
  const map = {
    id: "app-1",
    name: "Checkout",
    revision: 8,
    description: "Purchase flow",
    screens: {
      home: { id: "home", title: "Home", variantIds: ["home-v1"] },
      cart: { id: "cart", title: "Cart", variantIds: [] },
    },
    connections: {
      "home-cart": {
        id: "home-cart",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "cart" },
        label: "Open cart",
        state: "ready",
      },
    },
    tests: {
      checkout: {
        id: "checkout",
        name: "Open cart",
        steps: [
          {
            id: "step-1",
            intent: "Open cart",
            kind: "instruction",
            binding: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["home-cart"],
            },
          },
        ],
      },
    },
    targetResults: {
      failure: {
        id: "failure",
        runId: "run-1",
        outcome: "product-failure",
        connectionId: "home-cart",
        finishedAt: 100,
      },
    },
    proposals: {
      "proposal-1": { id: "proposal-1", title: "Review cart path", status: "pending" },
    },
  } as never;
  const overview = projectProductMap(map);
  assert.equal(overview.coverage.screenCount, 2);
  assert.equal(overview.coverage.coveredPathCount, 1);
  assert.equal(overview.screens[0]?.coveringTests[0]?.name, "Open cart");
  assert.equal(overview.screens[1]?.coveringTests[0]?.name, "Open cart");
  assert.equal(overview.screens[0]?.recentFailures[0]?.runId, "run-1");
  assert.equal(overview.pendingProposalCount, 1);
  assert.doesNotMatch(JSON.stringify(overview), /targetProfile|graph/iu);
});

test("map projection handles realistic empty maps without inventing paths", () => {
  const overview = projectProductMap({
    id: "empty",
    name: "Empty",
    revision: 1,
    screens: {},
    connections: {},
    tests: {},
    targetResults: {},
  } as never);
  assert.deepEqual(overview.coverage, {
    screenCount: 0,
    coveredScreenCount: 0,
    pathCount: 0,
    coveredPathCount: 0,
    testCount: 0,
  });
  assert.equal(overview.pendingProposalCount, 0);
  assert.equal(overview.paths.length, 0);
});

test("map drilldowns reuse the canonical App Map snapshot and fail closed for unknown ids", async () => {
  const map = {
    id: "app-1",
    name: "Checkout",
    revision: 2,
    screens: { home: { id: "home", title: "Home", variantIds: [] } },
    connections: {},
    tests: {},
    targetResults: {},
  } as never;
  const calls: string[] = [];
  const service = createProductMapService({
    async invoke(id: string) {
      calls.push(id);
      return { appMap: map };
    },
  } as never);
  assert.equal((await service.getScreen!("app-1", "home"))?.title, "Home");
  assert.equal(await service.getScreen!("app-1", "missing"), undefined);
  assert.equal(await service.getPath!("app-1", "missing"), undefined);
  assert.deepEqual(calls, ["app-map.get", "app-map.get", "app-map.get"]);
});

test("map proposal review forwards revision-guarded canonical mutations", async () => {
  const map = {
    id: "app-1",
    name: "Checkout",
    revision: 2,
    screens: {},
    connections: {},
    tests: {},
    targetResults: {},
    proposals: {
      proposal: {
        id: "proposal",
        title: "Repair checkout path",
        status: "pending",
        createdAt: 1,
        updatedAt: 2,
        baseRevision: 1,
      },
    },
  } as never;
  const calls: Array<{ id: string; input: unknown }> = [];
  const service = createProductMapService({
    async invoke(id: string, input: unknown) {
      calls.push({ id, input });
      return { appMap: map };
    },
  } as never);
  const proposals = await service.listProposals!("app-1");
  assert.deepEqual(proposals, [
    {
      id: "proposal",
      title: "Repair checkout path",
      status: "pending",
      createdAt: 1,
      updatedAt: 2,
      baseRevision: 1,
    },
  ]);
  await service.approveProposal!({
    appMapId: "app-1",
    proposalId: "proposal",
    expectedRevision: 2,
    reason: "Reviewed repair",
    prove: false,
  });
  await service.rejectProposal!({
    appMapId: "app-1",
    proposalId: "proposal",
    expectedRevision: 2,
    reason: "Not reproducible",
  });
  assert.deepEqual(
    calls.map(({ id }) => id),
    ["app-map.get", "app-map.proposal.approve", "app-map.proposal.reject"],
  );
  assert.deepEqual(calls[1]?.input, {
    appMapId: "app-1",
    proposalId: "proposal",
    expectedRevision: 2,
    reason: "Reviewed repair",
    prove: false,
  });
});
