/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceProductService, ProductInstalledApp } from "../data/device-product-service";
import { InstalledAppChoice } from "./installed-app-choice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const clients: QueryClient[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
});

async function settle() {
  for (let index = 0; index < 4; index++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

async function renderChoice(service: Partial<DeviceProductService>, initialValue = "") {
  const onChange = vi.fn();
  const onOpened = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  function Choice() {
    const [value, setValue] = useState(initialValue);
    return (
      <InstalledAppChoice
        service={service as DeviceProductService}
        serial="phone"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        onOpened={onOpened}
      />
    );
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Choice />
      </QueryClientProvider>,
    );
  });
  await settle();
  return { onChange, onOpened };
}

function picker() {
  return document.querySelector<HTMLButtonElement>('[aria-label="Starting app"]')!;
}

function option(text: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent === text,
  )!;
}

describe("Installed app choice", () => {
  it("shows the app name while selecting and launching its package identity", async () => {
    const launchApp = vi.fn(async (_serial: string, app: string) => ({
      serial: "phone",
      app,
      platform: "android" as const,
      launchedAt: 1,
    }));
    const { onChange, onOpened } = await renderChoice({
      listInstalledApps: async () => [{ name: "Notes", package: "com.example.notes" }],
      launchApp,
    });

    await click(picker());
    expect(option("Notes")).toBeDefined();
    expect(document.body.textContent).not.toContain("com.example.notes");
    await click(option("Notes"));
    expect(picker().textContent).toBe("Notes");
    expect(onChange).toHaveBeenCalledWith("com.example.notes");
    const open = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Open app",
    )!;
    await click(open);
    expect(launchApp).toHaveBeenCalledWith("phone", "com.example.notes", true);
    expect(onOpened).toHaveBeenCalledWith("com.example.notes");
  });

  it("keeps duplicate names distinguishable and supports searching by package", async () => {
    await renderChoice({
      listInstalledApps: async () => [
        { name: "Notes", package: "com.example.notes" },
        { name: "Notes", package: "com.work.notes" },
        { name: "Browser", package: "com.example.web" },
      ],
    });
    await click(picker());
    expect(option("Notescom.example.notes")).toBeDefined();
    expect(option("Notescom.work.notes")).toBeDefined();
    expect(option("Browser")).toBeDefined();
    const search = document.querySelector<HTMLInputElement>(
      '[aria-label="Search installed apps"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "com.example.web",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(option("Browsercom.example.web")).toBeDefined();
    expect(option("Notescom.work.notes")).toBeUndefined();
  });

  it("retains a selected package while its name is loading or discovery fails", async () => {
    let rejectApps!: (error: Error) => void;
    const loading = new Promise<readonly ProductInstalledApp[]>((_resolve, reject) => {
      rejectApps = reject;
    });
    const { onChange } = await renderChoice(
      { listInstalledApps: () => loading },
      "com.example.notes",
    );
    expect(picker().textContent).toBe("com.example.notes");
    await click(picker());
    expect(option("Current screen").getAttribute("aria-selected")).toBe("false");
    expect(document.body.textContent).toContain("Loading installed apps…");
    await act(async () => rejectApps(new Error("Device offline")));
    await settle();
    expect(picker().textContent).toBe("com.example.notes");
    expect(document.body.textContent).toContain("Installed apps could not be loaded.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains unavailable discovery without endless loading", async () => {
    await renderChoice({});
    await click(picker());
    expect(document.body.textContent).toContain("Installed apps are unavailable.");
    expect(document.body.textContent).not.toContain("Loading installed apps…");
  });

  it("falls back to the package when the catalog has no display name", async () => {
    await renderChoice({
      listInstalledApps: async () => [{ name: " ", package: "com.example.notes" }],
    });
    await click(picker());
    await click(option("com.example.notes"));
    expect(picker().textContent).toBe("com.example.notes");
  });

  it.each([
    [
      "Request timed out",
      "Couldn’t confirm the app opened. Check the live view before trying again.",
    ],
    [
      "Package com.example.notes not installed",
      "This app is unavailable. Choose another app or use the current screen.",
    ],
    ["Permission denied", "Relay does not have permission to open this app."],
  ])("keeps an unresolved launch visible without retrying: %s", async (message, expected) => {
    const launchApp = vi.fn(async () => {
      throw new Error(message);
    });
    const { onOpened } = await renderChoice(
      {
        listInstalledApps: async () => [{ name: "Notes", package: "com.example.notes" }],
        launchApp,
      },
      "com.example.notes",
    );
    const open = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Open app",
    )!;
    await click(open);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(expected);
    expect(launchApp).toHaveBeenCalledOnce();
    expect(onOpened).not.toHaveBeenCalled();
    expect(picker().textContent).toBe("Notes");
  });
});
