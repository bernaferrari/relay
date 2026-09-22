/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureReviewDecisions } from "./capture-review-decisions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

async function typeNote(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("screenshot issue note", () => {
  it("keeps evidence requests in More and submits the selected action", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onReview = vi.fn(async () => true);
    await act(async () => root.render(<CaptureReviewDecisions onReview={onReview} />));
    expect(host.querySelector('[aria-label="Issue note"]')).toBeNull();
    const more = host.querySelector<HTMLButtonElement>('[aria-label="More review options"]')!;
    await act(async () => more.click());
    const evidence = document.querySelector<HTMLElement>('[role="menuitem"]')!;
    expect(evidence.textContent).toContain("Need more evidence");
    await act(async () => evidence.click());
    expect(onReview).toHaveBeenCalledExactlyOnceWith("need-more-evidence", undefined);
  });

  it("keeps the note when the report is refused and clears it when saved", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onReview = vi.fn(async () => false);
    await act(async () => {
      root.render(<CaptureReviewDecisions onReview={onReview} />);
    });
    expect(host.querySelector('[aria-label="Issue note"]')).toBeNull();
    const disclosure = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Report issue"),
    )!;
    await act(async () => disclosure.click());
    expect(onReview).not.toHaveBeenCalled();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Issue note"]');
    if (!input) throw new Error("issue note missing");
    await typeNote(input, "Save overlaps the description");
    const report = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Save issue"),
    );
    if (!report) throw new Error("report issue missing");
    await act(async () => {
      report.click();
    });
    expect(onReview).toHaveBeenCalledWith("report-issue", "Save overlaps the description");
    expect(input.value).toBe("Save overlaps the description");

    onReview.mockResolvedValueOnce(true);
    await act(async () => {
      report.click();
    });
    expect(host.querySelector('[aria-label="Issue note"]')).toBeNull();
  });
});
