/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TestEditorHistoryBar } from "./test-editor-page-sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe("test editing history", () => {
  it("says undo changes the Test and does not reverse an external effect", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <TestEditorHistoryBar
          canUndo
          canRedo={false}
          busy={false}
          onUndo={() => undefined}
          onRedo={() => undefined}
        />,
      );
    });
    expect(host.querySelector('[aria-label="Undo last saved change"]')?.getAttribute("title")).toBe(
      "Undo changes the Test. It does not reverse a payment, message, or deletion.",
    );
    expect(host.querySelector('[aria-label="Undo last saved change"]')).not.toBeNull();
  });
});
