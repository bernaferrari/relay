import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PlanInputDataSetPicker } from "./plan-input-data-set-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  document.body.replaceChildren();
});
const action = {
  stepId: "type",
  stepTitle: "Type prompt",
  key: '["prompt","recorded","type-leaf"]',
  connectionId: "prompt",
  actionId: "recorded",
  recipeStepId: "type-leaf",
  text: "Original prompt",
  sharedTestNames: ["Other chat"],
  sharedSteps: [
    { testId: "fast", testName: "Fast chat", stepId: "again", stepTitle: "Repeat prompt" },
  ],
};
const preview = {
  token: "{{public-prompt-id}}",
  tests: [{ id: "fast", name: "Fast chat", actions: [action] }],
  options: [
    { id: "value-1", value: "Same prompt" },
    { id: "value-2", value: "Same prompt" },
  ],
};
function button(text: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
async function render(ambiguous = false, added = false, rejected = false) {
  let reloaded = false;
  const previewInputBindings = vi.fn(async () => ({
    ...preview,
    ...(added ? { variableId: "existing-prompts" } : {}),
    tests: [
      {
        ...preview.tests[0]!,
        actions: ambiguous
          ? [action, { ...action, key: "other-leaf", text: "Another field" }]
          : [{ ...action, text: reloaded ? "Updated prompt" : action.text }],
      },
    ],
  }));
  const result = {
    variableId: added ? "existing-prompts" : "new-prompts",
    selectedOptionIds: ["value-2"],
    editor: { appMapId: "grok", appName: "Grok", revision: 5, tests: [], dataSets: [] },
  };
  const addInputDataSet = vi.fn(async () => {
    if (rejected) throw new Error("The app changed");
    return result;
  });
  const service = {
    previewInputBindings,
    addInputDataSet,
    listInputDataSets: async () => ({
      revision: 2,
      inputs: [
        {
          id: "public-prompt-id",
          name: "chat_prompt",
          source: "list" as const,
          values: ["Same prompt", "Same prompt"],
          linked: added,
          addedToApp: added,
        },
      ],
    }),
  };
  const onAdded = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PlanInputDataSetPicker
          appMapId="grok"
          revision={4}
          service={service}
          selectedTests={[{ id: "fast", name: "Fast chat" }]}
          disabled={false}
          onBusy={() => {}}
          onAdded={onAdded}
          onReload={async () => {
            reloaded = true;
          }}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => button("Use saved input values").click());
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.querySelector('[aria-label="Saved input"]')).not.toBeNull(),
    );
  });
  await act(async () => document.querySelector<HTMLElement>('[aria-label="Saved input"]')!.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.startsWith("chat_prompt"))!
      .click(),
  );
  return { previewInputBindings, addInputDataSet, onAdded, result };
}

it("preselects the sole eligible action visibly, discloses shared effects, and passes distinct chosen row IDs", async () => {
  const { addInputDataSet, onAdded, result } = await render();
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Original prompt"));
  });
  expect(document.body.textContent).toContain("{{public-prompt-id}}");
  expect(document.body.textContent).toContain("Other chat");
  expect(document.body.textContent).toContain("Repeat prompt");
  expect(addInputDataSet).not.toHaveBeenCalled();
  const rows = document.querySelectorAll<HTMLElement>(
    '[aria-label="Values for this plan"] [role="checkbox"]',
  );
  expect(rows).toHaveLength(2);
  await act(async () => rows[0]!.closest("label")!.click());
  await act(async () => button("Use values in tests").click());
  expect(addInputDataSet).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      testIds: ["fast"],
      selectedOptionIds: ["value-2"],
      bindings: [
        {
          testId: "fast",
          stepId: "type",
          actionKey: action.key,
          text: "Original prompt",
        },
      ],
    }),
  );
  expect(onAdded).toHaveBeenCalledExactlyOnceWith(result);
});

it("preserves a rejected binding draft, then revalidates changed leaf text on explicit reload without retrying", async () => {
  const { addInputDataSet } = await render(false, false, true);
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Original prompt"));
  });
  await act(async () =>
    document
      .querySelector<HTMLElement>('[aria-label="Values for this plan"] [role="checkbox"]')!
      .closest("label")!
      .click(),
  );
  await act(async () => button("Use values in tests").click());
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("The app changed"));
  });
  expect(document.body.textContent).toContain("Original prompt");
  expect(
    document.querySelectorAll(
      '[aria-label="Values for this plan"] [role="checkbox"][data-checked]',
    ),
  ).toHaveLength(1);
  await act(async () => button("Reload Data sets").click());
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Choose a text action"));
  });
  expect(button("Use values in tests").disabled).toBe(true);
  expect(addInputDataSet).toHaveBeenCalledOnce();
  await act(async () =>
    document.querySelector<HTMLElement>('[aria-label="Text action for Fast chat"]')!.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.includes("Updated prompt"))!
      .click(),
  );
  expect(document.body.textContent).toContain("Updated prompt");
  expect(button("Use values in tests").disabled).toBe(false);
});

it("requires an explicit ambiguous text-action choice and can bind an already added Data set in place", async () => {
  const { addInputDataSet } = await render(true, true);
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).toContain("Choose a text action"));
  });
  expect(button("Use values in tests").disabled).toBe(true);
  await act(async () =>
    document.querySelector<HTMLElement>('[aria-label="Text action for Fast chat"]')!.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.includes("Original prompt"))!
      .click(),
  );
  expect(document.body.textContent).toContain("Original prompt");
  await act(async () => button("Use values in tests").click());
  expect(addInputDataSet).toHaveBeenCalledOnce();
});
