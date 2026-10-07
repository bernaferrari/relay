import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PlanInputDataSetPicker } from "./plan-input-data-set-picker";
import type { PlanInputDataSetService } from "../data/plan-input-data-set-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
const catalog = {
  revision: 2,
  inputs: [
    { id: "stable-prompt", name: "chat_prompt", values: ["A paper airplane", "An orange boat"] },
  ],
};
const result = {
  variableId: "input-prompts",
  editor: { appMapId: "grok", appName: "Grok", revision: 5, tests: [], dataSets: [] },
};
async function render(overrides: Partial<PlanInputDataSetService> = {}) {
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PlanInputDataSetPicker
          appMapId="grok"
          revision={4}
          service={service}
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
async function choose() {
  await act(async () => button("Use saved input values").click());
  await act(async () => {
    await vi.waitFor(() => expect(document.querySelector('[role="combobox"]')).not.toBeNull());
  });
  await act(async () => (document.querySelector('[role="combobox"]') as HTMLElement).click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === "chat_prompt",
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
    throw new Error("This App changed");
  });
  const { onReload, onAdded } = await render({ addInputDataSet });
  await choose();
  await act(async () => button("Add Data set").click());
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("This App changed"));
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
