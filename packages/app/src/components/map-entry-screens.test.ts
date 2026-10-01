import { expect, it } from "vitest";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { mapEntryScreenIds } from "./map-entry-screens";
import { layoutMapScreens } from "./map-canvas-geometry";
const screen = (id: string): ProductMapScreen => ({
  id,
  title: id,
  variants: [],
  variantCount: 0,
  coveringTests: [],
  recentFailures: [],
});
const path = (from: string, to: string, label = "Open"): ProductMapPath => ({
  id: `${from}-${to}`,
  fromScreenId: from,
  toScreenId: to,
  fromTitle: from,
  toTitle: to,
  label,
  coveringTests: [],
});
it("keeps the saved Home origin first despite reciprocal tab actions and selection order", () => {
  const screens = [
    screen("sidebar"),
    screen("imagine"),
    { ...screen("home"), entryPoint: true },
    screen("settings"),
  ];
  const paths = [
    path("home", "sidebar"),
    path("home", "imagine"),
    path("imagine", "home", "Ask"),
    path("sidebar", "home", "New conversation"),
    path("sidebar", "settings"),
    path("settings", "sidebar", "Close"),
  ];
  expect(mapEntryScreenIds(screens, paths)).toEqual(["home"]);
  const positions = layoutMapScreens(screens, paths);
  expect(positions).toEqual(layoutMapScreens([...screens].reverse(), [...paths].reverse()));
  expect(positions.get("home")!.x).toBeLessThan(positions.get("sidebar")!.x);
  expect(positions.get("sidebar")!.x).toBeLessThan(positions.get("settings")!.x);
});
it("prefers a structural entry and uses stable navigation hubs when a component cycles", () => {
  const screens = [screen("settings"), screen("home"), screen("sidebar"), screen("loose")];
  const paths = [
    path("home", "sidebar"),
    path("sidebar", "settings"),
    path("settings", "home", "Back"),
  ];
  expect(mapEntryScreenIds(screens, paths)).toEqual(["home", "loose"]);
  expect(mapEntryScreenIds([...screens].reverse(), paths)).toEqual(["home", "loose"]);
});
