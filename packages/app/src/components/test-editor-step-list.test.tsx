/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AppMapScenarioTest } from "@relay/protocol";
import { TestEditorStepOutline } from "./test-editor-step-list";

it("displays a captured control name while selecting the unchanged authored step", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const step = {
    id: "send",
    kind: "instruction" as const,
    intent: "Tap “input_send_button”",
    binding: { status: "resolved" as const, kind: "connections" as const, connectionIds: ["send"] },
  };
  const test = { name: "Expert", steps: [step] } as AppMapScenarioTest;
  const onSelect = vi.fn();
  const props = {
    test,
    entries: [{ step, depth: 0, number: "1", siblingIds: ["send"], index: 0 }],
    busy: false,
    draggedStepId: { current: undefined },
    onAdd: vi.fn(),
    onAddCheckpoint: vi.fn(),
    onSelect,
    onMove: vi.fn(),
    onDrop: vi.fn(),
  };
  try {
    await act(async () =>
      root.render(
        <TestEditorStepOutline {...props} displayTitles={{ send: "Tap “Send message”" }} />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>("#test-step-send button")!;
    expect(button.textContent).toContain("Send message");
    expect(button.textContent).not.toContain("input_send_button");
    await act(async () => button.click());
    expect(onSelect).toHaveBeenCalledWith("send");
    expect(step.intent).toBe("Tap “input_send_button”");
    step.intent = "Submit the expert request";
    await act(async () => root.render(<TestEditorStepOutline {...props} displayTitles={{}} />));
    expect(button.textContent).toContain("Submit the expert request");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
