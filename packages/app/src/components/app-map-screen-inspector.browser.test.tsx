import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMap } from "@relay/protocol";
import type { MapTreeNode } from "../lib/app-map-tree";

const serverMock = vi.hoisted(() => ({
  current: {
    selectedDevice: () => null as string | null,
    selectedLeaseId: () => null as string | null,
  },
}));
vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));

import { ScreenInspector } from "./app-map-screen-inspector";

function node(id = "settings"): MapTreeNode {
  return {
    id,
    screenKey: id,
    title: "Settings",
    representativeStepIndex: -1,
    stepIndexes: [],
    depth: 0,
    x: 0,
    y: 0,
  };
}

function fixture(): AppMap {
  return {
    schemaVersion: 1,
    id: "checkout",
    organizationId: "org",
    projectId: "project",
    name: "Checkout",
    revision: 1,
    notes: {},
    groups: {},
    screens: {
      settings: {
        id: "settings",
        organizationId: "org",
        projectId: "project",
        appMapId: "checkout",
        title: "Settings",
        variantIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {},
    connections: {
      open: {
        id: "open",
        organizationId: "org",
        projectId: "project",
        appMapId: "checkout",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        state: "ready",
        actions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  } as AppMap;
}

function mount(map: AppMap) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <ScreenInspector
        node={node()}
        appMap={map}
        title="Settings"
        connections={[]}
        titleForScreen={(id) => id}
        onFlowSetup={() => undefined}
        onSelectConnection={() => undefined}
        onRename={() => undefined}
        onRemove={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );
  return {
    root,
    dispose() {
      dispose();
      root.remove();
    },
  };
}

test("Screen details do not expose a separate language execution path", () => {
  const view = mount(fixture());
  try {
    expect(view.root.querySelector("[data-across-languages]")).toBeNull();
    expect(view.root.textContent).not.toContain("Across languages");
  } finally {
    view.dispose();
  }
});
