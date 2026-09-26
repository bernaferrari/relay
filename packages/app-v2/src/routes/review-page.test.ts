import { describe, expect, it } from "vitest";
import type { CaptureReviewItem, ReviewInboxResult } from "@relay/protocol";
import { cardsOf, screenshotName } from "./review-page";

const item = (captureId: string, state?: "changed" | "new"): CaptureReviewItem => ({
  captureId,
  caption: `step:open:${captureId}`,
  status: "pending",
  ...(state ? { reference: { state, comparedAt: 1 } } : {}),
});

const inbox: ReviewInboxResult = {
  runsConsidered: 2,
  totals: { captured: 3, missing: 0, pending: 3, accepted: 0, issue: 0, needMoreEvidence: 0 },
  entries: [
    {
      runId: "a",
      title: "Checkout",
      finishedAt: 2,
      items: [item("Cart", "changed"), item("Pay", "new")],
    },
    { runId: "b", title: "Settings", finishedAt: 1, items: [item("Profile")] },
  ],
};

describe("review inbox cards", () => {
  it("keeps run order and filters by change state", () => {
    expect(cardsOf(inbox, "all").map((card) => card.key)).toEqual([
      "a::Cart",
      "a::Pay",
      "b::Profile",
    ]);
    expect(cardsOf(inbox, "changed").map((card) => card.item.captureId)).toEqual(["Cart"]);
    // Anything without a detected change (new, or not compared yet) is "new" to a person.
    expect(cardsOf(inbox, "new").map((card) => card.item.captureId)).toEqual(["Pay", "Profile"]);
  });

  it("names screenshots after their step, not the internal caption", () => {
    expect(screenshotName(item("Cart"))).toBe("Cart");
    expect(
      screenshotName({ ...item("x"), caption: "app-map:shop:test:1", lookFor: "Receipt" }),
    ).toBe("Receipt");
  });
});
