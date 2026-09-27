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
    const evidence = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Need more evidence"),
    )!;
    expect(evidence.textContent).toContain("Need more evidence");
    await act(async () => evidence.click());
    expect(onReview).toHaveBeenCalledExactlyOnceWith("need-more-evidence", undefined);
  });

  it("keeps human acceptance separate from explicit reference promotion", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onReview = vi.fn(async () => true);
    await act(async () => root.render(<CaptureReviewDecisions onReview={onReview} />));

    const accept = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Looks correct"),
    )!;
    await act(async () => accept.click());
    expect(onReview).toHaveBeenLastCalledWith("accept", undefined);

    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="More review options"]')!.click(),
    );
    const promote = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Accept as reference"),
    )!;
    await act(async () => promote.click());
    expect(onReview).toHaveBeenLastCalledWith("accept-as-reference", undefined);
  });

  it("does not save a decision when the screenshot is unavailable", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const onReview = vi.fn();
    await act(async () => root.render(<CaptureReviewDecisions unavailable onReview={onReview} />));
    expect(host.textContent).toContain("Load the screenshot to review it");
    expect(host.textContent).not.toContain("Saving decision");
    for (const button of host.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
    }
    expect(onReview).not.toHaveBeenCalled();
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
