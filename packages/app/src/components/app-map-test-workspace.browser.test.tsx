import { expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type {
  AppMap,
  AppMapCompiledTest,
  AppMapScenarioTest,
  AppMapScenarioTestEdit,
  AppMapTest,
} from "@relay/protocol";
import type { JobInfo } from "../lib/api-types";

const serverMock = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));

import { AppMapTestWorkspace } from "./app-map-test-workspace";

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
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
    screens: {},
    screenVariants: {},
    connections: {},
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
  };
}

test("scenario editor creates and edits stable intent without inventing a runnable binding", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [map, setMap] = createSignal(fixture());
  const saves: AppMapTest[] = [];
  const editBatches: AppMapScenarioTestEdit[][] = [];
  serverMock.current = {
    selectedAppMap: map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    saveTest: async ({ test }: { test: AppMapTest }) => {
      saves.push(structuredClone(test));
      const next = {
        ...map(),
        revision: map().revision + 1,
        tests: { ...map().tests, [test.id]: test },
      };
      setMap(next);
      return { appMap: { revision: next.revision } };
    },
    editTest: async ({ edits }: { edits: AppMapScenarioTestEdit[] }) => {
      editBatches.push(structuredClone(edits));
      return { appMap: { revision: map().revision + editBatches.length } };
    },
    refreshAppMaps: async () => undefined,
    runAction: async () => {
      throw new Error("An unresolved test must not compile");
    },
  };

  const dispose = render(() => <AppMapTestWorkspace onOpenMap={() => undefined} />, root);
  const create = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Create scenario test"),
  )!;
  create.click();
  await settle();
  expect(root.textContent).toContain("Test 1");
  root.querySelector<HTMLElement>("summary[aria-label='Test options']")!.click();
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Duplicate Test")!
    .click();
  await settle();
  expect(saves).toHaveLength(2);
  expect(root.textContent).toContain("Test 1 copy");

  const add = root.querySelector<HTMLButtonElement>("button[aria-label='Add Next step']")!;
  add.click();
  await settle();
  expect(root.textContent).toContain("Instruction");
  expect(root.textContent).toContain("incomplete");

  const intent = root.querySelector<HTMLTextAreaElement>("textarea[id^='test-step-intent-']")!;
  intent.value = "Open the reviewed cart";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(
    editBatches
      .flat()
      .some((edit) => edit.kind === "step.patch" && edit.patch.intent === "Open the reviewed cart"),
  ).toBe(true);
  const blockerAction = root.querySelector<HTMLButtonElement>("button[title*='Resolve']")!;
  expect(blockerAction.disabled).toBe(false);
  expect(blockerAction.textContent).toContain("Fix 1 binding");

  const rootKind = [...root.querySelectorAll<HTMLSelectElement>("select")].find((select) =>
    [...select.options].some((option) => option.value === "decision"),
  )!;
  rootKind.value = "decision";
  rootKind.dispatchEvent(new Event("change", { bubbles: true }));
  add.click();
  await settle();

  const thenDetails = [...root.querySelectorAll<HTMLDetailsElement>("details")].find((details) =>
    details.querySelector("summary")?.textContent?.includes("Add to Then"),
  )!;
  thenDetails.querySelector<HTMLButtonElement>("button[type='submit']")!.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 1: Instruction']")).not.toBeNull();

  root.querySelector<HTMLButtonElement>("button[aria-label='Duplicate Then 1']")!.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 2: Instruction']")).not.toBeNull();

  root.querySelector<HTMLButtonElement>("button[aria-label='Delete Then 1']")!.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 2: Instruction']")).toBeNull();
  expect(root.querySelector("button[aria-label^='Then 1: Instruction']")).not.toBeNull();
  expect(root.textContent).toContain("Deleted Describe what the person should do");

  const undo = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Undo",
  )!;
  undo.click();
  await settle();
  expect(root.querySelector("button[aria-label^='Then 2: Instruction']")).not.toBeNull();
  expect(editBatches.flat().some((edit) => edit.kind === "step.add")).toBe(true);

  dispose();
  document.body.replaceChildren();
});

test("revision conflict keeps the local Test draft and retries as semantic edits", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-scenario",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open-cart",
        intent: "Open cart",
        binding: { status: "unresolved", reason: "Needs mapping" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  const [map, setMap] = createSignal(initial);
  const editBatches: AppMapScenarioTestEdit[][] = [];
  let attempts = 0;
  serverMock.current = {
    selectedAppMap: map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    editTest: async ({ edits }: { edits: AppMapScenarioTestEdit[] }) => {
      editBatches.push(structuredClone(edits));
      attempts += 1;
      if (attempts === 1) throw new Error("Revision conflict: expected 1, current 2");
      return { appMap: { revision: 3 } };
    },
    refreshAppMaps: async () => {
      if (attempts === 1) setMap({ ...map(), revision: 2 });
      if (attempts === 2) {
        setMap({
          ...map(),
          revision: 3,
          tests: {
            ...map().tests,
            [scenario.id]: {
              ...scenario,
              steps: [{ ...scenario.steps[0]!, intent: "Open the reviewed cart safely" }],
            },
          },
        });
      }
    },
    runAction: async () => {
      throw new Error("An unresolved test must not compile");
    },
  };

  const dispose = render(
    () => <AppMapTestWorkspace testId="checkout-scenario" onOpenMap={() => undefined} />,
    root,
  );
  await settle();
  const intent = root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart")!;
  intent.value = "Open the reviewed cart";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();

  expect(root.textContent).toContain("Revision conflict");
  expect(intent.value).toBe("Open the reviewed cart");
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(root.textContent).toContain("Revision conflict");
  intent.value = "Open the reviewed cart safely";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(root.textContent).toContain("Revision conflict");
  const retry = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Retry save"),
  )!;
  retry.click();
  await settle();

  expect(attempts).toBe(2);
  expect(root.textContent).not.toContain("Revision conflict");
  expect(editBatches[1]).toEqual([
    {
      kind: "step.patch",
      stepId: "open-cart",
      patch: { intent: "Open the reviewed cart safely" },
    },
  ]);
  expect(root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart")?.value).toBe(
    "Open the reviewed cart safely",
  );

  dispose();
  document.body.replaceChildren();
});

test("a saved semantic edit settles after its projection refresh recovers", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-refresh",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout refresh",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "instruction",
        id: "open-cart-refresh",
        intent: "Open cart",
        binding: { status: "unresolved", reason: "Needs mapping" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  const [map, setMap] = createSignal(initial);
  let editCalls = 0;
  let refreshCalls = 0;
  serverMock.current = {
    selectedAppMap: map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    editTest: async () => {
      editCalls += 1;
      return { appMap: { revision: 2 } };
    },
    refreshAppMaps: async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) throw new Error("Projection unavailable");
      setMap({
        ...map(),
        revision: 2,
        tests: {
          ...map().tests,
          [scenario.id]: {
            ...scenario,
            steps: [{ ...scenario.steps[0]!, intent: "Open the reviewed cart" }],
          },
        },
      });
    },
    runAction: async () => {
      throw new Error("An unresolved test must not compile");
    },
  };

  const dispose = render(
    () => <AppMapTestWorkspace testId="checkout-refresh" onOpenMap={() => undefined} />,
    root,
  );
  await settle();
  const intent = root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart-refresh")!;
  intent.value = "Open the reviewed cart";
  intent.dispatchEvent(new InputEvent("input", { bubbles: true }));
  intent.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  await settle();
  expect(root.textContent).toContain("Projection unavailable");

  const retry = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Retry save"),
  )!;
  retry.click();
  await settle();

  expect(editCalls).toBe(1);
  expect(refreshCalls).toBe(2);
  expect(root.textContent).not.toContain("Projection unavailable");
  expect(root.textContent).toContain("1 incomplete");
  expect(
    root.querySelector<HTMLTextAreaElement>("#test-step-intent-open-cart-refresh")?.value,
  ).toBe("Open the reviewed cart");

  dispose();
  document.body.replaceChildren();
});

test("the primary Test action compiles, runs, cancels, and opens its exact result", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "checkout-run",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Checkout run",
    intentSchemaVersion: 1,
    steps: [
      {
        kind: "script",
        id: "prepare-cart",
        intent: "Prepare cart",
        binding: { status: "resolved", kind: "script", source: "return true" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const initial = fixture();
  initial.tests[scenario.id] = scenario;
  const rootRecipeId = "app-map:checkout:test:checkout-run:root:r1";
  const plan: AppMapCompiledTest = {
    schemaVersion: 1,
    appMapId: "checkout",
    appMapRevision: 1,
    test: {
      id: scenario.id,
      name: scenario.name,
      kind: "scenario",
      intentSchemaVersion: 1,
    },
    rootRecipeId,
    recipes: {
      [rootRecipeId]: {
        id: rootRecipeId,
        title: scenario.name,
        parameters: [],
        steps: [{ kind: "script", source: "return true" }],
      },
    },
    stepProvenance: [],
  };
  const [jobs, setJobs] = createSignal<JobInfo[]>([]);
  const calls: string[] = [];
  const opened: string[] = [];
  let finishRun!: () => void;
  const runGate = new Promise<void>((resolve) => (finishRun = resolve));
  let runInput: Record<string, unknown> | undefined;
  serverMock.current = {
    selectedAppMap: () => initial,
    isOffline: () => false,
    health: () => "online",
    devices: () => [
      { serial: "ipad-1", name: "Design iPad", platform: "ios", connectionState: "connected" },
    ],
    selectedDevice: () => "ipad-1",
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => ({ setup: {}, checks: [] }),
    jobs,
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    refreshJobs: async () => ({ ok: true }),
    runAction: async (id: string, input: Record<string, unknown>) => {
      calls.push(id);
      runInput = input;
      await runGate;
      setJobs([
        {
          id: "job-exact",
          action: rootRecipeId,
          status: "queued",
          queuedAt: 2,
          logs: [],
        },
      ]);
      return {
        plan,
        planIdentity: {
          appMapId: plan.appMapId,
          appMapRevision: plan.appMapRevision,
          testId: plan.test.id,
          rootRecipeId,
        },
        job: { id: "job-exact", action: rootRecipeId, status: "queued", queuedAt: 2 },
      };
    },
    cancelJob: async (id: string) => {
      calls.push(`cancel:${id}`);
      setJobs((current) => current.map((job) => ({ ...job, status: "cancelled" as const })));
    },
  };

  const dispose = render(
    () => (
      <AppMapTestWorkspace
        testId={scenario.id}
        onOpenMap={() => undefined}
        onOpenRun={(id) => opened.push(id)}
      />
    ),
    root,
  );
  await settle();
  expect(root.textContent).toContain("Ready to run");

  const primary = () =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      /Run test|Preparing run|Cancel queued run|Open result/.test(button.textContent ?? ""),
    )!;
  expect(primary().textContent).toContain("Run test");
  primary().click();
  await settle();

  expect(primary().textContent).toContain("Preparing run");
  expect(primary().getAttribute("aria-busy")).toBe("true");
  finishRun();
  await settle();

  expect(calls).toEqual(["app-map.test.run"]);
  expect(runInput).toEqual({
    appMapId: "checkout",
    testId: "checkout-run",
    expectedRevision: 1,
    target: { kind: "device", platform: "ios", targetId: "ipad-1" },
  });
  expect(primary().textContent).toContain("Cancel queued run");
  expect(root.textContent).toContain("Queued on the selected target");
  primary().click();
  await settle();

  expect(calls).toContain("cancel:job-exact");
  expect(primary().textContent).toContain("Open result");
  primary().click();
  expect(opened).toEqual(["job-exact"]);

  dispose();
  document.body.replaceChildren();
});

test("mobile Test authoring uses one focused pane and advances from Steps to Edit", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    media: "(max-width: 760px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as typeof window.matchMedia;
  const scenario: AppMapScenarioTest = {
    kind: "scenario",
    id: "mobile-test",
    organizationId: "org",
    projectId: "project",
    appMapId: "checkout",
    name: "Mobile checkout",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "mobile-step",
        kind: "instruction",
        intent: "Open checkout",
        binding: { status: "unresolved", reason: "Choose a path" },
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const map = fixture();
  map.tests[scenario.id] = scenario;
  map.proposals.mobileProposal = {
    id: "mobileProposal",
    organizationId: "org",
    projectId: "project",
    appMapId: map.id,
    baseRevision: map.revision,
    title: "Clarify checkout",
    status: "pending",
    changes: [
      {
        kind: "test.edit",
        testId: scenario.id,
        edits: [
          {
            kind: "step.patch",
            stepId: "mobile-step",
            patch: { intent: "Open the reviewed checkout" },
          },
        ],
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  serverMock.current = {
    selectedAppMap: () => map,
    isOffline: () => false,
    health: () => "online",
    devices: () => [],
    selectedDevice: () => null,
    liveFrame: () => null,
    liveCaptureIssue: () => null,
    appleDeviceSetup: () => null,
    jobs: () => [],
    persistedRuns: () => [],
    pollLiveFrame: async () => undefined,
    loadRunDetail: async () => undefined,
    frameUrlForPersisted: () => "",
    refreshAppMaps: async () => undefined,
    editTest: async () => ({ appMap: { revision: 2 } }),
    saveTest: async () => ({ appMap: { revision: 2 } }),
    runAction: async () => undefined,
  };

  const dispose = render(
    () => <AppMapTestWorkspace testId={scenario.id} onOpenMap={() => undefined} />,
    root,
  );
  await settle();
  const proposed = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("1 proposed"),
  )!;
  proposed.click();
  expect(root.textContent).toContain("Open the reviewed checkout");
  root.querySelector<HTMLButtonElement>("button[aria-label='Close Test proposal review']")!.click();
  expect(root.querySelector("[data-test-mobile-tab='steps']")?.getAttribute("aria-current")).toBe(
    "page",
  );
  root.querySelector<HTMLButtonElement>("#test-step-row-mobile-step")!.click();
  await settle();
  expect(root.querySelector("[data-test-mobile-tab='edit']")?.getAttribute("aria-current")).toBe(
    "page",
  );
  expect(document.activeElement?.id).toBe("test-step-intent-mobile-step");
  root.querySelector<HTMLButtonElement>("[data-test-mobile-tab='results']")!.click();
  expect(root.querySelector("[data-test-mobile-tab='results']")?.getAttribute("aria-current")).toBe(
    "page",
  );

  dispose();
  window.matchMedia = originalMatchMedia;
  document.body.replaceChildren();
});
