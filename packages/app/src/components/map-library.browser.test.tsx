import { expect, test } from "vitest";
import { initialMapLibraryArea } from "../lib/map-library-area";
import { normalizeMapLibraryArea } from "./map-library";

test("the maps tab key is 'maps' and legacy stored 'tests' values normalize on read", () => {
  expect(normalizeMapLibraryArea("changes")).toBe("changes");
  expect(normalizeMapLibraryArea("maps")).toBe("maps");
  expect(normalizeMapLibraryArea("tests")).toBe("maps");
  expect(normalizeMapLibraryArea("runs")).toBe("runs");
  expect(normalizeMapLibraryArea("anything-else")).toBe("maps");
});

test("starts Change-first while honoring Proof and Run deep links", () => {
  expect(initialMapLibraryArea("")).toBe("changes");
  expect(initialMapLibraryArea("?proof=proof-184")).toBe("changes");
  expect(initialMapLibraryArea("?run=run-rtl")).toBe("runs");
  expect(initialMapLibraryArea("?proof=proof-184&run=run-rtl")).toBe("changes");
});
