import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { JobInfo } from "../lib/api-types";
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

  const evidence = [...root.querySelectorAll("summary")].find((summary) =>
    summary.textContent?.includes("Raw evidence"),
  );
  const rawEvidence = evidence?.closest("details");
  expect(rawEvidence?.open).toBe(false);
  evidence?.focus();
  expect(document.activeElement).toBe(evidence);
  evidence?.click();
  expect(rawEvidence?.open).toBe(true);
  expect(root.textContent).toContain('"checkId": "usage"');
  expect(root.querySelectorAll("summary").length).toBe(5);

  dispose();
  root.remove();
});
