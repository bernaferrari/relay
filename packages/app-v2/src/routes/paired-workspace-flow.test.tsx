/** @jsxImportSource react */
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayV2App } from "../app";
import type {
  BrowserSpacesProductService,
  ProductBrowserAuthFixture,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";
import { PAIRED_CONFIGURATION_STORAGE_KEY } from "../data/paired-configuration";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function space(
  id: string,
  name: string,
  engine: "chromium" | "firefox" | "webkit",
): ProductBrowserSpace {
  return {
    id,
    name,
    startUrl: "https://app.example.test",
    createdAt: 1,
    updatedAt: 2,
    environment: { engine },
    profileRetention: "retain",
    persistent: true,
    source: { kind: "managed-browser-target", id },
  };
}

const spaces = [
  space("chrome-1", "Chrome", "chromium"),
  space("firefox-1", "Firefox", "firefox"),
  space("webkit-1", "WebKit", "webkit"),
];

const adminFixtureId = "00000000-0000-4000-8000-0000000000aa";
const memberFixtureId = "00000000-0000-4000-8000-0000000000bb";

function account(id: string, name: string, targetId: string): ProductBrowserAuthFixture {
  return {
    id,
    reference: `authfx:${id}:1`,
    revision: 1,
    targetId,
    name,
    origins: ["https://app.example.test"],
    cookieCount: 1,
    createdAt: 1,
  };
}

function platformWithStorage(initial: Record<string, string> = {}): Platform {
  const values = new Map(Object.entries(initial));
  return {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    getServerConnection: () => ({
      url: "http://127.0.0.1:8787",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    }),
    storage: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => void values.set(key, value),
      remove: (key) => void values.delete(key),
    },
  };
}

function browserService(
  openSpace: BrowserSpacesProductService["openSpace"] = vi.fn(async (input) => {
    const spaceId = typeof input === "string" ? input : input.spaceId;
    return { targetId: spaceId, name: spaceId, url: "https://app.example.test" };
  }),
): BrowserSpacesProductService {
  return {
    listSpaces: async () => spaces,
    createSpace: async () => spaces[0]!,
    openSpace,
    removeSpace: async () => undefined,
    listAuthenticationFixtures: async (spaceId) =>
      spaceId === "chrome-1"
        ? [account(adminFixtureId, "Admin", "chrome-1")]
        : spaceId === "firefox-1"
          ? [account(memberFixtureId, "Member", "firefox-1")]
          : [],
    saveAuthenticationFixture: async () => {
      throw new Error("unused");
    },
    refreshAuthenticationFixture: async () => {
      throw new Error("unused");
    },
    revokeAuthenticationFixture: async () => {
      throw new Error("unused");
    },
    listCompareSets: async () => [],
    saveCompareSet: async () => {
      throw new Error("unused");
    },
    removeCompareSet: async () => undefined,
  };
}

async function render(platform: Platform, service = browserService()) {
  const history = createMemoryHistory({ initialEntries: ["/environments"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        productService={{ listApps: async () => [] } as unknown as RecordingProductService}
        browserSpacesService={service}
      />,
    );
  });
  await settle();
  return { history, service };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`${label} not found`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(label: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!select) throw new Error(`${label} not found`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  await act(async () => button.click());
  await settle();
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("saved Browser and Account workspace", () => {
  it("persists named pairs across restart and opens those exact pairs in Live", async () => {
    const platform = platformWithStorage();
    const openSpace = vi.fn(async (input: { spaceId?: string } | string) => {
      const spaceId = typeof input === "string" ? input : input.spaceId;
      return { targetId: spaceId ?? "", name: spaceId ?? "", url: "https://app.example.test" };
    });
    await render(platform, browserService(openSpace));

    await fill("Pair name", "Admin desktop");
    await choose("Browser", "chrome-1");
    await choose("Account", adminFixtureId);
    await click("Add pair");
    await fill("Pair name", "Member desktop");
    await choose("Browser", "firefox-1");
    await choose("Account", memberFixtureId);
    await click("Add pair");
    await fill("Pair name", "Signed out");
    await choose("Browser", "webkit-1");
    await choose("Account", "");
    await click("Add pair");

    expect(document.body.textContent).toContain("Admin desktop");
    expect(document.body.textContent).toContain("Member desktop");
    expect(document.body.textContent).toContain("Signed out");
    expect(platform.storage.get(PAIRED_CONFIGURATION_STORAGE_KEY)).toContain(adminFixtureId);

    await act(async () => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
    await render(platform, browserService(openSpace));

    expect(document.body.textContent).toContain("3 paired configurations");
    expect(document.body.textContent).toContain("Admin desktop");
    expect(document.body.textContent).toContain("Chrome · chromium");
    expect(document.body.textContent).toContain("Admin");
    await click("Open in Live");
    expect(openSpace.mock.calls.map((call) => call[0])).toEqual([
      {
        spaceId: "chrome-1",
        account: { kind: "fixture", reference: `authfx:${adminFixtureId}:1` },
      },
      {
        spaceId: "firefox-1",
        account: { kind: "fixture", reference: `authfx:${memberFixtureId}:1` },
      },
      { spaceId: "webkit-1", account: { kind: "signed-out" } },
    ]);
    expect(document.body.textContent).toContain("Opened Admin desktop, Member desktop, Signed out");
  });
});
