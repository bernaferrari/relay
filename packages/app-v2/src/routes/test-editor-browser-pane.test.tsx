/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestEditorBrowserPane } from "./test-editor-browser-pane";

const context = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => context.current,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("../components/filter-select", () => ({
  SelectField: ({
    label,
    value,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange(value: string): void;
  }) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="">Choose</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => void) | undefined;
afterEach(async () => {
  await act(async () => cleanup?.());
  document.body.replaceChildren();
});

async function setup(startUrl?: string) {
  const unmount = vi.fn();
  const live = {
    snapshot: () => ({
      status: "streaming",
      target: { kind: "browser", platform: "browser", targetId: "grok" },
    }),
    mount: vi.fn(() => unmount),
    subscribe: vi.fn(() => vi.fn()),
    close: vi.fn(),
    input: vi.fn(async () => {}),
  };
  const previewTarget = vi.fn(async () => live);
  const openSpace = vi.fn();
  context.current = {
    browserSpacesService: {
      listSpaces: async () => [{ id: "grok", name: "Grok", startUrl: "https://grok.com" }],
      openSpace,
    },
    appResourcesService: {
      listAccountLanes: async () => [
        { id: "grok-lab", targetId: "grok", kind: "fixture", reference: "authfx:lab:1" },
        { id: "different-app", targetId: "another", kind: "fixture", reference: "authfx:other:1" },
      ],
    },
    productService: { previewTarget },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanup = () => {
    root.unmount();
    client.clear();
  };
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TestEditorBrowserPane appMapId="grok-map" startUrl={startUrl} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { live, previewTarget, openSpace, unmount };
}
async function choose(label: string, value: string) {
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === text,
    )!;
    button.click();
  });
}

describe("saved Test browser", () => {
  it("starts with the test website and keeps other configurations behind Change", async () => {
    await setup("https://grok.com/");
    expect(document.querySelector('[aria-label="Websites"]')).toBeNull();
    expect(document.body.textContent).toContain("Change website");
    expect(document.querySelector('[aria-label="Account"]')).not.toBeNull();
    await click("Change website");
    expect(document.querySelector('[aria-label="Websites"]')).not.toBeNull();
  });
  it("opens the chosen saved account through the live stream without requiring an Electron partition", async () => {
    const harness = await setup();
    expect(harness.previewTarget).not.toHaveBeenCalled();
    await click("Grokhttps://grok.com");
    expect(document.body.textContent).not.toContain("different-app");
    await choose("Account", "grok-lab");
    await click("Open browser");
    expect(harness.previewTarget).toHaveBeenCalledWith(
      { kind: "browser", platform: "browser", targetId: "grok" },
      { authenticationFixtureId: "authfx:lab:1" },
    );
    expect(harness.openSpace).not.toHaveBeenCalled();
    expect(harness.live.mount).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-label="Browser navigation"]')).not.toBeNull();
    await click("Change");
    expect(harness.live.close).toHaveBeenCalledOnce();
    expect(harness.unmount).toHaveBeenCalledOnce();
  });
  it("explicitly requests signed-out state when no saved account is selected", async () => {
    const harness = await setup();
    await click("Grokhttps://grok.com");
    await click("Open browser");
    expect(harness.previewTarget).toHaveBeenCalledWith(
      { kind: "browser", platform: "browser", targetId: "grok" },
      { signedOut: true },
    );
  });
});
