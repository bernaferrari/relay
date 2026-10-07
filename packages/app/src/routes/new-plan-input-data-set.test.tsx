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
    const input = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
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
        inputs: [{ id: "prompt", name: "chat_prompt", values: ["A paper airplane"] }],
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
