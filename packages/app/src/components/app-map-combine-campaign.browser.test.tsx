import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { CombineCampaign } from "@relay/protocol";
import { AppMapCombineCampaign } from "./app-map-combine-campaign";

function campaign(status: CombineCampaign["status"]): CombineCampaign {
  return {
    schemaVersion: 1,
    id: "campaign-1",
    projectId: "project-1",
    ownerId: "human:local",
    appMapId: "settings",
    combineId: "forty-locales",
    sourceRevision: 10,
    latestRevision: 12,
    target: { kind: "device", id: "android-1", platform: "android" },
    status,
    createdAt: 10,
    updatedAt: 20,
    cases: [
      {
        index: 0,
        world: "English",
        values: { language: "en" },
        phase: "pilot",
        status: status === "needs-review" ? "failed" : "passed",
        jobId: "pilot-job",
      },
      {
        index: 1,
        world: "Italian",
        values: { language: "it" },
        phase: "coverage",
        status: "pending",
      },
    ],
    lineage: [{ kind: "created", at: 10, appMapRevision: 10, actorId: "human:local" }],
  };
}

test("keeps untouched campaign cases behind an explicit pilot review boundary", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const resume = vi.fn();
  const reviewed = vi.fn();
  const dispose = render(
    () => (
      <AppMapCombineCampaign
        campaign={campaign("needs-review")}
        reviewed={false}
        busy={false}
        onReviewed={reviewed}
        onOpenPilot={vi.fn()}
        onResume={resume}
        onCancel={vi.fn()}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Pilot needs review");
  expect(root.textContent).toContain("1 untouched");
  const resumeButton = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Resume untouched"),
  );
  expect(resumeButton?.disabled).toBe(true);
  root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
  expect(reviewed).toHaveBeenCalledWith(true);
  expect(resume).not.toHaveBeenCalled();

  dispose();
  root.remove();
});
