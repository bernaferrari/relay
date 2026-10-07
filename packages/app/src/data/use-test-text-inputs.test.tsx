/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useTestTextInputs } from "./use-test-text-inputs";
import type {
  ProductTestEditorDocument,
  TestEditorProductService,
} from "./test-editor-product-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("uses project defaults, keeps private values local, and drops overrides when the saved Test changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  const root = createRoot(host);
  let current = {
    appMapId: "grok",
    test: { id: "chat" },
    textActions: { type: [{ text: "{{chat_prompt}} {{secret}} {{generated_prompt}}" }] },
  } as unknown as ProductTestEditorDocument;
  const service = {
    listTextParameters: async () => [
      {
        id: "prompt",
        name: "chat_prompt",
        scope: "shared",
        source: "list",
        values: ["Default A", "Default B"],
      },
      {
        id: "generated",
        name: "generated_prompt",
        scope: "shared",
        source: "generated",
        prompt: "Generate one prompt",
        values: ["Never replace generation with a stored preview"],
      },
      {
        id: "secret",
        name: "secret",
        scope: "private",
        source: "static",
        values: ["Never display or submit"],
      },
    ],
  } as unknown as TestEditorProductService;
  let state!: ReturnType<typeof useTestTextInputs>;
  function Harness() {
    state = useTestTextInputs(current, service);
    return null;
  }
  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let index = 0; index < 4; index++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
  }
  try {
    await render();
    expect(state.variables).toEqual({ chat_prompt: "Default A" });
    expect(state.inputs.find((input) => input.name === "secret")!.value).toBe("");
    expect(state.ready).toBe(false);
    await act(async () => state.setValue("secret", "Local input"));
    expect(state.ready).toBe(true);
    expect(state.variables).toEqual({ chat_prompt: "Default A", secret: "Local input" });
    current = {
      ...current,
      test: { ...current.test, id: "other" },
      textActions: { type: [{ text: "{{chat_prompt}}" }] },
    } as unknown as ProductTestEditorDocument;
    await render();
    expect(state.variables).toEqual({ chat_prompt: "Default A" });
    expect(state.ready).toBe(true);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
