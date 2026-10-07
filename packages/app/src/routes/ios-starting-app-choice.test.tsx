/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceProductService, ProductLaunchedApp } from "../data/device-product-service";
import type { RecordingSetupAdmission } from "../data/recording-setup-admission";
import { IOSStartingAppChoice } from "./ios-starting-app-choice";

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
async function harness(service: DeviceProductService) {
  const opened = vi.fn();
  const changed = vi.fn();
  const submitted = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const query = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  async function render(
    next = service,
    serial = "ipad",
    value = "Grok",
    admission?: RecordingSetupAdmission,
  ) {
    await act(async () =>
      root!.render(
        <QueryClientProvider client={query}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitted();
            }}
          >
            <IOSStartingAppChoice
              service={next}
              serial={serial}
              value={value}
              onChange={changed}
              onOpened={opened}
              admission={admission}
            />
          </form>
        </QueryClientProvider>,
      ),
    );
  }
  await render();
  async function launch(enter = false) {
    await act(async () => {
      if (enter)
        host
          .querySelector("input")!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
          );
      else
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent === "Launch app")!
          .click();
    });
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
  return { host, render, launch, opened, changed, submitted };
}
const result: ProductLaunchedApp = {
  serial: "ipad",
  app: "Grok",
  platform: "ios",
  launchedAt: Date.now(),
  observed: { app: "Grok", matched: true },
};
describe("iOS starting app selection", () => {
  it("denies forced native setup callbacks while recording startup owns admission", async () => {
    const launchApp = vi.fn(async () => result);
    const service = { launchApp } as unknown as DeviceProductService;
    const view = await harness(service);
    const admission = { busy: true, mayEdit: () => false };
    await view.render(service, "ipad", "Grok", admission);
    expect(
      [...view.host.querySelectorAll<HTMLInputElement>("input")].every((input) => input.disabled),
    ).toBe(true);
    expect(
      [...view.host.querySelectorAll<HTMLButtonElement>("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    await view.launch(true);
    expect(launchApp).not.toHaveBeenCalled();
    expect(view.changed).not.toHaveBeenCalled();
    expect(view.opened).not.toHaveBeenCalled();
    expect(view.submitted).not.toHaveBeenCalled();
  });

  it("ignores a late launch receipt when startup closes admission on the same service and target", async () => {
    let finish!: (value: ProductLaunchedApp) => void;
    const service = {
      launchApp: () =>
        new Promise<ProductLaunchedApp>((resolve) => {
          finish = resolve;
        }),
    } as unknown as DeviceProductService;
    const view = await harness(service);
    await view.launch();
    await view.render(service, "ipad", "Grok", { busy: true, mayEdit: () => false });
    await act(async () => finish(result));
    expect(view.opened).toHaveBeenCalledExactlyOnceWith("");
    expect(view.changed).not.toHaveBeenCalled();
  });

  it("launches an alias explicitly with Enter without inventory calls or recording form submission", async () => {
    const launchApp = vi.fn(async () => result);
    const listInstalledApps = vi.fn(async () => {
      throw new Error("Unsupported on iOS");
    });
    const view = await harness({ launchApp, listInstalledApps } as unknown as DeviceProductService);
    expect(view.host.querySelectorAll("form")).toHaveLength(1);
    await view.launch(true);
    expect(launchApp).toHaveBeenCalledExactlyOnceWith("ipad", "Grok", false);
    expect(listInstalledApps).not.toHaveBeenCalled();
    expect(view.submitted).not.toHaveBeenCalled();
    expect(view.opened).toHaveBeenLastCalledWith("Grok");
  });
  it.each([undefined, { app: "Settings", matched: false }])(
    "does not confirm an unobserved launch (%j)",
    async (observed) => {
      const view = await harness({
        launchApp: async () => ({ ...result, observed }),
      } as unknown as DeviceProductService);
      await view.launch();
      expect(view.opened).toHaveBeenCalledExactlyOnceWith("");
      expect(view.changed).not.toHaveBeenCalled();
    },
  );
  it.each(["service", "serial", "application"] as const)(
    "rejects a pending response after %s replacement",
    async (replacement) => {
      let finish!: (value: ProductLaunchedApp) => void;
      const service = {
        launchApp: vi.fn(
          () =>
            new Promise<ProductLaunchedApp>((resolve) => {
              finish = resolve;
            }),
        ),
      } as unknown as DeviceProductService;
      const view = await harness(service);
      await view.launch();
      expect(view.host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
      await view.render(
        replacement === "service" ? ({} as DeviceProductService) : service,
        replacement === "serial" ? "other" : "ipad",
        replacement === "application" ? "Settings" : "Grok",
      );
      await act(async () => finish(result));
      expect(view.opened).toHaveBeenCalledExactlyOnceWith("");
      expect(view.changed).not.toHaveBeenCalled();
    },
  );
});
