import { expect, it } from "vitest";
import { walkthroughDestinationAvailable } from "./walkthrough-destinations";
import type { PlayerManifestProjection } from "../data/run-product-service";
const manifest = {
  captures: [{ id: "member-image", stateId: "settings", variantId: "member" }],
} as unknown as PlayerManifestProjection;
it("never enables a destination from another configuration or a different recorded capture", () => {
  const connection = {
    id: "settings-link",
    fromStateId: "home",
    toStateId: "settings",
    kind: "recorded",
    label: "Settings",
    provenance: { runId: "member-run", captureId: "member-image" },
  } as const;
  expect(walkthroughDestinationAvailable(manifest, connection, "member")).toBe(true);
  expect(walkthroughDestinationAvailable(manifest, connection, "admin")).toBe(false);
  expect(
    walkthroughDestinationAvailable(
      manifest,
      { ...connection, provenance: { ...connection.provenance, captureId: "missing-image" } },
      "member",
    ),
  ).toBe(false);
  expect(
    walkthroughDestinationAvailable(manifest, { ...connection, kind: "suggested" }, "member"),
  ).toBe(false);
});
