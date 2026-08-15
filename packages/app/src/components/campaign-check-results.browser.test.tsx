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
        data: { checkId: "usage", nodes: [{ text: "Settings" }] },
      },
    ],
    frames: [{ path: "failure.png", caption: "failed:Usage", capturedAt: 180 }],
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
  expect(root.textContent).toContain("Expected Usage, observed Settings");
  expect(root.textContent).toContain("Usage did not reach its mapped destination");
  expect(root.textContent).toContain("Representative viewport retained");
  expect(root.querySelector('button[aria-label*="Retry"]')).toBeNull();
  expect(root.querySelectorAll("summary")[0]?.getBoundingClientRect).toBeDefined();

  const screenshot = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("failed:Usage"),
  );
  screenshot?.click();
  expect(openFrame).toHaveBeenCalledWith(0);

  const evidence = [...root.querySelectorAll("summary")].find((summary) =>
    summary.textContent?.includes("Structured evidence"),
  );
  evidence?.click();
  expect(root.textContent).toContain('"checkId": "usage"');

  dispose();
  root.remove();
});
