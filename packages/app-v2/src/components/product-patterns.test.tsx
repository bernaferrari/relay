/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { OutcomeMark, ReadinessMark } from "./product-patterns";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(node);
  });
  return host;
}

describe("status marks", () => {
  it("never presents an unknown or missing outcome as in-progress work", async () => {
    const host = await render(
      <>
        <OutcomeMark outcome={undefined} />
        <OutcomeMark outcome={"mystery" as never} />
        <OutcomeMark outcome="unknown" />
        <OutcomeMark outcome="running" />
      </>,
    );
    const labels = [...host.querySelectorAll(".relay-outcome-mark")].map((item) =>
      item.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(labels).toEqual(["Unknown result", "Unknown result", "Unknown result", "Running"]);
  });

  it("keeps authoring readiness visually distinct from a passed execution", async () => {
    const host = await render(
      <>
        <ReadinessMark status="ready" />
        <ReadinessMark status="needs-review" />
        <OutcomeMark outcome="passed" />
        <OutcomeMark outcome="uncertain" />
      </>,
    );
    const [ready, unbound, passed, needsReview] = [...host.querySelectorAll("[data-slot='badge']")];
    expect(ready?.textContent).toContain("Ready");
    expect(unbound?.textContent).toContain("Unbound");
    expect(passed?.textContent).toContain("Passed");
    expect(needsReview?.textContent).toContain("Needs review");
    expect(ready?.className).not.toBe(passed?.className);
    expect(ready?.querySelector("svg")?.getAttribute("class")).not.toBe(
      passed?.querySelector("svg")?.getAttribute("class"),
    );
  });

  it("names an unrecorded claimed control Unrecorded, not Unbound", async () => {
    const host = await render(
      <ReadinessMark
        status="needs-review"
        name="Header More on existing chat (Start Thread still absent)"
      />,
    );
    expect(host.textContent).toContain("Unrecorded");
    expect(host.textContent).not.toContain("Unbound");
  });

  it("does not show Ready when the Test name is Imagine Speed even if status is ready", async () => {
    const host = await render(
      <ReadinessMark status="ready" name="Imagine Speed image generation signed-in" />,
    );
    expect(host.textContent).toContain("Unrecorded");
    expect(host.textContent).not.toContain("Ready");
  });
});
