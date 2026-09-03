import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { JobInfo } from "../lib/api-types";
import type { CampaignRepairTarget } from "@relay/protocol";
import { CampaignCheckResults } from "./campaign-check-results";

test("renders partial campaign outcomes with exact evidence and no invented selective retry", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const openFrame = vi.fn();
  const job = {
    id: "job-1",
    action: "settings-tour",
    status: "error",
    queuedAt: 100,
    logs: [],
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 100,
        data: {
          id: "start",
          title: "Start",
          status: "passed",
          startedAt: 90,
          finishedAt: 100,
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 180,
        data: {
          id: "usage",
          title: "Usage",
          status: "failed",
          error: "Expected Usage, observed Settings",
          startedAt: 100,
          finishedAt: 180,
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 181,
        data: {
          id: "memory",
          title: "Memory",
          status: "blocked",
          dependencyReason: "Usage did not reach its mapped destination",
          startedAt: 180,
          finishedAt: 181,
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 182,
        data: {
          id: "licenses",
          title: "Open source licenses",
          status: "skipped",
          reason: "Representative viewport retained",
          startedAt: 181,
          finishedAt: 182,
        },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: 180,
        data: {
          checkId: "usage",
          error: "tap failed: control remained offscreen",
          chrome: { app: "Grok", header: "Settings" },
          screenIdentity: { fingerprint: "screen-123" },
          accessibility: { available: false, nodeCount: 0 },
          nodes: [],
          attempts: [
            {
              kind: "target-resolution-attempt",
              capturedAt: 160,
              data: {
                target: { ref: "@stale" },
                error: "control remained offscreen",
              },
            },
            {
              kind: "target-resolution",
              capturedAt: 170,
              data: {
                method: "label",
                target: { label: "Usage" },
                bounds: { x: 20, y: 80, width: 200, height: 44 },
                point: { x: 120, y: 102 },
              },
            },
          ],
        },
      },
    ],
    frames: [{ path: "failure.png", caption: "failed:usage", capturedAt: 180 }],
  } as JobInfo;

  const dispose = render(
    () => (
      <CampaignCheckResults
        job={job}
        frameSource={() => "data:image/png;base64,AA=="}
        onOpenFrame={openFrame}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("1 passed");
  expect(root.textContent).toContain("1 failed");
  expect(root.textContent).toContain("1 skipped");
  expect(root.textContent).toContain("1 blocked");
  expect(root.textContent).toContain("tap failed: control remained offscreen");
  expect(root.textContent).toContain("Usage did not reach its mapped destination");
  expect(root.textContent).toContain("Representative viewport retained");
  expect(root.textContent).toContain("Grok · Settings");
  expect(root.textContent).toContain("Accessibility tree unavailable · 0 nodes captured");
  expect(root.textContent).toContain("ref · Rejected · ref “@stale”");
  expect(root.textContent).toContain("control remained offscreen");
  expect(root.textContent).toContain("label · Used · label “Usage”");
  expect(root.textContent).toContain("Bounds x 20, y 80, 200 × 44 · Tap (120, 102)");
  expect(root.textContent).toContain(
    "Inspect the failure screenshot, manually locate the missing control, then repair its mapped locator.",
  );
  expect([...root.querySelectorAll("h4")].map((heading) => heading.textContent)).toEqual([
    "What Relay saw",
    "What Relay tried",
    "What happened",
    "Next step",
  ]);
  expect(root.querySelector('button[aria-label*="Retry"]')).toBeNull();
  expect(root.textContent?.toLocaleLowerCase()).not.toContain("retry");
  expect(root.querySelectorAll("summary")[0]?.getBoundingClientRect).toBeDefined();

  const screenshot = root.querySelector<HTMLButtonElement>(
    'button[aria-label="Open failure screenshot: failed:usage"]',
  );
  expect(screenshot?.tagName).toBe("BUTTON");
  screenshot?.focus();
  expect(document.activeElement).toBe(screenshot);
  screenshot?.click();
  expect(openFrame).toHaveBeenCalledWith(0);

  expect(root.textContent).toContain("Evidence details");
  expect(root.textContent).toContain('"checkId": "usage"');
  expect(root.querySelectorAll("summary").length).toBe(4);

  dispose();
  const retryCheck = vi.fn();
  const repairTest = vi.fn();
  const disposeActions = render(
    () => <CampaignCheckResults job={job} onRetryCheck={retryCheck} onRepairTest={repairTest} />,
    root,
  );
  const retry = root.querySelector<HTMLButtonElement>(
    'button[aria-label="Retry only failed check: Usage"]',
  );
  expect(retry?.textContent).toContain("Retry this check");
  expect(root.textContent).toContain("Default: continue and report");
  retry?.click();
  expect(retryCheck).toHaveBeenCalledWith("usage");
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Repair Test"))
    ?.click();
  expect(repairTest).toHaveBeenCalledWith("usage");
  disposeActions();
  root.remove();
});

test("renders one shared navigation edge from exact proof and circuit artifacts", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const reviewRepair = vi.fn();
  const dependency = {
    connectionId: "settings-usage",
    originScreenId: "settings",
    destination: { kind: "screen", screenId: "usage" },
  };
  const job = {
    id: "run-42",
    action: "settings-tour",
    status: "error",
    queuedAt: 100,
    persisted: true,
    logs: [],
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 110,
        data: {
          id: "usage",
          title: "Usage",
          status: "passed",
          transitionDependencies: [dependency],
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: 120,
        data: {
          id: "buy-more",
          title: "Buy more",
          status: "blocked",
          transitionDependencies: [dependency],
        },
      },
      {
        kind: "campaign-transition-proof",
        capturedAt: 115,
        data: {
          schemaVersion: 1,
          tokenId: "run-42:settings-usage",
          connectionId: "settings-usage",
          originScreenId: "settings",
          destination: { kind: "screen", screenId: "usage" },
          checkId: "usage",
          status: "verified",
          verifiedAt: 115,
        },
      },
      {
        kind: "campaign-transition-circuit",
        capturedAt: 125,
        data: {
          schemaVersion: 1,
          connectionId: "settings-usage",
          checkId: "usage",
          status: "open",
          reason: "Canonical confirmation no longer reaches Usage.",
          openedAt: 125,
        },
      },
    ],
  } as JobInfo;

  const dispose = render(
    () => <CampaignCheckResults job={job} onReviewNavigationRepair={reviewRepair} />,
    root,
  );

  expect(root.querySelectorAll('[aria-label="Navigation transition health"] > li')).toHaveLength(1);
  expect(root.textContent).toContain("settings → usage");
  expect(root.textContent).toContain("Last verified at usage · 2 dependents");
  expect(root.textContent).toContain("Blocked");
  expect(root.textContent).toContain("Canonical confirmation no longer reaches Usage.");
  const review = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Review repair",
  );
  review?.click();
  expect(reviewRepair).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId: "run.repair.get",
      fixedInput: { runId: "run-42", checkId: "usage" },
    }),
  );

  dispose();
  root.remove();
});

test("reviews evidence-backed repair branches without mutating the Test", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const load = vi.fn();
  const propose = vi.fn();
  const job = {
    id: "run-repair",
    action: "settings-tour",
    status: "error",
    queuedAt: 100,
    persisted: true,
    logs: [],
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: 120,
        data: { id: "privacy", title: "Privacy", status: "failed", error: "Old locator" },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: 120,
        data: {
          checkId: "privacy",
          error: "Old locator",
          screenIdentity: { fingerprint: "observed-privacy" },
          accessibility: { available: true, nodeCount: 12 },
          attempts: [],
        },
      },
    ],
    frames: [],
  } as JobInfo;
  const target = {
    schemaVersion: 1,
    id: "repair:run-repair:privacy",
    status: "pending",
    defaultAction: "continue-and-report",
    source: {
      runId: "run-repair",
      runInputDigest: "digest",
      checkId: "privacy",
      checkTitle: "Privacy",
      action: "settings-tour",
      capturedAt: 120,
      appMapId: "map",
      appMapRevision: 9,
      testId: "test",
    },
    expected: {},
    observed: { error: "Old locator" },
    evidence: { result: {}, frames: [] },
    lineage: { sourceRunId: "run-repair", priorAttempts: [] },
    actions: [
      {
        kind: "retarget-proposal",
        label: "Use proven selector",
        available: true,
        mutation: "reviewed-proposal",
        description: "Promote the selector that succeeded at runtime.",
        operationId: "run.repair.propose",
        fixedInput: { runId: "run-repair", checkId: "privacy", kind: "retarget" },
        requiredInput: ["reason"],
      },
      {
        kind: "accept-current-proposal",
        label: "Accept current via proposal",
        available: false,
        mutation: "reviewed-proposal",
        description: "Keep the observed identity.",
        operationId: "run.repair.propose",
        unavailableReason: "No semantic identity was preserved.",
      },
    ],
  } satisfies CampaignRepairTarget;

  const dispose = render(
    () => (
      <CampaignCheckResults
        job={job}
        repairTarget={target}
        onLoadRepairOptions={load}
        onProposeRepair={propose}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Choose a reversible repair");
  expect(root.textContent).toContain("The approved state keeps its inverse");
  const useSelector = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Use proven selector"),
  );
  const unavailable = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Accept current via proposal"),
  );
  expect(useSelector?.disabled).toBe(true);
  expect(unavailable?.disabled).toBe(true);
  root.querySelector<HTMLTextAreaElement>("textarea")!.value = "Privacy now has a stable id";
  root
    .querySelector<HTMLTextAreaElement>("textarea")!
    .dispatchEvent(new InputEvent("input", { bubbles: true }));
  await Promise.resolve();
  expect(useSelector?.disabled).toBe(false);
  useSelector?.click();
  expect(propose).toHaveBeenCalledWith(target.actions[0], "Privacy now has a stable id");

  dispose();
  root.remove();
});

test("renders a stopped cold-recovery intervention without a fake reset action", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const reviewRepair = vi.fn();
  const teachTransition = vi.fn();
  const openFrame = vi.fn();
  const recovery = {
    action: "review-cold-recovery",
    warmRecipeId: "confirm-settings",
    proposedColdRecipeId: "proposed-cold-settings",
    choices: ["fix-current-state", "teach-semantic-repair", "approve-cold-once", "defer"],
    implicitResumeAllowed: false,
  };
  const job = {
    id: "run-sos",
    action: "settings-tour",
    status: "error",
    queuedAt: 100,
    persisted: true,
    logs: [],
    artifacts: [
      {
        kind: "campaign-recovery-intervention",
        capturedAt: 200,
        data: {
          schemaVersion: 1,
          status: "intervention-required",
          checkId: "privacy",
          checkTitle: "Visit Privacy",
          transitionId: "settings-privacy",
          reason: "Warm confirmation could not reach Settings.",
          attemptedSelectors: [
            {
              kind: "target-resolution-attempt",
              capturedAt: 190,
              data: {
                target: { identifier: "settings_button", label: "Settings" },
                error: "Expected one target, found none.",
              },
            },
          ],
          recovery,
          chrome: { app: "Grok", header: "Home" },
          screenIdentity: { fingerprint: "home-fingerprint" },
          accessibility: { available: true, nodeCount: 42 },
          nodes: [{ text: "Home" }, { text: "Settings" }],
          screenshot: {
            caption: "sos:cold-recovery:settings-privacy",
            path: "sos.png",
            width: 1080,
            height: 2400,
          },
        },
      },
      {
        kind: "human-intervention-requested",
        capturedAt: 200,
        data: {
          reason: "review",
          message: "Cold recovery blocked for Visit Privacy.",
          resumeLabel: "Review recovery",
          interventionKind: "campaign-cold-recovery",
          checkId: "privacy",
          transitionId: "settings-privacy",
          recovery,
        },
      },
    ],
    frames: [
      {
        path: "sos.png",
        caption: "sos:cold-recovery:settings-privacy",
        capturedAt: 200,
      },
    ],
  } as JobInfo;

  const dispose = render(
    () => (
      <CampaignCheckResults
        job={job}
        frameSource={() => "data:image/png;base64,AA=="}
        onOpenFrame={openFrame}
        onReviewNavigationRepair={reviewRepair}
        onRepairTest={teachTransition}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Relay stopped before resetting this app.");
  expect(root.textContent).toContain("Cold recovery blocked for Visit Privacy.");
  expect(root.textContent).toContain("Visit Privacy · transition settings-privacy");
  expect(root.textContent).toContain("Grok · Home");
  expect(root.textContent).toContain("Available · 42 nodes");
  expect(root.textContent).toContain("Tree retained");
  expect(root.textContent).toContain("2 nodes");
  expect(root.textContent).toContain("1080 × 2400");
  expect(root.textContent).toContain("Proposed cold recovery · not run");
  expect(root.textContent).toContain("proposed-cold-settings");
  expect(root.textContent).toContain("Warm confirmation: confirm-settings");
  expect(root.textContent).toContain("Automatic resume is not allowed");
  expect(root.textContent).toContain("Approve one reset · Unavailable");
  expect(
    [...root.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Approve one reset"),
    ),
  ).toBe(false);

  const selectors = [...root.querySelectorAll("summary")].find((summary) =>
    summary.textContent?.includes("Attempted selectors"),
  );
  selectors?.click();
  expect(root.textContent).toContain("identifier “settings_button” · label “Settings”");
  expect(root.textContent).toContain("Expected one target, found none.");

  root
    .querySelector<HTMLButtonElement>(
      'button[aria-label="Open stopped-state screenshot: sos:cold-recovery:settings-privacy"]',
    )
    ?.click();
  expect(openFrame).toHaveBeenCalledWith(0);
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Review repair")
    ?.click();
  expect(reviewRepair).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId: "run.repair.get",
      fixedInput: { runId: "run-sos", checkId: "privacy" },
    }),
  );
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Teach transition")
    ?.click();
  expect(teachTransition).toHaveBeenCalledWith("privacy");
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === "Defer")
    ?.click();
  expect(root.textContent).toContain("Run unchanged · no reset approved · no automatic resume.");

  dispose();
  root.remove();
});
