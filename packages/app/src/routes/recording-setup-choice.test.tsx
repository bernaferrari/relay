/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordingDeviceChoice } from "../components/recording-device-choice";
import type { DeviceProductService } from "../data/device-product-service";
import type { RecordingSetupAdmission } from "../data/recording-setup-admission";
import { RecordingAppChoice } from "./recording-app-choice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function mount(content: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const query = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  async function render(next: ReactNode) {
    await act(async () =>
      root!.render(<QueryClientProvider client={query}>{next}</QueryClientProvider>),
    );
    await settle();
  }
  await render(content);
  return { host, render };
}

async function settle() {
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
}

async function click(element: HTMLElement | undefined | null) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
  await settle();
}

function option(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes(label),
  );
}

function button(host: HTMLElement, label: string) {
  return [...host.querySelectorAll("button")].find((item) => item.textContent === label);
}

async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

const openAdmission: RecordingSetupAdmission = { busy: false, mayEdit: () => true };
const closedAdmission: RecordingSetupAdmission = { busy: true, mayEdit: () => false };

describe("recording setup choices", () => {
  it.each(["Other app", "+ Create app…"])(
    "rejects an already-open app option (%s) when startup takes admission",
    async (label) => {
      let available = true;
      const admission: RecordingSetupAdmission = { busy: false, mayEdit: () => available };
      const changed = vi.fn();
      const creating = vi.fn();
      const createApp = vi.fn(async () => ({ id: "new", name: "New" }));
      const view = await mount(
        <RecordingAppChoice
          apps={[{ id: "other", name: "Other app" }]}
          value=""
          onChange={changed}
          createApp={createApp}
          onCreated={vi.fn()}
          onCreatingChange={creating}
          admission={admission}
        />,
      );
      await click(view.host.querySelector('[aria-label="App"]'));
      const pendingOption = option(label);
      expect(pendingOption).toBeTruthy();
      available = false;
      await click(pendingOption);
      expect(changed).not.toHaveBeenCalled();
      expect(creating).not.toHaveBeenCalled();
      expect(createApp).not.toHaveBeenCalled();
      expect(view.host.querySelector("#recording-app-name")).toBeNull();
    },
  );

  it.each(["iPad", "Pixel · Start Android emulator"])(
    "rejects an already-open Record on option (%s) before clearing selection or booting",
    async (label) => {
      let available = true;
      const admission: RecordingSetupAdmission = { busy: false, mayEdit: () => available };
      const changed = vi.fn();
      const started = vi.fn(async () => {});
      const startEmulator = vi.fn(async () => ({ serial: "emulator-5554" }));
      const service = {
        listEmulators: async () => ({
          avds: [{ avdName: "pixel", name: "Pixel", booted: false }],
        }),
        startEmulator,
      } as unknown as DeviceProductService;
      const view = await mount(
        <RecordingDeviceChoice
          service={service}
          value=""
          options={[{ value: "ipad", label: "iPad" }]}
          onChange={changed}
          onStarted={started}
          admission={admission}
        />,
      );
      await settle();
      await click(view.host.querySelector('[aria-label="Record on"]'));
      const pendingOption = option(label);
      expect(pendingOption).toBeTruthy();
      available = false;
      await click(pendingOption);
      expect(changed).not.toHaveBeenCalled();
      expect(startEmulator).not.toHaveBeenCalled();
      expect(started).not.toHaveBeenCalled();
    },
  );

  it("keeps the app draft and rejects Create and Cancel while the synchronous lock is closed", async () => {
    let available = true;
    const admission: RecordingSetupAdmission = { busy: false, mayEdit: () => available };
    const creating = vi.fn();
    const createApp = vi.fn(async () => ({ id: "new", name: "Acme" }));
    const view = await mount(
      <RecordingAppChoice
        apps={[{ id: "other", name: "Other app" }]}
        value=""
        onChange={vi.fn()}
        createApp={createApp}
        onCreated={vi.fn()}
        onCreatingChange={creating}
        admission={admission}
      />,
    );
    await click(view.host.querySelector('[aria-label="App"]'));
    await click(option("+ Create app…"));
    await fill(view.host.querySelector<HTMLInputElement>("#recording-app-name")!, "Acme");
    creating.mockClear();
    available = false;
    await fill(view.host.querySelector<HTMLInputElement>("#recording-app-name")!, "Changed");
    await act(async () => {
      view.host
        .querySelector("#recording-app-name")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
    });
    await click(button(view.host, "Create app"));
    await click(button(view.host, "Cancel"));
    expect(createApp).not.toHaveBeenCalled();
    expect(creating).not.toHaveBeenCalled();
    expect(view.host.querySelector<HTMLInputElement>("#recording-app-name")!.value).toBe("Acme");
    available = true;
    await click(button(view.host, "Cancel"));
    expect(creating).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each([true, false])(
    "uses the latest admission when app creation completes (replaced with closed admission: %s)",
    async (locked) => {
      const receipt = deferred<{ id: string; name: string }>();
      const createApp = vi.fn(() => receipt.promise);
      const created = vi.fn();
      const creating = vi.fn();
      const choice = (admission?: RecordingSetupAdmission) => (
        <RecordingAppChoice
          apps={[]}
          value=""
          onChange={vi.fn()}
          createApp={createApp}
          onCreated={created}
          onCreatingChange={creating}
          admission={admission}
        />
      );
      const view = await mount(choice(locked ? openAdmission : undefined));
      await fill(view.host.querySelector<HTMLInputElement>("#recording-app-name")!, "Acme");
      await click(button(view.host, "Create app"));
      expect(createApp).toHaveBeenCalledExactlyOnceWith("Acme");
      if (locked) await view.render(choice(closedAdmission));
      await act(async () => receipt.resolve({ id: "new", name: "Acme" }));
      await settle();
      if (locked) {
        expect(created).not.toHaveBeenCalled();
        expect(creating).not.toHaveBeenCalled();
        expect(view.host.querySelector<HTMLInputElement>("#recording-app-name")!.value).toBe(
          "Acme",
        );
        expect(view.host.querySelector<HTMLInputElement>("#recording-app-name")!.disabled).toBe(
          true,
        );
      } else {
        expect(created).toHaveBeenCalledExactlyOnceWith({ id: "new", name: "Acme" });
        expect(creating).toHaveBeenCalledExactlyOnceWith(false);
        expect(view.host.querySelector<HTMLInputElement>("#recording-app-name")!.value).toBe("");
      }
    },
  );

  it.each([true, false])(
    "uses the latest admission when emulator boot completes (replaced with closed admission: %s)",
    async (locked) => {
      const receipt = deferred<{ serial: string }>();
      const startEmulator = vi.fn(() => receipt.promise);
      const listEmulators = vi.fn(async () => ({
        avds: [{ avdName: "pixel", name: "Pixel", booted: false }],
      }));
      const service = { listEmulators, startEmulator } as unknown as DeviceProductService;
      const changed = vi.fn();
      const started = vi.fn(async () => {});
      const choice = (admission?: RecordingSetupAdmission) => (
        <RecordingDeviceChoice
          service={service}
          value="ipad"
          options={[{ value: "ipad", label: "iPad" }]}
          onChange={changed}
          onStarted={started}
          admission={admission}
        />
      );
      const view = await mount(choice(locked ? openAdmission : undefined));
      await settle();
      await click(view.host.querySelector('[aria-label="Record on"]'));
      await click(option("Pixel · Start Android emulator"));
      expect(startEmulator).toHaveBeenCalledExactlyOnceWith("pixel");
      expect(changed).toHaveBeenCalledExactlyOnceWith("");
      if (locked) await view.render(choice(closedAdmission));
      await act(async () => receipt.resolve({ serial: "emulator-5554" }));
      await settle();
      if (locked) {
        expect(started).not.toHaveBeenCalled();
        expect(listEmulators).toHaveBeenCalledTimes(1);
        expect(
          view.host.querySelector<HTMLButtonElement>('[aria-label="Record on"]')!.disabled,
        ).toBe(true);
      } else {
        expect(started).toHaveBeenCalledExactlyOnceWith("emulator-5554");
        expect(listEmulators).toHaveBeenCalledTimes(2);
      }
    },
  );
});
