/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./page-layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("PageHeader", () => {
  it("uses one type scale and spacing for context, title, and description", async () => {
    const host = await render(
      <PageHeader
        context="Tests"
        title="Record a Test"
        description="Choose an app and a device, then start."
      />,
    );

    const header = host.querySelector(".relay-workspace-header");
    expect(header).not.toBeNull();
    expect(header?.className).toContain("mb-6");
    expect(header?.className).not.toContain("mt-3");

    const context = host.querySelector(".relay-workspace-context");
    expect(context?.textContent).toBe("Tests");
    expect(context?.className).toContain("text-[11px]");

    const title = host.querySelector("h1");
    expect(title?.textContent).toBe("Record a Test");
    expect(title?.className).toContain("text-[28px]");
    expect(title?.className).toContain("mt-1");

    const description = host.querySelector(".relay-page-description");
    expect(description?.textContent).toBe("Choose an app and a device, then start.");
    expect(description?.className).toContain("text-[13px]");
    expect(description?.className).toContain("mt-1.5");
  });
});
