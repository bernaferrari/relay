import { ApiError } from "@relay/client";
/** @jsxImportSource react */
import type { AppMapScenarioTestEdit, AppMapScenarioTestStep } from "@relay/protocol";
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
      eventType: "test.saved",
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

function service(source: ProductTestEditorDocument = initialDocument) {
  let current = structuredClone(source);
  const edits: AppMapScenarioTestEdit[][] = [];
  const decisions: string[] = [];
  const historyCalls: string[] = [];
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
          current.test.steps = edit.orderedStepIds.map((id) =>
            current.test.steps.find((step) => step.id === id)!,
          );
        }
        if (edit.kind === "step.add") {
          current.test.steps.splice(
            edit.index ?? current.test.steps.length,
            0,
            structuredClone(edit.step),
          );
        }
        if (edit.kind === "step.remove") {
          current.test.steps = current.test.steps.filter((step) => step.id !== edit.stepId);
        }
        if (edit.kind === "step.bind") {
          current.test.steps = current.test.steps.map((step) =>
            step.id === edit.stepId
              ? ({ ...step, binding: structuredClone(edit.binding) } as AppMapScenarioTestStep)
              : step,
          );
        }
        if (edit.kind === "step.unbind") {
          current.test.steps = current.test.steps.map((step) =>
            step.id === edit.stepId
              ? {
                  ...step,
                  binding: {
                    status: "unresolved",
                    reason: edit.reason,
                    ...(edit.candidates ? { candidates: structuredClone(edit.candidates) } : {}),
                  },
                }
              : step,
          );
        }
      }
      current.revision += 1;
      return structuredClone(current);
    },
    undo: async () => {
      historyCalls.push("undo");
      current.revision += 1;
      current.history = [
        { ...current.history[0]!, id: `undo-${current.revision}`, eventType: "test.undone" },
        ...current.history,
      ];
      return structuredClone(current);
    },
    redo: async () => {
      historyCalls.push("redo");
      current.revision += 1;
      current.history = [
        { ...current.history[0]!, id: `redo-${current.revision}`, eventType: "test.redone" },
        ...current.history,
      ];
      return structuredClone(current);
    },
    decideRepair: async ({ decision }) => {
      decisions.push(decision);
      current.repairs = [];
      current.revision += 1;
      return structuredClone(current);
    },
  };
  return { editor, edits, decisions, historyCalls };
}

async function render(
  editor: TestEditorProductService,
  path = "/tests/test-checkout/edit?step=step-pay",
  renderPlatform: Platform = platform,
) {
  const history = createMemoryHistory({
    initialEntries: [path],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={renderPlatform}
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

async function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(input, value);
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
  it("preserves a draft through a revision conflict and saves it on retry", async () => {
    const harness = service();
    const save = harness.editor.edit;
    harness.editor.edit = async () => {
      throw new ApiError(409, "Revision conflict");
    };
    await render(harness.editor);
    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-intent")!,
      "Keep this changed expectation",
    );
    await click("Save step");
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Keep this changed expectation",
    );
    expect(document.querySelector('[data-state="conflicted"]')?.textContent).toContain(
      "draft is preserved",
    );
    harness.editor.edit = save;
    await click("Save step");
    expect(document.querySelector('[data-state="conflicted"]')).toBeNull();
    expect(document.querySelector('[data-slot="editor-save-status"]')?.textContent).toBe("Saved");
  });

  it("does not erase local drafts when their storage read fails", async () => {
    const removed: string[] = [];
    const failedStorage: Platform = {
      ...platform,
      storage: {
        get: async (key) => {
          if (key.startsWith("test-editor-drafts:")) throw new Error("Unavailable");
          return null;
        },
        set: () => undefined,
        remove: (key) => {
          removed.push(key);
        },
      },
    };
    await render(service().editor, undefined, failedStorage);
    expect(document.querySelector('[data-slot="editor-save-status"]')?.textContent).toContain(
      "Could not restore local drafts",
    );
    expect(removed.some((key) => key.startsWith("test-editor-drafts:"))).toBe(false);
  });

  it("does not hydrate a late local draft over an edit made during loading", async () => {
    let resolveStored!: (value: string | null) => void;
    const stored = new Promise<string | null>((resolve) => {
      resolveStored = resolve;
    });
    const delayedPlatform: Platform = {
      ...platform,
      storage: { get: () => stored, set: () => undefined, remove: () => undefined },
    };
    const harness = service();
    await render(harness.editor, undefined, delayedPlatform);
    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-intent")!,
      "Typed before hydration",
    );
    resolveStored(
      JSON.stringify({ "step-pay": { intent: "Stale draft", note: "", capture: true } }),
    );
    await settle();
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Typed before hydration",
    );
  });

  it("scopes local drafts to the active project connection", async () => {
    const storage = new Map<string, string>();
    const projectA: Platform = {
      ...platform,
      getServerConnection: () => ({
        url: "http://relay.test",
        auth: { type: "none" },
        organizationId: "org",
        projectId: "project-a",
        actorId: "human:test",
        actorKind: "human",
      }),
      storage: {
        get: (key) => storage.get(key) ?? null,
        set: (key, value) => void storage.set(key, value),
        remove: (key) => void storage.delete(key),
      },
    };
    const projectB: Platform = {
      ...projectA,
      getServerConnection: () => ({
        url: "http://relay.test",
        auth: { type: "none" },
        organizationId: "org",
        projectId: "project-b",
        actorId: "human:test",
        actorKind: "human",
      }),
    };
    const first = service();
    await render(first.editor, undefined, projectA);
    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-intent")!,
      "Project A draft",
    );
    await settle();
    expect([...storage.keys()].some((key) => key.includes("project-a"))).toBe(true);
    const firstRoot = roots.pop();
    await act(async () => firstRoot?.unmount());
    document.body.replaceChildren();

    const second = service();
    await render(second.editor, undefined, projectB);
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Confirm the total",
    );
  });

  it("restores a visual-judge draft after reload", async () => {
    const storage = new Map<string, string>();
    const persist: Platform = {
      ...platform,
      getServerConnection: () => ({
        url: "http://relay.test",
        auth: { type: "none" },
        organizationId: "org",
        projectId: "project-a",
        actorId: "human:test",
        actorKind: "human",
      }),
      storage: {
        get: (key) => storage.get(key) ?? null,
        set: (key, value) => void storage.set(key, value),
        remove: (key) => void storage.delete(key),
      },
    };
    const first = service();
    await render(first.editor, undefined, persist);
    await click("Visual judge");
    await fill(
      document.querySelector<HTMLTextAreaElement>("#selected-step-expected-visual")!,
      "Composer is visible",
    );
    await settle();
    expect([...storage.values()].some((value) => value.includes("Composer is visible"))).toBe(true);
    const firstRoot = roots.pop();
    await act(async () => firstRoot?.unmount());
    document.body.replaceChildren();

    await render(service().editor, undefined, persist);
    expect(
      document.querySelector<HTMLTextAreaElement>("#selected-step-expected-visual")?.value,
    ).toBe("Composer is visible");
    expect(document.body.textContent).toContain("Two independent judges must agree");
  });

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
    expect(harness.historyCalls).toEqual(["undo"]);
    expect(document.body.textContent).toContain("Last saved change");
    await click("Redo last undone change");
    expect(harness.historyCalls).toEqual(["undo", "redo"]);
  });

  it("edits a validation expected result through the canonical assertion binding", async () => {
    const source = structuredClone(initialDocument);
    const validation = source.test.steps[1];
    if (!validation || validation.kind !== "validation")
      throw new Error("Expected validation step");
    validation.binding = {
      status: "resolved",
      kind: "assertion",
      assertion: { kind: "content", input: "Order total", expected: "$40.00", match: "exact" },
    };
    const harness = service(source);
    await render(harness.editor);

    expect(document.body.textContent).toContain("Expected result");
    expect(document.querySelector<HTMLInputElement>("#selected-step-expected-value")?.value).toBe(
      "$40.00",
    );
    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-expected-value")!,
      "$42.00",
    );
    await click("Save step");

    expect(harness.edits.at(-1)).toEqual([
      expect.objectContaining({
        kind: "step.patch",
        stepId: "step-pay",
        patch: expect.objectContaining({
          binding: {
            status: "resolved",
            kind: "assertion",
            assertion: {
              kind: "content",
              input: "Order total",
              expected: "$42.00",
              match: "exact",
            },
          },
        }),
      }),
    ]);
  });

  it("offers visual, reply, and ignore-region checks on an unbound checkpoint", async () => {
    await render(service().editor);

    expect(document.body.textContent).toContain("Visual judge");
    expect(document.body.textContent).not.toContain("Semantic judge");
    expect(document.body.textContent).not.toContain("Remember reply");
    expect(document.body.textContent).toContain("Ignore for identity");
    expect(document.body.textContent).toContain("not in YAML");
    await click("Visual judge");
    expect(document.body.textContent).toContain("Fails closed without OPENROUTER_API_KEY");
    expect(document.body.textContent).toContain("Do not auto-accept a visual baseline");
    expect(document.body.textContent).toContain("Do not parse LaTeX or H1–H6 size");
    expect(document.body.textContent).toContain("Two independent judges must agree");
    await click("Ignore for identity");
    expect(document.body.textContent).toContain("Identity and visual compare skip");
    expect(document.body.textContent).toContain("User bubble");
    expect(document.body.textContent).toContain("Reply body");
    expect(document.body.textContent).toContain("Cookie banner");
    expect(document.body.textContent).toContain("Composer placeholder");
    expect(document.body.textContent).toContain("Heading caret");
    expect(document.body.textContent).toContain("Library chrome sandwich");
    expect(document.body.textContent).toContain("Do not survey the infinite feed");
    expect(document.body.textContent).toContain("Enjoying Grok?");
    await click("Library chrome sandwich");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0.06,0.14,0.88,0.60");
    await click("Cookie banner");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0.57,0.80,0.43,0.20");
    await click("Composer placeholder");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0.21,0.29,0.57,0.06");
    await click("Heading caret");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0.53,0.25,0.08,0.01");
    await click("User bubble");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0.70,0.08,0.28,0.10");
  });

  it("offers Remember reply when the Test already extracts a reply", async () => {
    const source = structuredClone(initialDocument);
    source.hasRememberableReply = true;
    await render(service(source).editor);
    expect(document.body.textContent).toContain("Remember reply");
    expect(document.body.textContent).toContain("Semantic judge");
  });

  it("adds a checkpoint so a visual judge can be authored without YAML", async () => {
    const harness = service();
    await render(harness.editor, "/tests/test-checkout/edit?step=step-cart");

    expect(document.body.textContent).toContain(
      "Visual judges, reply checks, and ignore regions live on a Checkpoint",
    );
    expect(document.body.textContent).toContain("Uses one saved path.");
    expect(document.body.textContent).not.toContain('"kind":"connections"');
    await click("Add checkpoint");
    expect(harness.edits).toEqual([]);
    expect(document.body.textContent).toContain("Not saved on this Test");
    expect(document.body.textContent).toContain("does not accept a visual baseline");
    expect(document.body.textContent).toContain("Visual judge");
    await click("Visual judge");
    expect(document.body.textContent).toContain("Two independent judges must agree");
    await click("Remove step");
    await click("Remove step");
    expect(harness.edits).toEqual([]);
    expect(document.body.textContent).not.toContain("Not saved on this Test");
  });

  it("authors an upload checkpoint without YAML", async () => {
    const harness = service();
    await render(harness.editor, "/tests/test-checkout/edit?step=step-cart");
    await click("Add checkpoint");
    await click("Upload a file");
    expect(document.body.textContent).toContain("not a Grok Files pass");
    expect(document.body.textContent).toContain("do not accept a visual baseline");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-upload-file")?.value,
    ).toBe("tests/fixtures/sample.pdf");
    await click("Save step");
    expect(harness.edits.at(-1)).toEqual([
      expect.objectContaining({
        kind: "step.add",
        step: expect.objectContaining({
          kind: "validation",
          binding: {
            status: "resolved",
            kind: "recipe-step",
            step: { kind: "upload", file: "tests/fixtures/sample.pdf" },
          },
        }),
      }),
    ]);
  });

  it("authors a visual judge with independent consensus without YAML", async () => {
    const source = structuredClone(initialDocument);
    const validation = source.test.steps.find((step) => step.id === "step-pay");
    if (!validation || validation.kind !== "validation")
      throw new Error("Expected validation step");
    validation.binding = {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "visual",
        criteria: ["Composer is visible"],
        requireAgreement: true,
      },
    };
    const harness = service(source);
    await render(harness.editor);

    expect(document.body.textContent).toContain("Fails closed without OPENROUTER_API_KEY");
    expect(document.body.textContent).toContain("Do not auto-accept a visual baseline");
    expect(document.body.textContent).toContain("Two independent judges must agree");
    await fill(
      document.querySelector<HTMLTextAreaElement>("#selected-step-expected-visual")!,
      "Composer is empty",
    );
    await click("Save step");

    expect(harness.edits.at(-1)).toEqual([
      expect.objectContaining({
        kind: "step.patch",
        stepId: "step-pay",
        patch: expect.objectContaining({
          binding: {
            status: "resolved",
            kind: "assertion",
            assertion: {
              kind: "visual",
              criteria: ["Composer is empty"],
              requireAgreement: true,
            },
          },
        }),
      }),
    ]);
  });

  it("reviews a production-backed repair proposal", async () => {
    const harness = service();
    await render(harness.editor);

    expect(document.body.textContent).toContain("Use the updated total label");
    await click("Apply repair");
    expect(harness.decisions).toEqual(["approve"]);
    expect(document.body.textContent).not.toContain("Suggested repairs");
    expect(document.body.textContent).toContain("Edited Complete checkout");
  });

  it("adds and removes steps through stable canonical edits", async () => {
    const harness = service();
    await render(harness.editor);

    await click("Add step");
    const added = harness.edits.at(-1)?.[0];
    expect(added?.kind).toBe("step.add");
    if (added?.kind !== "step.add") throw new Error("Expected step.add");
    expect(added.step.kind).toBe("instruction");
    expect(added.step.binding).toEqual({
      status: "unresolved",
      reason: "Choose a saved action for this step before running the Test.",
    });
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Describe the next action",
    );

    await click("Remove step");
    expect(document.body.textContent).toContain("Remove this step?");
    await click("Remove step");
    expect(harness.edits.at(-1)).toEqual([{ kind: "step.remove", stepId: added.step.id }]);

    await click("Undo last saved change");
    expect(harness.historyCalls.at(-1)).toBe("undo");
  });

  it("repairs a compatible saved action through step.bind", async () => {
    const source = structuredClone(initialDocument);
    const action = source.test.steps[0];
    if (!action || action.kind !== "instruction") throw new Error("Expected action step");
    action.binding = {
      status: "unresolved",
      reason: "The saved action needs a new target.",
      candidates: [{ kind: "connection", id: "cart", label: "Open the cart" }],
    };
    const harness = service(source);
    await render(harness.editor, "/tests/test-checkout/edit?step=step-cart");

    expect(document.body.textContent).toContain("Use Open the cart");
    await click("Use Open the cart");
    expect(harness.edits.at(-1)).toEqual([
      {
        kind: "step.bind",
        stepId: "step-cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["cart"] },
      },
    ]);
    expect(document.body.textContent).toContain("Ready");
  });

  it("keeps an inspector draft while moving between steps", async () => {
    const harness = service();
    await render(harness.editor);
    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-intent")!,
      "Drafted final total",
    );
    const stepButtons = [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
    const cart = stepButtons.find((button) => button.textContent?.includes("Open the cart"));
    const pay = stepButtons.find((button) => button.textContent?.includes("Confirm the total"));
    if (!cart || !pay) throw new Error("Expected both step selectors");
    await act(async () => cart.click());
    await settle();
    await act(async () => pay.click());
    await settle();
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Drafted final total",
    );
    expect(harness.edits).toHaveLength(0);
  });
});
