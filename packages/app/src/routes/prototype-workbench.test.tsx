/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PrototypeWorkbenchPage } from "./prototype-workbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function renderPage(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<PrototypeWorkbenchPage />);
  });
  return container;
}

describe("PrototypeWorkbenchPage", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.replaceChildren();
  });

  it("renders the frozen geometry: stage, steps, states, configuration, and diagnostics", () => {
    const container = renderPage();
    const text = container.textContent ?? "";

    // The application stage stays center-stage with an explicit live state.
    expect(text).toContain("Your application");
    expect(text).toContain("Live · Not recording");

    // The resolved configuration is visible before input.
    expect(text).toContain("Staging · Chrome · Member · English");

    // Steps read as the object they manipulate, with bracketed values.
    expect(text).toContain("Fill");
    expect(text).toContain("[Email] from [Member account]");
    expect(text).toContain("Capture");
    expect(text).toContain("[Arabic settings]");

    // Exactly five operating states are listed.
    for (const state of [
      "Live · Not recording",
      "Recording",
      "Automation running",
      "Paused · You have control",
      "Viewing saved evidence",
    ]) {
      expect(container.querySelectorAll("dt").length).toBe(5);
      expect([...container.querySelectorAll("dt")].map((node) => node.textContent)).toContain(
        state,
      );
    }

    // Bottom diagnostics follow the stage selection.
    expect(text).toContain("Logs");
    expect(text).toContain("Network");

    // Persistence and verification states stay separate.
    expect(text).toContain("Saved · Changed since last verified run");
  });
});
