/** @jsxImportSource react */
import type { AppMapScenarioTestEdit } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type {
  ProductTestEditorDocument,
  TestEditorProductService,
} from "../data/test-editor-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://127.0.0.1:8787",
  storage: { get: () => null, set: () => undefined, remove: () => undefined },
};

const initialDocument: ProductTestEditorDocument = {
  appMapId: "app-private-id",
  appName: "Shopping",
  revision: 7,
  test: {
    id: "test-checkout",
    organizationId: "local",
    projectId: "default",
    appMapId: "app-private-id",
    name: "Complete checkout",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "step-cart",
        kind: "instruction",
        intent: "Open the cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["cart"] },
      },
      {
        id: "step-pay",
        kind: "validation",
        intent: "Confirm the total",
        note: "Tax is included",
        capture: true,
        binding: { status: "unresolved", reason: "Choose the updated total label." },
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  },
  history: [
    {
      id: "event-one",
      actorKind: "human",
      summary: "Edited Complete checkout",
      at: Date.now() - 60_000,
      beforeRevision: 6,
      afterRevision: 7,
    },
  ],
  repairs: [
    {
      id: "repair-one",
      title: "Use the updated total label",
      description: "Relay found a reviewed replacement for the missing checkpoint.",
      status: "pending",
      createdAt: 1,
      updatedAt: 2,
      editCount: 1,
    },
  ],
};

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

function service() {
  let current = structuredClone(initialDocument);
  const edits: AppMapScenarioTestEdit[][] = [];
  const decisions: string[] = [];
  const editor: TestEditorProductService = {
    get: async () => structuredClone(current),
    edit: async ({ edits: nextEdits }) => {
      edits.push(structuredClone([...nextEdits]));
      for (const edit of nextEdits) {
        if (edit.kind === "step.patch") {
          current.test.steps = current.test.steps.map((step) =>
            step.id === edit.stepId
              ? {
                  ...step,
                  ...(edit.patch.intent === undefined ? {} : { intent: edit.patch.intent }),
                  ...(edit.patch.note === undefined
                    ? {}
                    : edit.patch.note === null
                      ? { note: undefined }
                      : { note: edit.patch.note }),
                  ...(edit.patch.capture === undefined ? {} : { capture: edit.patch.capture }),
                }
              : step,
          );
        }
        if (edit.kind === "step.reorder") {
          current.test.steps = edit.orderedStepIds.map(
            (id) => current.test.steps.find((step) => step.id === id)!,
          );
        }
      }
      current.revision += 1;
      return structuredClone(current);
    },
    decideRepair: async ({ decision }) => {
      decisions.push(decision);
      current.repairs = [];
      current.revision += 1;
      return structuredClone(current);
    },
  };
  return { editor, edits, decisions };
}

async function render(editor: TestEditorProductService) {
  const history = createMemoryHistory({
    initialEntries: ["/tests/test-checkout/edit?step=step-pay"],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        testEditorService={editor}
      />,
    );
  });
  await settle();
  return history;
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

async function click(label: string) {
  const target = [...document.querySelectorAll<HTMLElement>("button, a")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
  if (!target) throw new Error(`Control not found: ${label}`);
  await act(async () => target.click());
  await settle();
}

describe("Test editor", () => {
  it("opens a route-selected step and saves a stable-ID patch", async () => {
    const harness = service();
    const history = await render(harness.editor);

    expect(history.location.search).toContain("step=step-pay");
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Confirm the total",
    );
    expect(document.body.textContent).toContain("Step needs review");
    expect(document.body.textContent).toContain("Edited Complete checkout");

    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-intent")!,
      "Confirm the final total",
    );
    await click("Save step");

    expect(harness.edits.at(-1)).toEqual([
      {
        kind: "step.patch",
        stepId: "step-pay",
        patch: {
          intent: "Confirm the final total",
          note: "Tax is included",
          capture: true,
        },
      },
    ]);
    expect(document.body.textContent).toContain("Saved");
  });

  it("reorders through keyboard-equivalent controls and undoes canonically", async () => {
    const harness = service();
    await render(harness.editor);

    await click("Move Confirm the total up");
    expect(harness.edits.at(-1)).toEqual([
      { kind: "step.reorder", orderedStepIds: ["step-pay", "step-cart"] },
    ]);

    await click("Undo last saved change");
    expect(harness.edits.at(-1)).toEqual([
      { kind: "step.reorder", orderedStepIds: ["step-cart", "step-pay"] },
    ]);
  });

  it("reviews a production-backed repair proposal", async () => {
    const harness = service();
    await render(harness.editor);

    expect(document.body.textContent).toContain("Use the updated total label");
    await click("Apply repair");
    expect(harness.decisions).toEqual(["approve"]);
    expect(document.body.textContent).toContain("No repairs are waiting for review");
  });
});
