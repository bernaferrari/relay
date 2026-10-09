import { describe, expect, it } from "vitest";
import { attachedRunLinkTestId, attachedRunOwnership } from "./attached-run-ownership";

describe("attached run ownership", () => {
  it("does not treat a copied foreign run as owned by the current test", () => {
    expect(
      attachedRunOwnership({
        routeTestId: "test-A",
        runTestId: "test-B",
      }),
    ).toEqual({
      kind: "foreign",
      routeTestId: "test-A",
      runTestId: "test-B",
    });
    expect(
      attachedRunLinkTestId(
        attachedRunOwnership({ routeTestId: "test-A", runTestId: "test-B" }),
        "test-A",
      ),
    ).toBe("test-B");
  });

  it("keeps a matching test+Run pair owned", () => {
    expect(
      attachedRunOwnership({
        routeTestId: "test-A",
        runTestId: "test-A",
      }),
    ).toEqual({ kind: "owned", testId: "test-A" });
  });

  it("stays unresolved until both identities are known", () => {
    expect(attachedRunOwnership({ routeTestId: "test-A" })).toEqual({ kind: "unresolved" });
    expect(attachedRunOwnership({ runTestId: "test-B" })).toEqual({ kind: "unresolved" });
  });
});
