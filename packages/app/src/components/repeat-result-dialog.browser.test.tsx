import { expect, test, vi } from "vitest";
import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JobInfo } from "../context/server";

const serverMock = vi.hoisted(() => ({
  frameUrlForPersisted: vi.fn(() => "/runs/baseline/frame.png"),
  runAction: vi.fn(),
}));
vi.mock("../context/server", () => ({ useServer: () => serverMock }));

import { RepeatResultDialog } from "./repeat-result-dialog";

function job(input: Partial<JobInfo> & Pick<JobInfo, "id">): JobInfo {
  return {
    action: "settings-localization",
    status: "ok",
    queuedAt: 100,
    logs: ["Captured Data Controls"],
    matrixCase: {
      kind: "combine",
      appMapId: "settings",
      testId: "settings-localization",
      world: "Português · Pixel 9",
      values: { language: "pt-BR", device: "pixel-9" },
    },
    targetProfile: {
      id: "pixel-9",
      targetId: "serial",
      source: "device",
      platform: "android",
      name: "Pixel 9",
      capabilities: [],
      observedAt: 1,
    },
    ...input,
  } as JobInfo;
}

test("selected Repeat result explains one checkpoint without losing the immutable Run", async () => {
  document.body.replaceChildren();
  const trigger = document.createElement("button");
  const root = document.createElement("div");
  document.body.append(trigger, root);
  trigger.focus();
  const current = job({ id: "current", batchId: "new", queuedAt: 100 });
  const approved = job({
    id: "approved",
    batchId: "old",
    queuedAt: 10,
    review: {
      schemaVersion: 1,
      status: "approved",
      capability: "visual-baseline",
      reason: "Approved checkpoint",
      requestedAt: 19,
      decidedAt: 20,
      decidedBy: { id: "human:reviewer", kind: "human" },
    },
    frames: [
      {
        path: "baseline.png",
        caption: "screen:Data Controls",
        capturedAt: 12,
        base64: "iVBORw0KGgo=",
        mime: "image/png",
      },
    ],
  });
  const [open, setOpen] = createSignal(true);
  const openRun = vi.fn();
  const dispose = render(
    () => (
      <Show when={open()}>
        <RepeatResultDialog
          row={{
            job: current,
            world: "Português · Pixel 9",
            values: [
              { name: "language", value: "Português" },
              { name: "device", value: "Pixel 9" },
            ],
            captures: [],
            missingCaptures: 0,
          }}
          capture={{
            index: 0,
            caption: "Data Controls",
            frame: {
              path: "current.png",
              caption: "screen:Data Controls",
              capturedAt: 101,
            },
          }}
          source="data:image/png;base64,iVBORw0KGgo="
          verdict="clipped"
          analysis={{
            baselineLabel: "English",
            findings: [
              {
                id: "clipped",
                code: "POSSIBLE_TEXT_CLIPPED",
                severity: "warning",
                confidence: "medium",
                canonicalKey: "data-controls",
                screenLabel: "Data Controls",
                locale: "pt-BR",
                baselineLocale: "en",
                observed: "Controles de dados",
                detail: "Text may be clipped",
              },
            ],
          }}
          history={[current, approved]}
          position={1}
          total={45}
          onOpenRun={openRun}
          onClose={() => setOpen(false)}
        />
      </Show>
    ),
    root,
  );
  await Promise.resolve();

  const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Checkpoint 1 of 45");
  expect(dialog.textContent).toContain("language: Português · device: Pixel 9");
  expect(dialog.textContent).toContain("previous approved matching result");
  expect(dialog.textContent).toContain("Deterministic decision");
  expect(dialog.textContent).toContain("Needs review");
  expect(dialog.textContent).toContain("Controles de dados");
  expect(dialog.textContent).toContain("current");
  expect(dialog.textContent).not.toMatch(/campaign|job|cell/iu);

  const fullReport = [...dialog.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Open full Run report"),
  );
  fullReport?.click();
  expect(openRun).toHaveBeenCalledOnce();

  const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close result review"]')!;
  close.click();
  await Promise.resolve();
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  dispose();
  document.body.replaceChildren();
});
