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
    expect(host.querySelector(".relay-workspace-title-row")?.className).toContain("mt-1");

    const description = host.querySelector(".relay-page-description");
    expect(description?.textContent).toBe("Choose an app and a device, then start.");
    expect(description?.className).toContain("text-[13px]");
    expect(description?.className).toContain("mt-1.5");
  });

  it("keeps the same title offset when the context slot holds breadcrumbs or a section name", async () => {
    const withName = await render(
      <PageHeader
        context="Tests"
        title="Saved Tests"
        description="Run a saved journey, or record a new one."
      />,
    );
    const withCrumbs = await render(
      <PageHeader
        context={
          <nav className="relay-breadcrumbs text-[11px] leading-4" aria-label="Breadcrumb">
            Tests / Record
          </nav>
        }
        title="Record a Test"
        description="Choose an app and a device, then start."
      />,
    );

    expect(withName.querySelector(".relay-workspace-context")?.className).toContain("text-[11px]");
    expect(withCrumbs.querySelector(".relay-workspace-context")?.className).toContain(
      "text-[11px]",
    );
    expect(withName.querySelector(".relay-workspace-title-row")?.className).toContain("mt-1");
    expect(withCrumbs.querySelector(".relay-workspace-title-row")?.className).toContain("mt-1");
    expect(withName.querySelector(".relay-workspace-header")?.className).toContain("mb-6");
    expect(withCrumbs.querySelector(".relay-workspace-header")?.className).toContain("mb-6");
  });

  it("aligns actions with the title instead of padding them past the eyebrow", async () => {
    const host = await render(
      <PageHeader
        context="Browsers"
        title="Guest checkout"
        actions={<button type="button">Open</button>}
      />,
    );

    expect(host.querySelector(".relay-workspace-actions")?.className).not.toContain("pt-5");
    expect(
      host.querySelector(".relay-workspace-title-row")?.contains(host.querySelector("h1")),
    ).toBe(true);
    expect(
      host
        .querySelector(".relay-workspace-title-row")
        ?.contains(host.querySelector(".relay-workspace-actions")),
    ).toBe(true);
  });
});
