import { expect, test } from "vitest";
import { normalizeMapLibraryArea } from "./map-library";

test("the maps tab key is 'maps' and legacy stored 'tests' values normalize on read", () => {
  expect(normalizeMapLibraryArea("maps")).toBe("maps");
  expect(normalizeMapLibraryArea("tests")).toBe("maps");
  expect(normalizeMapLibraryArea("runs")).toBe("runs");
  expect(normalizeMapLibraryArea("anything-else")).toBe("maps");
});
