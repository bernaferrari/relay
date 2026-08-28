import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { JobInfo } from "../context/server";
import { projectCombineReview } from "../lib/combine-review";

const serverMock = vi.hoisted(() => ({
  combineEvidence: { analyze: vi.fn(async () => null) },
  frameUrlForPersisted: vi.fn(() => ""),
}));
vi.mock("../context/server", () => ({ useServer: () => serverMock }));

import { CombineReview } from "./combine-review";

function repeatRun(index: number): JobInfo {
  return {
    id: `run-${index}`,
    action: "settings-localization",
    status: "ok",
    queuedAt: index,
    logs: [],
    batchId: "repeat-1",
    caseIndex: index,
    caseCount: 13,
    matrixCase: {
      kind: "combine",
      world: `Language ${index}`,
      values: { language: `Language ${index}` },
      expectedScreenshots: 1,
    },
    frames: [
      {
        path: `data-controls-${index}.png`,
        caption: "screen:Data Controls",
        capturedAt: index,
        base64: "iVBORw0KGgo=",
        mime: "image/png",
      },
    ],
  } as JobInfo;
}

test("Repeat results lead with checkpoints and announce bounded paging", async () => {
  const runs = Array.from({ length: 13 }, (_, index) => repeatRun(index + 1));
  const review = projectCombineReview(runs)!;
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <CombineReview
        review={review}
        history={runs}
        onOpen={() => undefined}
        onRetryProblems={() => undefined}
        onExport={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );
  await Promise.resolve();

  expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Repeat results");
  expect(
    root.querySelector<HTMLSelectElement>('select[aria-label="Checkpoint to review"]'),
  ).toBeTruthy();
  expect(
    root
      .querySelector<HTMLInputElement>('input[placeholder="Filter Repeat values"]')
      ?.closest("label")?.textContent,
  ).toContain("Filter Repeat values");
  expect(root.textContent).toContain("Showing 12 of 13 results");
  expect(root.textContent).not.toMatch(/Combine results|campaign|job|cell/iu);
  const more = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Show 1 more"),
  );
  more?.click();
  await Promise.resolve();
  expect(root.querySelectorAll("[data-locale-cell]")).toHaveLength(13);

  dispose();
  root.remove();
});
