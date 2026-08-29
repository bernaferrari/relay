import { expect, test } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { compileBrowserEnvironment } from "@relay/protocol";
import { BrowserDeviceEnvironmentSummary } from "./browser-device-environment-summary";

test("Browser Device environment disclosure exposes the complete frozen profile", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [profile] = createSignal(
    compileBrowserEnvironment({
      engine: "chromium",
      channel: "chrome",
      revision: "chrome-128",
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      mobile: true,
      touch: true,
      userAgent: "Relay mobile fixture",
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      colorScheme: "dark",
      reducedMotion: "reduce",
      geolocation: { latitude: -10, longitude: -37 },
      permissions: ["geolocation", "clipboard-read"],
      offline: true,
      networkProfile: "network:slow-3g",
      authenticationFixtureId: "auth:staging",
      featureFlagFixtureId: "flags:rtl",
      environmentRevision: "fixture-v2",
    }),
  );
  const dispose = render(() => <BrowserDeviceEnvironmentSummary profile={profile} />, root);

  const disclosure = root.querySelector<HTMLDetailsElement>("[data-browser-environment]");
  expect(disclosure).not.toBeNull();
  expect(disclosure?.textContent).toContain("chromium · 390×844 · pt-BR · America/Sao_Paulo");
  for (const value of [
    "chrome-128",
    "Relay mobile fixture",
    "reduce",
    "geolocation, clipboard-read",
    "network:slow-3g",
    "auth:staging",
    "flags:rtl",
    "fixture-v2",
  ]) {
    expect(disclosure?.textContent).toContain(value);
  }
  expect(disclosure?.title).toContain("every saved field");
  dispose();
  root.remove();
});
