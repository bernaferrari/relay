import { describe, expect, it } from "vitest";
import { friendlySuiteIssue } from "./suite-preflight-copy";

describe("friendlySuiteIssue", () => {
  it("keeps the missing runtime profile and target names", () => {
    expect(
      friendlySuiteIssue("Bind a runtime profile to Open grok.com logged-out · logged-out."),
    ).toBe("Bind a runtime profile to Open grok.com logged-out · logged-out.");
    expect(
      friendlySuiteIssue(
        "Multiple saved runtime profiles bind to browser:grok-com: browser:grok-com, browser:grok-com-1280x800-339a5a430a41. Bind an explicit targetProfileId.",
      ),
    ).toMatch(/browser:grok-com-1280x800-339a5a430a41/u);
    expect(
      friendlySuiteIssue(
        "No saved runtime profile for target browser:chatgpt-qa-pilot — capture a screen on this target first.",
      ),
    ).toMatch(/chatgpt-qa-pilot/u);
  });

  it("does not hide a two-profile grok.com ambiguity as a missing saved profile", () => {
    expect(
      friendlySuiteIssue("Bind a saved runtime profile to every selected Combine cell."),
    ).not.toBe("This browser needs a saved profile before it can run the Plan.");
  });
});
