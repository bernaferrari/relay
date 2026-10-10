import { ApiError } from "@relay/client";
/** @jsxImportSource react */
import type { AppMapScenarioTestEdit, AppMapScenarioTestStep } from "@relay/protocol";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import type { RecordingProductService } from "../data/recording-product-service";
import type { RunProductService } from "../data/run-product-service";
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
  // Shell services (activity, counts) must never reach a real server.
  fetch: async () => {
    throw new TypeError("Network is not available in editor tests.");
  },
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

/** The Test page around the editor reads the Test, devices, and runs. */
function runService(editor: TestEditorProductService): RunProductService {
  const unavailable = async () => {
    throw new Error("Runs are not part of editor tests.");
  };
  return {
    async getTest(testId) {
      const document = await editor.get(testId);
      if (!document) return undefined;
      return {
        id: document.test.id,
        name: document.test.name,
        appMapId: document.appMapId,
        appName: document.appName,
        stepCount: document.test.steps.length,
      };
    },
    listTestRuns: async () => [],
    listTargets: async () => [],
    presentTargets: async () => [],
    start: unavailable,
    inspect: unavailable,
    watch: unavailable,
    cancel: unavailable,
    getReport: unavailable,
    getRawEvidence: unavailable,
  };
}

async function render(
  editor: TestEditorProductService,
  path = "/tests/test-checkout?step=step-pay",
  renderPlatform: Platform = platform,
  runViewService: RunProductService = runService(editor),
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
      <RelayApp
        platform={renderPlatform}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        testEditorService={editor}
        runService={runViewService}
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
  if (label === "Write a step" || label === "Add a check") await click("Add step");

  const target = [...document.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]')].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label ||
      (label === "Run settings" &&
        candidate.getAttribute("aria-label")?.startsWith("Run settings:")),
  );
  if (!target) throw new Error(`Control not found: ${label}`);
  await act(async () => target.click());
  await settle();
}

async function chooseCheckpoint(label: string) {
  const select = document.querySelector<HTMLSelectElement>('[aria-label="Check type"]')!;
  const option = [...select.options].find((item) => item.textContent === label)!;
  await act(async () => {
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
    await click("Save");
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Keep this changed expectation",
    );
    expect(document.querySelector('[data-state="conflicted"]')?.textContent).toContain(
      "your changes are preserved",
    );
    harness.editor.edit = save;
    await click("Save");
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
    await chooseCheckpoint("Visual judge");
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
    expect(document.body.textContent).toContain("Ask two models and require them to agree");
  });

  it("opens a route-selected step and saves a stable-ID patch", async () => {
    const harness = service();
    const history = await render(harness.editor);

    expect(history.location.search).toContain("step=step-pay");
    expect(document.querySelector<HTMLInputElement>("#selected-step-intent")?.value).toBe(
      "Confirm the total",
    );
    expect(document.querySelector('[aria-label="Selected step editor"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Edited Complete checkout");

    await fill(
      document.querySelector<HTMLInputElement>("#selected-step-intent")!,
      "Confirm the final total",
    );
    await click("Save");

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

  it("opens a step for in-place editing on the test page", async () => {
    const history = await render(service().editor, "/tests/test-checkout?step=step-pay");
    expect(history.location.pathname).toBe("/tests/test-checkout");
    expect(history.location.search).toContain("step=step-pay");
    await vi.waitFor(async () => {
      await act(async () => undefined);
      expect(document.querySelector<HTMLTextAreaElement>("#selected-step-intent")?.value).toBe(
        "Confirm the total",
      );
    });
  });

  it("reorders through keyboard-equivalent controls and undoes canonically", async () => {
    const harness = service();
    await render(harness.editor);

    const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Confirm the total"),
    )!;
    await act(async () =>
      row.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
      ),
    );
    expect(harness.edits.at(-1)).toEqual([
      { kind: "step.reorder", orderedStepIds: ["step-pay", "step-cart"] },
    ]);

    await click("Undo last saved change");
    expect(harness.historyCalls).toEqual(["undo"]);
    expect(document.querySelector('[aria-label="Editing history"]')).not.toBeNull();
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
    await click("Save");

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
    expect(document.querySelector('[aria-label="Check type"]')).not.toBeNull();
    await chooseCheckpoint("Visual judge");
    expect(document.body.textContent).toContain("Uses your model key from Settings");
    expect(document.body.textContent).toContain("Ask two models and require them to agree");
    await chooseCheckpoint("Ignore for identity");
    expect(document.body.textContent).toContain("Screenshots and screen matching skip this area");
    expect(document.body.textContent).toContain("Header");
    expect(document.body.textContent).toContain("Main content");
    expect(document.body.textContent).toContain("Cookie banner");
    await click("Cookie banner");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0,0.8,1,0.2");
    await click("Header");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-identity-region")?.value,
    ).toBe("0,0,1,0.1");
  });

  it("offers Remember reply when the test already extracts a reply", async () => {
    const source = structuredClone(initialDocument);
    source.hasRememberableReply = true;
    await render(service(source).editor);
    expect(document.body.textContent).toContain("Remember reply");
    expect(document.body.textContent).toContain("Semantic judge");
  });

  it("adds a checkpoint so a visual judge can be authored without YAML", async () => {
    const harness = service();
    await render(harness.editor, "/tests/test-checkout?step=step-cart");

    expect(document.body.textContent).not.toContain(
      "Visual judges, reply checks, and ignore regions live on a Checkpoint",
    );
    expect(document.body.textContent).not.toContain('"kind":"connections"');
    await click("Add a check");
    expect(harness.edits).toEqual([]);
    expect(document.body.textContent).toContain("Not saved on this test");
    expect(document.body.textContent).toContain("does not accept a visual baseline");
    expect(document.body.textContent).toContain("Visual judge");
    await chooseCheckpoint("Visual judge");
    expect(document.body.textContent).toContain("Ask two models and require them to agree");
    await click("Remove step");
    await click("Remove step");
    expect(harness.edits).toEqual([]);
    expect(document.body.textContent).not.toContain("Not saved on this test");
  });

  it("saves a condition wait and leaves no unsaved draft behind", async () => {
    const harness = service();
    const history = await render(harness.editor, "/tests/test-checkout?step=step-cart");
    await click("Add a check");
    await act(async () => {
      const select = document.querySelector<HTMLSelectElement>('[aria-label="Check type"]')!;
      select.value = "wait-for";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await fill(document.querySelector<HTMLInputElement>("#wait-control")!, "Download");
    await click("120s");
    await click("Save");
    expect(harness.edits.at(-1)).toEqual([
      expect.objectContaining({
        kind: "step.add",
        step: expect.objectContaining({
          binding: {
            status: "resolved",
            kind: "recipe-step",
            step: {
              kind: "expect",
              target: { label: "Download" },
              condition: "visible",
              timeoutMs: 120000,
            },
          },
        }),
      }),
    ]);
    // Editing happens in place on the Test page: the saved check leaves no draft.
    expect(document.querySelector('[data-slot="editor-save-status"]')?.textContent).toBe("Saved");
    expect(document.body.textContent).not.toContain("Unsaved draft");
    expect(history.location.pathname).toBe("/tests/test-checkout");
  });

  it("keeps run blocked while a visible checkpoint save awaits acknowledgement", async () => {
    const harness = service();
    const saveEdit = harness.editor.edit.bind(harness.editor);
    let acknowledgeSave: (() => void) | undefined;
    const pendingSave = new Promise<void>((resolve) => {
      acknowledgeSave = resolve;
    });
    harness.editor.edit = async (input) => {
      await pendingSave;
      return saveEdit(input);
    };
    const availableRun = runService(harness.editor);
    availableRun.listTargets = async () => [
      {
        kind: "browser",
        platform: "browser",
        targetId: "checkout-browser",
        name: "Checkout browser",
        detail: "Managed browser · Ready",
      },
    ];
    await render(harness.editor, "/tests/test-checkout?step=step-cart", platform, availableRun);
    await click("Add a check");
    await chooseCheckpoint("Wait for a control");
    await fill(document.querySelector<HTMLInputElement>("#wait-control")!, "Download");
    await click("Save");
    await click("Run settings");
    const runNow = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Run now",
    );
    expect(runNow?.disabled).toBe(true);
    expect(harness.edits).toHaveLength(0);

    await act(async () => acknowledgeSave?.());
    await settle();
    expect(harness.edits).toHaveLength(1);
    expect(runNow?.disabled).toBe(false);
  });

  it("authors an upload checkpoint without YAML", async () => {
    const harness = service();
    await render(harness.editor, "/tests/test-checkout?step=step-cart");
    await click("Add a check");
    await chooseCheckpoint("Upload a file");
    expect(document.body.textContent).toContain("record picking the file once");
    expect(
      document.querySelector<HTMLInputElement>("#selected-step-expected-upload-file")?.value,
    ).toBe("tests/fixtures/sample.pdf");
    await click("Save");
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

    expect(document.body.textContent).toContain("Uses your model key from Settings");
    expect(document.body.textContent).toContain("Ask two models and require them to agree");
    await fill(
      document.querySelector<HTMLTextAreaElement>("#selected-step-expected-visual")!,
      "Composer is empty",
    );
    await click("Save");

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

    await click("Write a step");
    const added = harness.edits.at(-1)?.[0];
    expect(added?.kind).toBe("step.add");
    if (added?.kind !== "step.add") throw new Error("Expected step.add");
    expect(added.step.kind).toBe("instruction");
    expect(added.step.binding).toEqual({
      status: "unresolved",
      reason: "Runs from its description. Record it to make it faster and exact.",
      fromText: true,
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
    };
    source.savedPaths = [{ kind: "connection", id: "cart", label: "Open the cart" }];
    const harness = service(source);
    await render(harness.editor, "/tests/test-checkout?step=step-cart");

    expect(document.body.textContent).toContain("Use Open the cart");
    await click("Use Open the cart");
    expect(harness.edits.at(-1)).toEqual([
      {
        kind: "step.bind",
        stepId: "step-cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["cart"] },
      },
    ]);
    // A connected action no longer offers repair controls.
    expect(document.body.textContent).not.toContain("Use Open the cart");
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

it("keeps an unsaved checkpoint when leaving for runs until leaving is confirmed", async () => {
  const harness = service();
  const history = await render(harness.editor);
  await click("Add a check");
  const results = [
    ...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a'),
  ].find((link) => link.textContent?.trim() === "Runs");
  if (!results) throw new Error("Runs destination missing");
  expect(results.getAttribute("href")).toBe("/runs?app=app-private-id");
  await act(async () => results.click());
  await settle();
  expect(history.location.pathname).toBe("/tests/test-checkout");
  expect(document.body.textContent).toContain("new screenshot checkpoint will be discarded");
  await click("Keep editing");
  expect(history.location.pathname).toBe("/tests/test-checkout");
  expect(harness.edits).toHaveLength(0);
  await act(async () => results.click());
  await settle();
  await click("Leave without saving");
  expect(history.location.pathname).toBe("/runs");
  expect(history.location.search).toBe("?app=app-private-id");
  expect(harness.edits).toHaveLength(0);
});

it("edits shared recorded text, gates pending saves, and runs the saved parameter with one supplied value", async () => {
  const source = structuredClone(initialDocument);
  const action = {
    key: "text-address",
    connectionId: "prompt",
    actionId: "take-action",
    recipeStepId: "type-value",
    text: "Original prompt",
    sharedTestNames: ["Other chat"],
  };
  source.textActions = { "step-cart": [action] };
  const harness = service(source);
  let current = source;
  harness.editor.get = async () => structuredClone(current);
  harness.editor.listTextParameters = async () => [
    {
      id: "prompt-data",
      name: "chat_prompt",
      scope: "shared",
      source: "list",
      values: ["Saved prompt A", "Saved prompt B"],
    },
  ];
  let finishSave!: () => void;
  const saving = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  harness.editor.saveText = vi.fn(async ({ text }) => {
    await saving;
    current = { ...current, revision: 8, textActions: { "step-cart": [{ ...action, text }] } };
    return structuredClone(current);
  });
  const availableRun = runService(harness.editor);
  availableRun.listTargets = async () => [
    {
      kind: "browser",
      platform: "browser",
      targetId: "checkout-browser",
      name: "Browser",
      detail: "Ready",
    },
  ];
  availableRun.start = vi.fn(async () => ({ status: "idle" as const }));
  await render(harness.editor, "/tests/test-checkout?step=step-cart", platform, availableRun);
  expect(
    document.querySelector<HTMLTextAreaElement>('form[aria-label="Recorded text"] textarea')!.value,
  ).toBe("Original prompt");
  expect(document.body.textContent).toContain("Also updates 1 other test.");
  const selectedEditor = document.querySelector('[aria-label="Selected step editor"]')!;
  const details = selectedEditor.querySelector("details")!;
  expect(selectedEditor.firstElementChild?.getAttribute("aria-label")).toBe("Recorded text");
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toContain("Step details");
  const sourceSelect = document.querySelector<HTMLSelectElement>(
    'form[aria-label="Recorded text"] select',
  )!;
  expect([...sourceSelect.options].map((option) => option.textContent)).toEqual([
    "Fixed text",
    "Run input",
  ]);
  await act(async () => {
    sourceSelect.value = "parameter";
    sourceSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(
    document.querySelector<HTMLInputElement>('form[aria-label="Recorded text"] input')!.value,
  ).toBe("chat_prompt");
  expect(document.querySelector('form[aria-label="Recorded text"] label')?.textContent).toContain(
    "Text source",
  );
  expect(details.open).toBe(false);
  await click("Save input");
  await click("Run settings");
  const runButton = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Run now",
    )!;
  expect(runButton().disabled).toBe(true);
  expect(availableRun.start).not.toHaveBeenCalled();
  await act(async () => finishSave());
  await settle();
  expect(harness.editor.saveText).toHaveBeenCalledWith(
    expect.objectContaining({ stepId: "step-cart", action, text: "{{chat_prompt}}" }),
  );
  const savedValue = document.querySelector<HTMLSelectElement>('[aria-label="Run inputs"] select')!;
  expect(savedValue.value).toBe("Saved prompt A");
  await act(async () => {
    savedValue.value = "Saved prompt B";
    savedValue.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(runButton().disabled).toBe(false);
  await click("Run now");
  expect(availableRun.start).toHaveBeenCalledWith(
    expect.objectContaining({
      documentRevision: 8,
      targetId: "checkout-browser",
      variables: { chat_prompt: "Saved prompt B" },
    }),
  );
});

it("preserves recorded text drafts after a rejected save and never retries the mutation", async () => {
  const source = structuredClone(initialDocument);
  source.textActions = {
    "step-cart": [
      {
        key: "text",
        connectionId: "prompt",
        actionId: "type",
        text: "Original",
        sharedTestNames: [],
      },
    ],
  };
  const harness = service(source);
  harness.editor.saveText = vi.fn(async () => {
    throw new TypeError("The saved test changed. Reload before saving this text.");
  });
  await render(harness.editor, "/tests/test-checkout?step=step-cart");
  await fill(
    document.querySelector<HTMLTextAreaElement>('form[aria-label="Recorded text"] textarea')!,
    "A draft prompt",
  );
  await click("Save text");
  expect(
    document.querySelector<HTMLTextAreaElement>('form[aria-label="Recorded text"] textarea')!.value,
  ).toBe("A draft prompt");
  expect(
    document.querySelector('[data-slot="editor-save-status"]')?.getAttribute("data-state"),
  ).toBe("failed");
  expect(harness.editor.saveText).toHaveBeenCalledTimes(1);
  expect(harness.edits).toEqual([]);
});

it("keeps unsaved step details discoverable after saving recorded text", async () => {
  const source = structuredClone(initialDocument);
  const action = {
    key: "text",
    connectionId: "prompt",
    actionId: "type",
    text: "Original",
    sharedTestNames: [],
  };
  source.textActions = { "step-cart": [action] };
  const harness = service(source);
  let current = source;
  harness.editor.get = async () => structuredClone(current);
  harness.editor.saveText = vi.fn(async ({ text }) => {
    current = { ...current, revision: 8, textActions: { "step-cart": [{ ...action, text }] } };
    return structuredClone(current);
  });
  const availableRun = runService(harness.editor);
  availableRun.listTargets = async () => [
    {
      kind: "browser",
      platform: "browser",
      targetId: "checkout-browser",
      name: "Browser",
      detail: "Ready",
    },
  ];
  availableRun.start = vi.fn(async () => ({ status: "idle" as const }));
  await render(harness.editor, "/tests/test-checkout?step=step-cart", platform, availableRun);
  const details = document.querySelector<HTMLDetailsElement>(
    '[aria-label="Selected step editor"] details',
  )!;
  expect(details.open).toBe(false);
  await act(async () => details.querySelector("summary")!.click());
  await fill(
    document.querySelector<HTMLTextAreaElement>("#selected-step-intent")!,
    "A clearer step",
  );
  await fill(
    document.querySelector<HTMLTextAreaElement>('form[aria-label="Recorded text"] textarea')!,
    "A new prompt",
  );
  await click("Save text");
  expect(details.open).toBe(true);
  expect(details.querySelector("summary")?.textContent).toContain("Unsaved changes");
  expect(document.querySelector<HTMLTextAreaElement>("#selected-step-intent")!.value).toBe(
    "A clearer step",
  );
  expect(harness.edits).toEqual([]);
  expect(harness.editor.saveText).toHaveBeenCalledTimes(1);
  await click("Run settings");
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Run now",
    )!.disabled,
  ).toBe(true);
  expect(availableRun.start).not.toHaveBeenCalled();
});
