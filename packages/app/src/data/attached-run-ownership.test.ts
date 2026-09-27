import { describe, expect, it } from "vitest";
import { attachedRunLinkTestId, attachedRunOwnership } from "./attached-run-ownership";

describe("attached Run ownership", () => {
  it("does not treat a copied foreign Run as owned by the current Test", () => {
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

  it("keeps a matching Test+Run pair owned", () => {
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
