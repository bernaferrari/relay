/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EditorSaveStatus } from "./editor-save-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe("editor save status", () => {
  it("says a conflict preserved the author's changes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<EditorSaveStatus state="conflicted" />);
    });
    expect(host.textContent).toContain("Conflict — your changes are preserved");
    expect(host.querySelector("[data-state='conflicted']")).not.toBeNull();
  });

  it("says a name kept on this computer is saved locally", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<EditorSaveStatus state="saved-locally" />);
    });
    expect(host.textContent).toContain("Saved locally");
    expect(host.querySelector("[data-state='saved-locally']")).not.toBeNull();
  });

  it("says Saving while a write is in progress", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<EditorSaveStatus state="saving" />);
    });
    expect(host.textContent).toContain("Saving");
    expect(host.querySelector("[data-state='saving']")).not.toBeNull();
  });
});
