/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthoringTarget } from "@relay/protocol";
import type { DeviceProductService } from "../data/device-product-service";
import { rememberNativeAppLaunch } from "../data/native-app-launch-context";
import { useNativeAppStartContext } from "./use-native-app-start-context";

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
function receipt(service: DeviceProductService, launchedAt = Date.now()) {
  rememberNativeAppLaunch(service, {
    serial: "ipad",
    platform: "ios",
    app: "Grok",
    launchedAt,
    observed: { app: "Grok", matched: true },
  });
}
async function harness(service: DeviceProductService) {
  let current!: ReturnType<typeof useNativeAppStartContext>;
  const renders: string[] = [];
  function Probe({
    service,
    selected,
    targetId,
  }: {
    service: DeviceProductService;
    selected?: AuthoringTarget;
    targetId: string;
  }) {
    current = useNativeAppStartContext({
      service,
      target: selected,
      targetId,
      requestedOriginApplication: "Grok",
    });
    renders.push(current.openedApplication);
    return <output>{current.openedApplication}</output>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  async function render(
    next = service,
    selected: AuthoringTarget | undefined = target,
    targetId = selected?.targetId ?? "ipad",
  ) {
    renders.length = 0;
    await act(async () =>
      root!.render(<Probe service={next} selected={selected} targetId={targetId} />),
    );
  }
  await render();
  return {
    render,
    renders,
    get current() {
      return current;
    },
  };
}
describe("native starting app handoff identity", () => {
  it("does not enable Start from an origin URL without a canonical receipt", async () => {
    const view = await harness({} as DeviceProductService);
    expect(view.current.originApplication).toBe("Grok");
    expect(view.current.openedApplication).toBe("");
  });
  it("retains the baseline and invalidates opened proof on service replacement during render", async () => {
    const service = {} as DeviceProductService;
    receipt(service);
    const view = await harness(service);
    expect(view.current.openedApplication).toBe("Grok");
    await view.render({} as DeviceProductService);
    expect(view.renders).not.toContain("Grok");
    expect(view.current.originApplication).toBe("Grok");
    expect(view.current.openedApplication).toBe("");
    await view.render(service);
    expect(view.current.openedApplication).toBe("");
  });
  it.each([
    [{ ...target, targetId: "other" }, "other"],
    [{ ...target, platform: "android" }, "ipad"],
    [{ kind: "browser", platform: "browser", targetId: "ipad" }, "ipad"],
    [target, "other"],
  ] as const)("hides old opened proof before target swap effects (%j)", async (selected, id) => {
    const service = {} as DeviceProductService;
    receipt(service);
    const view = await harness(service);
    expect(view.current.openedApplication).toBe("Grok");
    await view.render(service, selected, id);
    expect(view.renders).not.toContain("Grok");
    expect(view.current.openedApplication).toBe("");
  });
  it("does not restore expired launch proof", async () => {
    const service = {} as DeviceProductService;
    receipt(service, Date.now() - 120_001);
    const view = await harness(service);
    expect(view.current.originApplication).toBe("Grok");
    expect(view.current.openedApplication).toBe("");
  });
});
