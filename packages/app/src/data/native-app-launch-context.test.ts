import { describe, expect, it } from "vitest";
import type { DeviceProductService, ProductLaunchedApp } from "./device-product-service";
import {
  NATIVE_APP_LAUNCH_HANDOFF_MAX_AGE_MS,
  forgetNativeAppLaunch,
  rememberNativeAppLaunch,
  takeNativeAppLaunch,
} from "./native-app-launch-context";

const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
const launch: ProductLaunchedApp = {
  serial: "ipad",
  platform: "ios",
  app: "Grok",
  launchedAt: Date.now(),
  observed: { app: "Grok", matched: true },
};

describe("verified native launch handoff", () => {
  it("retains the owned starting app and consumes the exact receipt once", () => {
    const service = {} as DeviceProductService;
    rememberNativeAppLaunch(service, launch);
    expect(takeNativeAppLaunch(service, target, "Grok")).toMatchObject({
      serial: "ipad",
      platform: "ios",
      originApplication: "Grok",
      observedApplication: "Grok",
    });
    expect(takeNativeAppLaunch(service, target, "Grok")).toBeUndefined();
  });
  it("does not grant foreground proof from a route app string alone", () => {
    expect(takeNativeAppLaunch({} as DeviceProductService, target, "Grok")).toBeUndefined();
  });
  it("binds the receipt to the service, target platform, serial and application", () => {
    const service = {} as DeviceProductService;
    rememberNativeAppLaunch(service, launch);
    expect(takeNativeAppLaunch({} as DeviceProductService, target, "Grok")).toBeUndefined();
    expect(
      takeNativeAppLaunch(service, { ...target, platform: "android" }, "Grok"),
    ).toBeUndefined();
    expect(takeNativeAppLaunch(service, { ...target, targetId: "other" }, "Grok")).toBeUndefined();
    expect(takeNativeAppLaunch(service, target, "Settings")).toBeUndefined();
    expect(takeNativeAppLaunch(service, target, "Grok")).toBeDefined();
  });
  it.each([undefined, { app: "Settings", matched: false }])(
    "rejects an unverified launch (%j)",
    (observed) => {
      const service = {} as DeviceProductService;
      rememberNativeAppLaunch(service, { ...launch, observed });
      expect(takeNativeAppLaunch(service, target, "Grok")).toBeUndefined();
    },
  );
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid launch timestamp %s",
    (launchedAt) => {
      const service = {} as DeviceProductService;
      rememberNativeAppLaunch(service, { ...launch, launchedAt });
      expect(takeNativeAppLaunch(service, target, "Grok")).toBeUndefined();
    },
  );
  it.each([100 - 1, 100 + NATIVE_APP_LAUNCH_HANDOFF_MAX_AGE_MS + 1, Number.NaN])(
    "discards a future, expired or invalid clock receipt at %s",
    (now) => {
      const service = {} as DeviceProductService;
      rememberNativeAppLaunch(service, { ...launch, launchedAt: 100 });
      expect(takeNativeAppLaunch(service, target, "Grok", now)).toBeUndefined();
      expect(takeNativeAppLaunch(service, target, "Grok", 100)).toBeUndefined();
    },
  );
  it("accepts the bounded two minute handoff boundary", () => {
    const service = {} as DeviceProductService;
    rememberNativeAppLaunch(service, { ...launch, launchedAt: 100 });
    expect(
      takeNativeAppLaunch(service, target, "Grok", 100 + NATIVE_APP_LAUNCH_HANDOFF_MAX_AGE_MS),
    ).toBeDefined();
  });
  it("invalidates a previous handoff after input or an unmatched new launch", () => {
    const service = {} as DeviceProductService;
    rememberNativeAppLaunch(service, launch);
    forgetNativeAppLaunch(service, "ipad");
    expect(takeNativeAppLaunch(service, target, "Grok")).toBeUndefined();
    rememberNativeAppLaunch(service, launch);
    rememberNativeAppLaunch(service, { ...launch, observed: { app: "Settings", matched: false } });
    expect(takeNativeAppLaunch(service, target, "Grok")).toBeUndefined();
  });
});
