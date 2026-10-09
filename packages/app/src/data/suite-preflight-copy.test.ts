import { describe, expect, it } from "vitest";
import { friendlySuiteIssue, summarizeSuiteSetup } from "./suite-preflight-copy";

describe("friendlySuiteIssue", () => {
  it("names the target and explains how to recover from missing setup", () => {
    expect(
      friendlySuiteIssue(
        "No saved runtime profile for target browser:golden — capture a screen on this target first.",
        [{ id: "browser:golden", name: "Golden Chrome" }],
      ),
    ).toBe(
      "“Golden Chrome” has no saved screen capture to use for setup. Open this browser or device and capture a screen first, or choose another target in Where to run.",
    );
  });
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
    ).not.toBe("This browser needs a saved profile before it can run the plan.");
  });
});

it("groups repeated test configuration blockers and preserves independent failures", () => {
  expect(
    summarizeSuiteSetup([
      "Bind a runtime profile to Home.",
      "Bind a runtime profile to Settings.",
      "Device offline",
    ]),
  ).toEqual([
    "2 tests need a saved run configuration. Set up the selected browser or device, then recheck this plan.",
    "Device offline",
  ]);
});
