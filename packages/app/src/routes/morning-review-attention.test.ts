import { describe, expect, it } from "vitest";
import { morningAttentionItems } from "./morning-review-attention";

describe("morning attention", () => {
  it("fails closed to signed-desktop, judges, weekly, native, and lab-server", () => {
    const items = morningAttentionItems({});
    expect(items.map((item) => item.id)).toEqual([
      "signed-desktop",
      "judge",
      "weekly",
      "accounts",
      "native",
      "lab-server",
    ]);
    expect(items.find((item) => item.id === "signed-desktop")?.label).toBe("Signed desktop build");
    expect(items.find((item) => item.id === "judge")?.detail).toMatch(/OPENROUTER_API_KEY/u);
    expect(items.find((item) => item.id === "judge")?.detail).toMatch(/grok-web-judged/u);
    expect(items.find((item) => item.id === "weekly")?.label).toBe("Grok.com weekly manual");
    expect(items.find((item) => item.id === "accounts")?.label).toBe("Accounts health");
    expect(items.find((item) => item.id === "accounts")?.detail).toMatch(/Check live health/u);
    expect(items.find((item) => item.id === "accounts")?.href).toBe("/accounts");
    expect(items.find((item) => item.id === "native")?.detail).toMatch(
      /emulator cannot install Grok/u,
    );
    expect(items.find((item) => item.id === "native")?.detail).toMatch(
      /do not Recover-kill or dump/u,
    );
    expect(items.find((item) => item.id === "native")?.detail).toMatch(
      /iOS lock and airplane stay Blocked \/ UNRECORDED/u,
    );
    expect(items.find((item) => item.id === "native")?.detail).toMatch(/Do not fake a lock run/u);
    expect(items.find((item) => item.id === "lab-server")?.detail).toMatch(
      /dev\.relay\.lab-server/u,
    );
  });

  it("omits signed-desktop and judges when those payloads are ready", () => {
    const items = morningAttentionItems({
      apple: {
        operatorBuild: {
          status: "ready",
          detail: "Developer ID Application: Relay QA can sign a Relay operator build.",
        },
        judgeProvider: {
          status: "ready",
          configured: true,
          detail: "OPENROUTER_API_KEY is set. Visual and semantic judges can run.",
        },
        labServer: {
          status: "needs-attention",
          loaded: false,
          detail: "Lab Mac launchd stays unloaded. Job dev.relay.lab-server is not loaded.",
        },
      },
    });
    expect(items.map((item) => item.id)).toEqual(["weekly", "accounts", "native", "lab-server"]);
  });
});
