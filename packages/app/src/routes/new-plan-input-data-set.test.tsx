import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NewPlanDialog } from "./new-plan-dialog";

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => context.value,
  useNavigate: () => context.navigate,
}));
vi.mock("./recording-shared", () => ({ PageLoading: () => <p>Loading</p> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  context.navigate.mockClear();
});
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Missing ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function wait(check: () => void) {
  await act(async () => {
    await vi.waitFor(check);
  });
}
async function fill(id: string, value: string) {
  await act(async () => {
    const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("passes the chosen prompt row identities from inline binding into the saved Plan", async () => {
  const editor = {
    appMapId: "grok",
    appName: "Grok",
    revision: 4,
    tests: [{ id: "fast", name: "Fast chat", status: "ready" }],
    dataSets: [],
  };
  const saveSuite = vi.fn(async () => ({ id: "plan", appMapId: "grok" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const addInputDataSet = vi.fn(async () => ({
    variableId: "prompts",
    selectedOptionIds: ["value-2"],
    editor: {
      ...editor,
      revision: 5,
      dataSets: [{ id: "prompts", name: "Prompts", kind: "custom", optionCount: 2 }],
    },
  }));
  context.value = {
    queryClient: client,
    productService: { listApps: async () => [{ id: "grok", name: "Grok" }] },
    suiteProfileService: {
      getSuiteEditor: async () => editor,
      saveSuite,
      addInputDataSet,
      listInputDataSets: async () => ({
        revision: 2,
        inputs: [
          {
            id: "public-prompts",
            name: "chat_prompt",
            source: "list",
            values: ["Same prompt", "Same prompt"],
            linked: false,
            addedToApp: false,
          },
        ],
      }),
      previewInputBindings: async () => ({
        token: "{{public-prompts}}",
        options: [
          { id: "value-1", value: "Same prompt" },
          { id: "value-2", value: "Same prompt" },
        ],
        tests: [
          {
            id: "fast",
            name: "Fast chat",
            actions: [
              {
                key: "leaf",
                stepId: "type",
                stepTitle: "Type prompt",
                connectionId: "connection",
                actionId: "type",
                text: "Original prompt",
                sharedTestNames: [],
                sharedSteps: [],
              },
            ],
          },
        ],
      }),
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NewPlanDialog appId="grok" />
      </QueryClientProvider>,
    ),
  );
  await wait(() => expect(button("New plan").disabled).toBe(false));
  await click("New plan");
  await wait(() => expect(document.body.textContent).toContain("Fast chat"));
  await fill("suite-name", "Two ordinary prompts");
  await act(async () =>
    document.querySelector<HTMLElement>('[role="checkbox"]')!.closest("label")!.click(),
  );
  await click("Use saved input values");
  await wait(() => expect(document.querySelector('[aria-label="Saved input"]')).not.toBeNull());
  await act(async () => document.querySelector<HTMLElement>('[aria-label="Saved input"]')!.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.trim() === "chat_prompt")!
      .click(),
  );
  await wait(() => expect(document.body.textContent).toContain("Original prompt"));
  await act(async () =>
    document
      .querySelector<HTMLElement>('[aria-label="Values for this Plan"] [role="checkbox"]')!
      .closest("label")!
      .click(),
  );
  await click("Use values in Tests");
  await wait(() => expect(addInputDataSet).toHaveBeenCalledOnce());
  await click("Save Plan");
  await wait(() => expect(saveSuite).toHaveBeenCalledOnce());
  expect(saveSuite).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 5,
      testIds: ["fast"],
      variableIds: ["prompts"],
      selected: { prompts: ["value-2"] },
    }),
  );
});
it("retains the unsaved Plan and Test selection while adding prompt values, then saves at the returned map revision", async () => {
  const editor = {
    appMapId: "grok",
    appName: "Grok",
    revision: 4,
    tests: [{ id: "fast", name: "Fast chat", status: "ready" }],
    dataSets: [],
  };
  let finish!: (value: unknown) => void;
  const addInputDataSet = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saveSuite = vi.fn(async () => ({ id: "plan", appMapId: "grok" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  context.value = {
    queryClient: client,
    productService: { listApps: async () => [{ id: "grok", name: "Grok" }] },
    suiteProfileService: {
      getSuiteEditor: async () => editor,
      saveSuite,
      listInputDataSets: async () => ({
        revision: 2,
        inputs: [
          {
            id: "prompt",
            name: "chat_prompt",
            source: "list",
            values: ["A paper airplane"],
            linked: false,
            addedToApp: false,
          },
        ],
      }),
      addInputDataSet,
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NewPlanDialog appId="grok" />
      </QueryClientProvider>,
    ),
  );
  await wait(() => expect(button("New plan").disabled).toBe(false));
  await click("New plan");
  await wait(() => expect(document.body.textContent).toContain("Fast chat"));
  await fill("suite-name", "Grok recurring smoke");
  await act(async () => document.querySelector('[role="checkbox"]')!.closest("label")!.click());
  await wait(() => expect(document.body.textContent).toContain("Tests · 1 selected"));
  expect(button("Save Plan").disabled).toBe(false);
  await click("Use saved input values");
  await wait(() => expect(document.querySelectorAll('[role="combobox"]').length).toBe(3));
  await act(async () =>
    document.querySelector<HTMLElement>('[role="combobox"][aria-label="Saved input"]')!.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.trim() === "chat_prompt")!
      .click(),
  );
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => document.getElementById("input-data-set-name")!.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true);
  await wait(() => expect(addInputDataSet).toHaveBeenCalledOnce());
  expect(button("Save Plan").disabled).toBe(true);
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(saveSuite).not.toHaveBeenCalled();
  await act(async () =>
    finish({
      variableId: "input-prompts",
      editor: {
        ...editor,
        revision: 5,
        dataSets: [{ id: "input-prompts", name: "Chat prompts", kind: "custom", optionCount: 1 }],
      },
    }),
  );
  await wait(() => expect(button("Save Plan").disabled).toBe(false));
  expect((document.getElementById("suite-name") as HTMLInputElement).value).toBe(
    "Grok recurring smoke",
  );
  await click("Save Plan");
  await wait(() => expect(saveSuite).toHaveBeenCalledOnce());
  expect(saveSuite).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 5,
      name: "Grok recurring smoke",
      testIds: ["fast"],
      variableIds: ["input-prompts"],
    }),
  );
});

it("creates two public prompt values inside the unsaved Plan, blocks parent submission while saving, and adds them explicitly", async () => {
  const editor = {
    appMapId: "grok",
    appName: "Grok",
    revision: 4,
    tests: [{ id: "fast", name: "Fast chat", status: "ready" }],
    dataSets: [],
  };
  const values = [
    "  A useful first prompt.\nKeep this complete.  ",
    "A useful second prompt.\nKeep this complete too.",
  ];
  const savedInput = {
    id: "public-prompts",
    name: "chat_prompt",
    source: "list",
    values,
    linked: false,
    addedToApp: false,
  };
  let finish!: (value: unknown) => void;
  const saveInputDefinition = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const addInputDataSet = vi.fn(async () => ({
    variableId: "prompt-rows",
    editor: {
      ...editor,
      revision: 5,
      dataSets: [{ id: "prompt-rows", name: "Chat prompts", kind: "custom", optionCount: 2 }],
    },
  }));
  const saveSuite = vi.fn(async () => ({ id: "plan", appMapId: "grok" }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  context.value = {
    queryClient: client,
    productService: { listApps: async () => [{ id: "grok", name: "Grok" }] },
    suiteProfileService: {
      getSuiteEditor: async () => editor,
      saveSuite,
      listInputDataSets: async () => ({ revision: 2, inputs: [] }),
      addInputDataSet,
      saveInputDefinition,
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NewPlanDialog appId="grok" />
      </QueryClientProvider>,
    ),
  );
  await wait(() => expect(button("New plan").disabled).toBe(false));
  await click("New plan");
  await wait(() => expect(document.body.textContent).toContain("Fast chat"));
  await fill("suite-name", "Grok paired prompts");
  await act(async () => document.querySelector('[role="checkbox"]')!.closest("label")!.click());
  await click("Add prompt values");
  await wait(() => expect(button("Create prompt values").disabled).toBe(false));
  await click("Create prompt values");
  expect(document.querySelectorAll("form")).toHaveLength(1);
  const inputName = document.querySelector<HTMLInputElement>(
    'input[placeholder="For example, chat_prompt"]',
  )!;
  await fill(inputName.id, "chat_prompt");
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  await fill(fields[0]!.id, values[0]!);
  await fill(fields[1]!.id, values[1]!);
  await act(async () => {
    button("Save prompt values").click();
    button("Save prompt values").click();
  });
  await wait(() => expect(saveInputDefinition).toHaveBeenCalledOnce());
  expect(button("Save Plan").disabled).toBe(true);
  expect(fields.every((field) => field.disabled)).toBe(true);
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(saveSuite).not.toHaveBeenCalled();
  await act(async () =>
    finish({ catalog: { revision: 3, inputs: [savedInput] }, inputId: savedInput.id }),
  );
  await wait(() => expect(document.querySelector("textarea")).toBeNull());
  expect(saveInputDefinition).toHaveBeenCalledExactlyOnceWith({
    appMapId: "grok",
    catalogRevision: 2,
    name: "chat_prompt",
    source: "list",
    values,
  });
  expect(addInputDataSet).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLAnchorElement>('a[href="#/tests/fast?app=grok"]')?.target).toBe(
    "_blank",
  );
  expect((document.getElementById("suite-name") as HTMLInputElement).value).toBe(
    "Grok paired prompts",
  );
  expect(document.body.textContent).toContain("Tests · 1 selected");
  await click("Add Data set");
  expect(addInputDataSet).toHaveBeenCalledExactlyOnceWith({
    appMapId: "grok",
    expectedRevision: 4,
    catalogRevision: 3,
    inputId: "public-prompts",
    name: "chat prompt",
  });
  await wait(() => expect(button("Save Plan").disabled).toBe(false));
  await click("Save Plan");
  await wait(() => expect(saveSuite).toHaveBeenCalledOnce());
  expect(saveSuite).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 5,
      name: "Grok paired prompts",
      testIds: ["fast"],
      variableIds: ["prompt-rows"],
    }),
  );
});

it("disambiguates similar saved Speed Tests by canonical step count and update time while retaining the Plan draft", async () => {
  const saveSuite = vi.fn(async () => ({ id: "plan", appMapId: "grok" }));
  const tests = [
    {
      id: "speed-old",
      name: "Imagine Speed image generation",
      status: "ready",
      stepCount: 7,
      updatedAt: Date.UTC(2026, 9, 6, 12),
    },
    {
      id: "speed-new",
      name: "Imagine Speed image generation",
      status: "ready",
      stepCount: 10,
      updatedAt: Date.UTC(2026, 9, 7, 14),
    },
  ];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  context.value = {
    queryClient: client,
    productService: { listApps: async () => [{ id: "grok", name: "Grok" }] },
    suiteProfileService: {
      getSuiteEditor: async () => ({
        appMapId: "grok",
        appName: "Grok",
        revision: 4,
        tests,
        dataSets: [],
      }),
      saveSuite,
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NewPlanDialog appId="grok" />
      </QueryClientProvider>,
    ),
  );
  await wait(() => expect(button("New plan").disabled).toBe(false));
  await click("New plan");
  await wait(() => expect(document.querySelectorAll('[role="checkbox"]').length).toBe(2));
  const choices = [...document.querySelectorAll('[role="checkbox"]')].map((item) =>
    item.closest("label")!,
  );
  expect(choices[0]!.textContent).toContain("7 steps");
  expect(choices[1]!.textContent).toContain("10 steps");
  expect(choices[0]!.querySelector("[title]")?.getAttribute("title")).not.toBe(
    choices[1]!.querySelector("[title]")?.getAttribute("title"),
  );
  expect(choices.every((item) => !item.textContent?.includes("Ready"))).toBe(true);
  await fill("suite-name", "Grok prompt checks");
  await act(async () => choices[1]!.click());
  await fill("suite-name", "Grok paired prompt checks");
  expect(document.querySelectorAll('[role="checkbox"][aria-checked="true"]').length).toBe(1);
  await click("Save Plan");
  await wait(() => expect(saveSuite).toHaveBeenCalledOnce());
  expect(saveSuite).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Grok paired prompt checks", testIds: ["speed-new"] }),
  );
});
