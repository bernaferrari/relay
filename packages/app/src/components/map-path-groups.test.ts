import { expect, it } from "vitest";
import { canvasMapPaths } from "./map-path-groups";
const path = (id: string, toScreenId?: string) => ({
  id,
  fromScreenId: "home",
  toScreenId,
  fromTitle: "Home",
  toTitle: "Sidebar",
  label: id,
  coveringTests: [],
});
it("draws one wire per destination and retains every independently selectable action", () => {
  const paths = [
    path("tap-menu", "sidebar"),
    path("recorded-menu", "sidebar"),
    path("other"),
    path("unrecorded"),
  ];
  const presentation = canvasMapPaths(paths, "recorded-menu");
  expect(presentation).toHaveLength(3);
  expect(presentation[0]?.id).toBe("recorded-menu");
  expect(presentation[0]?.parallelPaths?.map((item) => item.id)).toEqual([
    "tap-menu",
    "recorded-menu",
  ]);
  expect(paths).toHaveLength(4);
});
