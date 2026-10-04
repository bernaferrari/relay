import { describe, expect, it } from "vitest";
import { layoutTracePresentation } from "./layout-trace-presentation";

const rawTitle = "Check layout: identifier team-seats does not overlap identifier save-settings";
const first = { identifier: "team-seats" };
const second = { identifier: "save-settings" };
const command = (stepId: string) => ({
  kind: "command-attempt",
  data: { stepId, command: { kind: "assert-layout", relation: "non-overlap", first, second } },
});
const tree = (stepId: string, seats = "Team seats", save = "Save") => ({
  kind: "ui-tree",
  data: {
    stepId,
    phase: "after",
    nodes: [
      { identifier: "team-seats", label: seats },
      { identifier: "save-settings", label: save },
    ],
  },
});
const overlap = {
  kind: "layout-assertion",
  data: {
    relation: "non-overlap",
    first,
    second,
    passed: false,
    overlap: { x: 10, y: 20, width: 44, height: 28 },
    error: "layout assertion: identifier team-seats overlaps identifier save-settings by 44×28 px",
  },
};

describe("layout trace presentation", () => {
  it("uses retained labels and a proven overlap, keeping selectors in technical details", () => {
    expect(
      layoutTracePresentation({ artifacts: [command("a"), overlap, tree("a")] }, "a", rawTitle),
    ).toEqual({
      title: "Check Team seats and Save do not overlap",
      failure: {
        kind: "layout-overlap",
        cause: overlap.data.error,
        summary: "Team seats and Save overlap.",
        technicalDetail: `${rawTitle}\n${overlap.data.error}`,
      },
    });
  });

  it("keeps missing and ambiguous bounds distinct from an overlap", () => {
    for (const error of ["has no visible element with bounds", "resolved to 2 distinct elements"]) {
      const unavailable = {
        ...overlap,
        data: { ...overlap.data, overlap: undefined, error },
      };
      expect(
        layoutTracePresentation(
          { artifacts: [command("a"), unavailable, tree("a")] },
          "a",
          rawTitle,
        ),
      ).toEqual({ title: "Check Team seats and Save do not overlap" });
    }
  });

  it("does not invent names from identifiers, other traces, or ambiguous trees", () => {
    const ambiguous = tree("a");
    ambiguous.data.nodes.push({ identifier: "save-settings", label: "Another Save" });
    for (const nodes of [undefined, tree("other"), ambiguous]) {
      const result = layoutTracePresentation(
        { artifacts: [command("a"), overlap, ...(nodes ? [nodes] : [])] },
        "a",
        rawTitle,
      );
      expect(result?.title).toBe("Check elements do not overlap");
      expect(result?.failure?.summary).toBe("The two elements overlap.");
    }
  });

  it("joins each repeated assertion to its own artifact window", () => {
    const artifacts = [
      command("a"),
      overlap,
      tree("a", "Team seats", "Save"),
      command("b"),
      { ...overlap, data: { ...overlap.data, passed: true, overlap: null } },
      tree("b", "Available seats", "Confirm"),
    ];
    expect(layoutTracePresentation({ artifacts }, "a", rawTitle)?.failure?.summary).toBe(
      "Team seats and Save overlap.",
    );
    expect(layoutTracePresentation({ artifacts }, "b", rawTitle)).toEqual({
      title: "Check Available seats and Confirm do not overlap",
    });
  });

  it("requires an exact target join and positive overlap evidence", () => {
    for (const data of [
      { ...overlap.data, first: { identifier: "another-element" } },
      { ...overlap.data, overlap: { x: 10, y: 20, width: 0, height: 28 } },
      { ...overlap.data, overlap: { x: NaN, y: 20, width: 44, height: 28 } },
      { ...overlap.data, passed: true },
    ]) {
      expect(
        layoutTracePresentation(
          { artifacts: [command("a"), { ...overlap, data }, tree("a")] },
          "a",
          rawTitle,
        )?.failure,
      ).toBeUndefined();
    }
  });

  it("does not join duplicate commands or unrelated step kinds", () => {
    expect(
      layoutTracePresentation(
        { artifacts: [command("a"), command("a"), overlap, tree("a")] },
        "a",
        rawTitle,
      ),
    ).toBeUndefined();
    expect(
      layoutTracePresentation(
        {
          artifacts: [{ kind: "command-attempt", data: { stepId: "a", command: { kind: "tap" } } }],
        },
        "a",
        "Tap Save",
      ),
    ).toBeUndefined();
  });
});
