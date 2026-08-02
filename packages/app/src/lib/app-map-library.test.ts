import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { appMapLibraryItem } from "./app-map-library";

test("projects a library row from the canonical App Map alone", () => {
  const appMap = {
    id: "map-1",
    name: "Checkout",
    updatedAt: 42,
    screens: { cart: {}, payment: {} },
    connections: { checkout: {} },
  } as unknown as AppMap;

  assert.deepEqual(appMapLibraryItem(appMap), {
    id: "map-1",
    name: "Checkout",
    updatedAt: 42,
    screenCount: 2,
    connectionCount: 1,
  });
});
