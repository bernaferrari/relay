/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BatchTriageControls } from "./batch-triage-controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe("review note form", () => {
  it("keeps the note when the save is refused", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <BatchTriageControls
          selectedCount={1}
          noteOpen
          onNoteOpenChange={() => undefined}
          onStatus={() => undefined}
          onAssignToMe={() => undefined}
          onAddNote={() => false}
        />,
      );
    });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Review note"]');
    if (!input) throw new Error("review note missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Save overlaps");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")?.requestSubmit();
    });
    expect(input.value).toBe("Save overlaps");
    expect(host.textContent).toContain("Save note");
  });

  it("keeps the note when storage rejects the save", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <BatchTriageControls
          selectedCount={1}
          noteOpen
          onNoteOpenChange={() => undefined}
          onStatus={() => undefined}
          onAssignToMe={() => undefined}
          onAddNote={() => Promise.reject(new Error("storage full"))}
        />,
      );
    });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Review note"]');
    if (!input) throw new Error("review note missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Save overlaps");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")?.requestSubmit();
    });
    expect(input.value).toBe("Save overlaps");
  });

});
