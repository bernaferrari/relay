import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { observedTargetOptions, selectedTargetKey } from "./app-map-test-binding-options";

function mapFixture(): AppMap {
  return {
    schemaVersion: 1,
    organizationId: "org",
    projectId: "project",
    id: "map",
    name: "Checkout",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    screens: {
      checkout: {
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        id: "checkout",
        title: "Checkout",
        variantIds: ["phone", "tablet"],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {
      phone: {
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        id: "phone",
        screenId: "checkout",
        targetProfile: {
          id: "ios",
          targetId: "phone",
          source: "device",
          name: "iOS",
          platform: "ios",
          capabilities: [],
          observedAt: 1,
        },
        observation: {
          fingerprint: "phone",
          volatileSignals: [],
          nodes: [
            { role: "button", label: "Pay", identifier: "checkout.pay" },
            { role: "text", label: "Total" },
          ],
        },
        evidenceIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
      tablet: {
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        id: "tablet",
        screenId: "checkout",
        targetProfile: {
          id: "ios-tablet",
          targetId: "tablet",
          source: "device",
          name: "iPad",
          platform: "ios",
          capabilities: [],
          observedAt: 1,
        },
        observation: {
          fingerprint: "tablet",
          volatileSignals: [],
          nodes: [{ role: "button", label: "Pay now", identifier: "checkout.pay" }],
        },
        evidenceIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    connections: {},
    flows: {},
    routines: {},
    variables: {},
    tests: {},
    combines: {},
    caseStacks: {},
    groups: {},
    notes: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
  };
}

test("observed target choices prefer stable identifiers and deduplicate variants", () => {
  const options = observedTargetOptions(mapFixture());
  assert.deepEqual(options, [
    {
      key: "identifier:checkout.pay",
      label: "Pay",
      context: "Checkout · button",
      target: { identifier: "checkout.pay" },
    },
    {
      key: "label:Total",
      label: "Total",
      context: "Checkout · text",
      target: { label: "Total" },
    },
  ]);
  assert.equal(
    selectedTargetKey(options, { identifier: "checkout.pay" }),
    "identifier:checkout.pay",
  );
  assert.equal(selectedTargetKey(options, { identifier: "legacy" }), "");
});
