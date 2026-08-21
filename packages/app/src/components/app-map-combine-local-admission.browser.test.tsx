import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import { MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS } from "@relay/protocol";
import { AppMapCombineLocalAdmission } from "./app-map-combine-local-admission";

test("local admission makes evidence and read-only capacity state visible", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const refresh = vi.fn();
  const check = vi.fn();
  const dispose = render(
    () => (
      <AppMapCombineLocalAdmission
        bindingCount={1}
        cohortCount={1}
        cellCount={2}
        draft={{ deadlineMinutes: "3", setupHeadroomMinutes: "", recoveryHeadroomMinutes: "" }}
        evidence={[
          {
            schemaVersion: 1,
            cohort: {
              targetId: "pixel-1",
              platform: "android",
              testId: "settings",
              action: "app-map:settings:test:settings",
            },
            duration: {
              workItemDurationMs: 12_000,
              provenance: "observed-p95",
              observedAt: 100,
              sampleCount: 5,
              maxAgeMs: MAX_CAMPAIGN_DURATION_EVIDENCE_AGE_MS,
            },
            measurement: {
              estimator: "campaign-duration-estimate",
              recordSource: "persisted-runs",
              durationSource: "run-wall-clock",
              sampleIds: ["1", "2", "3", "4", "5"],
              observationWindow: { startedAt: 1, finishedAt: 100 },
            },
          },
        ]}
        onDraftChange={() => undefined}
        onRefreshEvidence={refresh}
        onPreflight={check}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Local deadline admission");
  expect(root.textContent).toContain("Provider/cloud capacity is not configured");
  expect(root.textContent).toContain("pixel-1");
  expect(
    root.querySelector<HTMLInputElement>("input[aria-label='Deadline in minutes']")?.value,
  ).toBe("3");
  expect(root.querySelector<HTMLInputElement>("input[aria-label='Deadline in minutes']")?.min).toBe(
    "1",
  );
  const buttons = Array.from(root.querySelectorAll("button"));
  buttons.find((button) => button.textContent?.includes("Refresh timings"))?.click();
  buttons.find((button) => button.textContent?.includes("Check local capacity"))?.click();
  expect(refresh).toHaveBeenCalledOnce();
  expect(check).toHaveBeenCalledOnce();
  dispose();
  root.remove();
});
