import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import type { MapTreeNode } from "../lib/app-map-tree";

const serverMock = vi.hoisted(() => ({
  current: {
    selectedDevice: () => null as string | null,
    selectedLeaseId: () => null as string | null,
    runPathAcrossVariables: vi.fn(async () => ({ jobId: "job-1" })),
  },
}));
vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));

import { ScreenInspector } from "./app-map-screen-inspector";

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

function tour(): AppMapScenarioTest {
  return {
    kind: "scenario",
    id: "supergrok-locale-tour",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Locale tour",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open",
        intent: "Open Settings",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
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

test("Across languages is disabled until a language Variable exists", async () => {
  serverMock.current.runPathAcrossVariables.mockClear();
  const view = mount(fixture());
  try {
    await settle();
    const button = view.root.querySelector<HTMLButtonElement>("[data-across-languages]");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(view.root.textContent).toContain("Across languages…");
    expect(view.root.textContent).toContain("Teach a language Variable first");
    expect(view.root.querySelector("[data-across-languages-hint]")?.textContent).toBe(
      "Teach a language Variable first",
    );
    button?.click();
    await settle();
    expect(serverMock.current.runPathAcrossVariables).not.toHaveBeenCalled();
  } finally {
    view.dispose();
  }
});

test("clicking Across languages runs the matching Test across selected languages", async () => {
  serverMock.current.runPathAcrossVariables.mockClear();
  const map = fixture();
  const test = tour();
  map.tests[test.id] = test;
  map.variables.language = {
    id: "language",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Language",
    kind: "language",
    apply: { kind: "appLocale", app: "ai.x.grok" },
    options: [
      { id: "en", label: "English" },
      { id: "ja", label: "日本語" },
      { id: "pt", label: "Português" },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  map.combines["matrix-language-to-supergrok-locale-tour"] = {
    id: "matrix-language-to-supergrok-locale-tour",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Language × Locale tour",
    variableIds: ["language"],
    testIds: [test.id],
    selected: { language: ["ja", "pt"] },
    createdAt: 1,
    updatedAt: 1,
  };
  const view = mount(map);
  try {
    await settle();
    const button = view.root.querySelector<HTMLButtonElement>("[data-across-languages]");
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(view.root.textContent).toContain("Across languages…");
    expect(view.root.textContent).not.toContain("Teach a language Variable first");
    button?.click();
    await settle();
    expect(serverMock.current.runPathAcrossVariables).toHaveBeenCalledTimes(1);
    expect(serverMock.current.runPathAcrossVariables).toHaveBeenCalledWith({
      appMapId: "checkout",
      testId: "supergrok-locale-tour",
      variableIds: ["language"],
      selected: { language: ["ja", "pt"] },
    });
  } finally {
    view.dispose();
  }
});
