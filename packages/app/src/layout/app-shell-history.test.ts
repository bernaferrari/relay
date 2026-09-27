import { describe, expect, it } from "vitest";
import {
  historyAvailabilityFlags,
  initialHistoryAvailability,
  updateHistoryAvailability,
} from "./app-shell-history";

describe("App shell history availability", () => {
  it.each([
    [
      "PUSH",
      { index: 0, furthest: 0 },
      { index: 1, furthest: 1 },
      { canGoBack: true, canGoForward: false },
    ],
    [
      "BACK",
      { index: 2, furthest: 2 },
      { index: 0, furthest: 2 },
      { canGoBack: false, canGoForward: true },
    ],
    [
      "FORWARD",
      { index: 0, furthest: 2 },
      { index: 1, furthest: 2 },
      { canGoBack: true, canGoForward: true },
    ],
    [
      "GO",
      { index: 2, furthest: 2 },
      { index: 0, furthest: 2 },
      { canGoBack: false, canGoForward: true },
    ],
  ] as const)("tracks %s transitions", (action, start, expected, flags) => {
    const position = updateHistoryAvailability(start, {
      action,
      index: expected.index,
    });

    expect(position).toEqual(expected);
    expect(historyAvailabilityFlags(position)).toEqual(flags);
  });

  it("fails closed for an external entry without a Relay history index", () => {
    const position = updateHistoryAvailability(
      { index: 2, furthest: 4 },
      { action: "GO", index: undefined },
    );

    expect(position).toEqual({ index: 0, furthest: 0 });
    expect(historyAvailabilityFlags(position)).toEqual({
      canGoBack: false,
      canGoForward: false,
    });
  });

  it("starts a new forward branch after pushing from a back entry", () => {
    const afterBack = updateHistoryAvailability(
      { index: 3, furthest: 3 },
      { action: "BACK", index: 1 },
    );
    const afterPush = updateHistoryAvailability(afterBack, { action: "PUSH", index: 2 });

    expect(afterPush).toEqual({ index: 2, furthest: 2 });
    expect(historyAvailabilityFlags(afterPush)).toEqual({
      canGoBack: true,
      canGoForward: false,
    });
  });

  it("starts from a known initial index when the browser state is populated", () => {
    expect(initialHistoryAvailability(2)).toEqual({ index: 2, furthest: 2 });
    expect(historyAvailabilityFlags(initialHistoryAvailability(2))).toEqual({
      canGoBack: true,
      canGoForward: false,
    });
  });
});
