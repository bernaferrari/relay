import { expect, it } from "vitest";
import { operatorBuildChecks, setupChecks } from "./settings-support";

it("keeps Apple device checks separate from operator packaging", () => {
  const payload = {
    checks: [{ id: "relay", label: "Relay runner", status: "ready", detail: "Ready" }],
    operatorBuild: {
      status: "needs-attention",
      detail:
        "A Developer ID Application identity is required to ship a signed operator build. Apple Development is not enough. Morning review stays on the Vite UI and local server until that identity exists.",
    },
  };
  expect(setupChecks(payload)).toEqual([
    { id: "relay", label: "Relay runner", status: "ready", detail: "Ready" },
  ]);
  expect(operatorBuildChecks(payload)[0]?.status).toBe("needs-attention");
  expect(operatorBuildChecks(payload)[0]?.detail).toMatch(/Apple Development is not enough/u);
});

it("fails closed when operator packaging is missing from the payload", () => {
  const checks = operatorBuildChecks({
    checks: [{ id: "relay", label: "Relay runner", status: "ready", detail: "Ready" }],
  });
  expect(checks).toHaveLength(1);
  expect(checks[0]?.status).toBe("needs-attention");
  expect(checks[0]?.detail).toMatch(/Developer ID Application/u);
});

it("is ready only when Developer ID Application is present", () => {
  expect(
    operatorBuildChecks({
      operatorBuild: {
        status: "ready",
        detail: "Developer ID Application: Relay QA can sign a Relay operator build.",
        identityName: "Developer ID Application: Relay QA",
      },
    })[0]?.status,
  ).toBe("ready");
});
