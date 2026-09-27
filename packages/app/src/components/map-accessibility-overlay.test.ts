import { expect, it } from "vitest";
import { accessibilityControls } from "./map-accessibility-overlay";

it("uses accessibility coordinates and excludes full-screen containers", () => {
  const controls = accessibilityControls(
    {
      bounds: { width: 400, height: 800 },
      nodes: [
        {
          label: "Screen",
          rect: { x: 0, y: 0, width: 400, height: 800 },
          children: [
            { label: "SuperGrok", rect: { x: 20, y: 200, width: 360, height: 48 } },
            { label: "Hidden", visible: false, rect: { x: 20, y: 300, width: 360, height: 48 } },
          ],
        },
      ],
    },
    { width: 800, height: 1600 },
  );
  expect(controls).toEqual([{ label: "SuperGrok", x: 0.05, y: 0.25, width: 0.9, height: 0.06 }]);
});

it("does not invent controls for missing or malformed evidence", () => {
  expect(accessibilityControls(undefined, { width: 400, height: 800 })).toEqual([]);
  expect(
    accessibilityControls(
      { nodes: [{ label: "Wrong", rect: { x: 0, y: 0, width: -1, height: 30 } }] },
      { width: 400, height: 800 },
    ),
  ).toEqual([]);
});
