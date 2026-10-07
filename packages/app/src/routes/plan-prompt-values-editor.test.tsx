/** @jsxImportSource react */
import { act, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MAX_INPUT_DATA_SET_VALUE_LENGTH } from "@relay/protocol";
import { PlanPromptValuesEditor, type PromptValuesDraft } from "./plan-prompt-values-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let client: QueryClient;
afterEach(() => {
  act(() => root?.unmount());
  client?.clear();
  document.body.replaceChildren();
});
async function render({
  onSave = vi.fn(async () => undefined),
  definition,
  onReload = vi.fn(async () => undefined),
}: {
  onSave?: (draft: PromptValuesDraft) => Promise<void>;
  definition?: PromptValuesDraft;
  onReload?: () => Promise<unknown>;
} = {}) {
  const onBusy = vi.fn();
  const onSaved = vi.fn();
  const onSubmitPlan = vi.fn((event: FormEvent) => event.preventDefault());
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <form onSubmit={onSubmitPlan}>
          <PlanPromptValuesEditor
            definition={definition}
            disabled={false}
            onBusy={onBusy}
            onSave={onSave}
            onSaved={onSaved}
            onCancel={vi.fn()}
            onReload={onReload}
          />
        </form>
      </QueryClientProvider>,
    ),
  );
  return { onSave, onBusy, onSaved, onSubmitPlan, onReload };
}
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  )!;
}
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

it("associates labels, keeps ordinary Enter for multiline prompts and saves with Ctrl+Enter without submitting the parent Plan", async () => {
  const h = await render();
  expect(document.querySelectorAll("form")).toHaveLength(1);
  for (const label of document.querySelectorAll<HTMLLabelElement>("label"))
    expect(document.getElementById(label.htmlFor)).not.toBeNull();
  const values = [" First prompt\nWith a second line ", "Second full prompt"];
  await fill(document.querySelector<HTMLInputElement>("input")!, "chat_prompt");
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  await fill(fields[0]!, values[0]!);
  await fill(fields[1]!, values[1]!);
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => fields[0]!.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(false);
  expect(h.onSave).not.toHaveBeenCalled();
  const save = new KeyboardEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => fields[0]!.dispatchEvent(save));
  expect(save.defaultPrevented).toBe(true);
  expect(h.onSave).toHaveBeenCalledExactlyOnceWith({ name: "chat_prompt", source: "list", values });
  expect(h.onSubmitPlan).not.toHaveBeenCalled();
});

it("validates on save and clears each field error as the user corrects it", async () => {
  const h = await render();
  const name = document.querySelector<HTMLInputElement>("input")!;
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(document.body.textContent).toContain(
    "Match the Test’s Run input name. Use letters, numbers, _ . or -.",
  );
  await fill(name, "Image prompts");
  await fill(fields[0]!, "First prompt");
  await act(async () => button("Save prompt values").click());
  expect(h.onSave).not.toHaveBeenCalled();
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(fields[1]!.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(name);
  await fill(name, "image_prompt");
  await fill(fields[1]!, "Second prompt");
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  await act(async () => button("Save prompt values").click());
  expect(h.onSave).toHaveBeenCalledOnce();
});

it("prevents same-tick duplicate saves and keeps a failed save draft through a read-only reload", async () => {
  let reject!: (error: Error) => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const h = await render({ onSave });
  await fill(document.querySelector<HTMLInputElement>("input")!, "chat_prompt");
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  await fill(fields[0]!, "A retained prompt\nwith whitespace  ");
  await fill(fields[1]!, "Another retained prompt");
  await act(async () => {
    button("Save prompt values").click();
    button("Save prompt values").click();
  });
  expect(onSave).toHaveBeenCalledOnce();
  expect(fields.every((field) => field.disabled)).toBe(true);
  expect(button("Cancel editing").disabled).toBe(true);
  await act(async () => reject(new Error("These saved values changed. Reload before saving.")));
  await act(async () => {
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "These saved values changed. Reload before saving.",
      ),
    );
  });
  expect(fields[0]!.value).toBe("A retained prompt\nwith whitespace  ");
  expect(button("Save prompt values").disabled).toBe(true);
  await act(async () => button("Reload saved inputs").click());
  await act(async () => {
    await vi.waitFor(() => expect(button("Save prompt values").disabled).toBe(false));
  });
  expect(h.onReload).toHaveBeenCalledOnce();
  expect(onSave).toHaveBeenCalledOnce();
  expect(h.onSaved).not.toHaveBeenCalled();
  expect(fields[0]!.value).toBe("A retained prompt\nwith whitespace  ");
  expect(button("Save prompt values").disabled).toBe(false);
});

it("prefills and preserves a public single-value input's source", async () => {
  const definition = {
    name: "chat_prompt",
    source: "static" as const,
    values: [" Original prompt\nwith spaces "],
  };
  const h = await render({ definition });
  const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(field.value).toBe(definition.values[0]);
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
  await fill(field, " Updated prompt\nwith spaces ");
  await act(async () => button("Save prompt values").click());
  expect(h.onSave).toHaveBeenCalledExactlyOnceWith({
    name: "chat_prompt",
    source: "static",
    values: [" Updated prompt\nwith spaces "],
  });
});

it("keeps an oversized prompt intact and validates its bound only on save", async () => {
  const h = await render();
  await fill(document.querySelector<HTMLInputElement>("input")!, "image_prompt");
  const fields = [...document.querySelectorAll<HTMLTextAreaElement>("textarea")];
  const longPrompt = "a".repeat(MAX_INPUT_DATA_SET_VALUE_LENGTH + 1);
  await fill(fields[0]!, longPrompt);
  await fill(fields[1]!, "Second complete prompt");
  expect(fields[0]!.value).toBe(longPrompt);
  expect(fields[0]!.getAttribute("aria-invalid")).toBe("false");
  await act(async () => button("Save prompt values").click());
  expect(h.onSave).not.toHaveBeenCalled();
  expect(fields[0]!.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(fields[0]);
  await fill(fields[0]!, longPrompt.slice(0, MAX_INPUT_DATA_SET_VALUE_LENGTH));
  await act(async () => button("Save prompt values").click());
  expect(h.onSave).toHaveBeenCalledExactlyOnceWith({
    name: "image_prompt",
    source: "list",
    values: [longPrompt.slice(0, MAX_INPUT_DATA_SET_VALUE_LENGTH), "Second complete prompt"],
  });
});
