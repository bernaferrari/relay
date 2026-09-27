/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestEditorBrowserPane, type PreparedBrowserRecording } from "./test-editor-browser-pane";

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

function account(id: string, targetId: string, name: string, extra: object = {}) {
  return {
    target: { id: targetId, name: targetId },
    fixture: {
      id,
      reference: `authfx:${id}:1`,
      revision: 1,
      targetId,
      name,
      origins: ["https://grok.com"],
      cookieCount: 1,
      createdAt: 1,
      ...extra,
    },
  };
}

async function setup(
  startUrl?: string,
  options: {
    recentAccountIds?: string[];
    remembered?: string;
    onPreparedBrowserChange?: (browser: PreparedBrowserRecording | undefined) => void;
  } = {},
) {
  const unmount = vi.fn();
  let requestedFixture: string | undefined;
  const live = {
    snapshot: () => ({
      status: "streaming",
      target: { kind: "browser", platform: "browser", targetId: "grok" },
      browserContext: {
        sessionId: "live-session",
        engine: "chromium",
        viewport: { width: 900, height: 600 },
        locale: "en-US",
        ...(requestedFixture ? { authenticationFixtureId: requestedFixture } : {}),
      },
    }),
    mount: vi.fn(() => unmount),
    subscribe: vi.fn(() => vi.fn()),
    close: vi.fn(),
    input: vi.fn(async () => {}),
  };
  const previewTarget = vi.fn(
    async (_target: unknown, identity?: { authenticationFixtureId?: string }) => {
      requestedFixture = identity?.authenticationFixtureId;
      return live;
    },
  );
  const openSpace = vi.fn();
  context.current = {
    browserSpacesService: {
      listSpaces: async () => [{ id: "grok", name: "Grok", startUrl: "https://grok.com" }],
      openSpace,
    },
    appResourcesService: {
      listBrowserAccounts: async () => [
        account("lab", "grok", "SuperGrok lab"),
        account("mail", "grok", "Email tester", {
          health: { status: "needs-relogin", checkedAt: 1 },
        }),
        account("gone", "grok", "Old account", { revokedAt: 1 }),
        account("other", "another", "Different app"),
      ],
    },
    productService: { previewTarget },
    platform: {
      storage: {
        get: (key: string) =>
          key === "relay:website-account:grok.com" ? (options.remembered ?? null) : null,
      },
    },
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
        <TestEditorBrowserPane
          appMapId="grok-map"
          startUrl={startUrl}
          {...(options.recentAccountIds ? { recentAccountIds: options.recentAccountIds } : {})}
          onPreparedBrowserChange={options.onPreparedBrowserChange}
        />
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
    expect(document.body.textContent).not.toContain("Different app");
    await choose("Account", "authfx:lab:1");
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
  it("reports the exact prepared browser and clears it when disconnected", async () => {
    const changed = vi.fn<(browser: PreparedBrowserRecording | undefined) => void>();
    await setup("https://grok.com/", { onPreparedBrowserChange: changed });
    await choose("Account", "authfx:lab:1");
    await click("Open browser");
    expect(changed).toHaveBeenLastCalledWith({
      targetId: "grok",
      sessionId: "live-session",
      authenticationFixtureId: "authfx:lab:1",
    });
    await click("Change");
    expect(changed).toHaveBeenLastCalledWith(undefined);
  });
  it("names accounts people recognise and never shows internal ids", async () => {
    await setup("https://grok.com/");
    const options = [
      ...document.querySelectorAll<HTMLOptionElement>('select[aria-label="Account"] option'),
    ].map((option) => option.textContent);
    expect(options).toEqual([
      "Guest · not signed in",
      "SuperGrok lab",
      "Email tester · needs sign-in",
    ]);
    expect(document.body.textContent).not.toContain("authfx:");
  });
  it("defaults to the account the Test last ran as", async () => {
    const harness = await setup("https://grok.com/", { recentAccountIds: ["mail", "lab"] });
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Account"]')?.value).toBe(
      "authfx:mail:1",
    );
    expect(document.body.textContent).toContain("Email tester · recorded with");
    await click("Open browser");
    expect(harness.previewTarget).toHaveBeenCalledWith(
      { kind: "browser", platform: "browser", targetId: "grok" },
      { authenticationFixtureId: "authfx:mail:1" },
    );
  });
  it("falls back to the account last chosen when recording on this website", async () => {
    await setup("https://grok.com/", { remembered: "authfx:lab:1" });
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Account"]')?.value).toBe(
      "authfx:lab:1",
    );
  });
});
