import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PlanInputDataSetPicker } from "./plan-input-data-set-picker";
import type { PlanInputDataSetService } from "../data/plan-input-data-set-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let queryClient: QueryClient;
afterEach(() => {
  act(() => root?.unmount());
  queryClient?.clear();
  document.body.replaceChildren();
});
const catalog = {
  revision: 2,
  inputs: [
    {
      id: "stable-prompt",
      name: "chat_prompt",
      source: "list" as const,
      linked: false,
      addedToApp: false,
      values: ["A paper airplane", "An orange boat"],
    },
  ],
};
const result = {
  variableId: "input-prompts",
  editor: { appMapId: "grok", appName: "Grok", revision: 5, tests: [], dataSets: [] },
};
async function render(
  overrides: Partial<PlanInputDataSetService> = {},
  selectedTests: { id: string; name: string }[] = [],
) {
  const service = {
    listInputDataSets: vi.fn(async () => catalog),
    addInputDataSet: vi.fn(async () => result),
    ...overrides,
  };
  const onBusy = vi.fn();
  const onAdded = vi.fn();
  const onReload = vi.fn(async () => undefined);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <PlanInputDataSetPicker
          appMapId="grok"
          revision={4}
          service={service}
          selectedTests={selectedTests}
          disabled={false}
          onBusy={onBusy}
          onAdded={onAdded}
          onReload={onReload}
        />
      </QueryClientProvider>,
    ),
  );
  return { service, onBusy, onAdded, onReload };
}
function button(text: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
async function choose(opener = "Use saved input values", label = "chat_prompt") {
  await act(async () => button(opener).click());
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('[role="combobox"]')).not.toBeNull());
  });
  await act(async () => (document.querySelector('[role="combobox"]') as HTMLElement).click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === label,
  );
  await act(async () => option!.click());
}
it("previews saved values and adds them only after an explicit action", async () => {
  const { service, onAdded } = await render();
  await choose();
  expect(document.body.textContent).toContain("A paper airplane");
  expect(document.body.textContent).toContain("An orange boat");
  expect(service.addInputDataSet).not.toHaveBeenCalled();
  await act(async () => button("Add Data set").click());
  await act(async () => {
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledExactlyOnceWith(result));
  });
  expect(service.addInputDataSet).toHaveBeenCalledExactlyOnceWith({
    appMapId: "grok",
    expectedRevision: 4,
    catalogRevision: 2,
    inputId: "stable-prompt",
    name: "chat prompt",
  });
  expect(document.querySelector("#input-data-set-name")).toBeNull();
});
it("keeps the selection visible after a failed write and reloads without retrying the mutation", async () => {
  const addInputDataSet = vi.fn(async () => {
    throw new Error("This app changed");
  });
  const { onReload, onAdded } = await render({ addInputDataSet });
  await choose();
  await act(async () => button("Add Data set").click());
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("This app changed"));
  });
  expect((document.querySelector("#input-data-set-name") as HTMLInputElement).value).toBe(
    "chat prompt",
  );
  expect(document.body.textContent).toContain("An orange boat");
  await act(async () => button("Reload Data sets").click());
  expect(onReload).toHaveBeenCalledOnce();
  expect(addInputDataSet).toHaveBeenCalledOnce();
  expect(onAdded).not.toHaveBeenCalled();
});
it("disables cancellation and repeated writes until the server answers", async () => {
  let finish!: (value: typeof result) => void;
  const addInputDataSet = vi.fn(
    () =>
      new Promise<typeof result>((resolve) => {
        finish = resolve;
      }),
  );
  const { onBusy } = await render({ addInputDataSet });
  await choose();
  await act(async () => button("Add Data set").click());
  await act(async () => {
    await vi.waitFor(() => expect(addInputDataSet).toHaveBeenCalledOnce());
  });
  await act(async () => {
    await vi.waitFor(() => expect(button("Adding…").disabled).toBe(true));
  });
  expect(button("Adding…").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
  expect(onBusy).toHaveBeenCalledWith(true);
  await act(async () => finish(result));
  await act(async () => {
    await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  });
  expect(addInputDataSet).toHaveBeenCalledOnce();
});

async function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("creates two complete public prompt values from an empty catalog, then requires a separate Add Data set action", async () => {
  const values = [
    "  Tell me a short story.\nKeep its ending hopeful.  ",
    `${"A long prompt. ".repeat(20)}\nSecond line stays intact.`,
  ];
  const input = {
    id: "new-stable-input",
    name: "chat_prompt",
    source: "list" as const,
    values,
    linked: false,
    addedToApp: false,
  };
  const saveInputDefinition = vi.fn(async () => ({
    catalog: { revision: 3, inputs: [input] },
    inputId: input.id,
  }));
  const { service, onAdded } = await render(
    { listInputDataSets: async () => ({ revision: 2, inputs: [] }), saveInputDefinition },
    [{ id: "fast-test", name: "Fast chat" }],
  );
  await act(async () => button("Add prompt values").click());
  await act(async () => {
    await vi.waitFor(() => expect(button("Create prompt values").disabled).toBe(false));
  });
  expect(document.body.textContent).not.toContain("Project Data sets first");
  await act(async () => button("Create prompt values").click());
  await fill(
    document.querySelector<HTMLInputElement>('input[placeholder="For example, chat_prompt"]')!,
    "chat_prompt",
  );
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  await fill(fields[0]!, values[0]!);
  await fill(fields[1]!, values[1]!);
  await act(async () => button("Save prompt values").click());
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector("textarea")).toBeNull());
  });
  expect(saveInputDefinition).toHaveBeenCalledExactlyOnceWith({
    appMapId: "grok",
    catalogRevision: 2,
    name: "chat_prompt",
    source: "list",
    values,
  });
  expect(service.addInputDataSet).not.toHaveBeenCalled();
  expect(onAdded).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Saved values"]')?.textContent).toContain(values[0]);
  const link = document.querySelector<HTMLAnchorElement>('a[href="#/tests/fast-test?app=grok"]');
  expect(link?.textContent).toBe("Edit Fast chat in a new tab");
  expect(link?.target).toBe("_blank");
  expect(document.body.textContent).toContain("Run input named chat_prompt");
  await act(async () => button("Add Data set").click());
  expect(service.addInputDataSet).toHaveBeenCalledExactlyOnceWith({
    appMapId: "grok",
    expectedRevision: 4,
    catalogRevision: 3,
    inputId: input.id,
    name: "chat prompt",
  });
});

it("edits an unlinked public input by its stable ID without adding a Map Data set implicitly", async () => {
  const saveInputDefinition = vi.fn(async () => ({
    catalog: { ...catalog, revision: 3 },
    inputId: "stable-prompt",
  }));
  const { service } = await render({ saveInputDefinition });
  await choose("Add prompt values");
  await act(async () => button("Edit prompt values").click());
  expect(
    document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Saved input"]')
      ?.disabled,
  ).toBe(true);
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  expect(fields.map((field) => field.value)).toEqual(catalog.inputs[0]!.values);
  await fill(fields[1]!, "An edited orange boat\nFull details");
  await act(async () => button("Save prompt values").click());
  expect(saveInputDefinition).toHaveBeenCalledExactlyOnceWith({
    appMapId: "grok",
    catalogRevision: 2,
    inputId: "stable-prompt",
    name: "chat_prompt",
    source: "list",
    values: ["A paper airplane", "An edited orange boat\nFull details"],
  });
  expect(service.addInputDataSet).not.toHaveBeenCalled();
});

it.each([true, false])(
  "keeps already linked inputs read-only; added to this app: %s",
  async (addedToApp) => {
    const saveInputDefinition = vi.fn();
    const { service } = await render({
      listInputDataSets: async () => ({
        ...catalog,
        inputs: [{ ...catalog.inputs[0]!, linked: true, addedToApp }],
      }),
      saveInputDefinition,
    });
    await choose("Add prompt values", `chat_prompt${addedToApp ? " · Already added" : ""}`);
    expect(document.body.textContent).toContain(
      "Create a new input to keep existing plans unchanged",
    );
    expect(
      [...document.querySelectorAll("button")].some(
        (node) => node.textContent === "Edit prompt values",
      ),
    ).toBe(false);
    expect(button(addedToApp ? "Already added" : "Add Data set").disabled).toBe(addedToApp);
    if (!addedToApp) await act(async () => button("Add Data set").click());
    expect(service.addInputDataSet).toHaveBeenCalledTimes(addedToApp ? 0 : 1);
    expect(saveInputDefinition).not.toHaveBeenCalled();
  },
);
