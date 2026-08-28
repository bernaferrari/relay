import { expect, test, vi } from "vitest";
import { Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { JobInfo } from "../context/server";

const serverMock = vi.hoisted(() => ({
  frameUrlForPersisted: vi.fn(() => "/runs/baseline/frame.png"),
  runAction: vi.fn(),
  reviewRun: vi.fn(),
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

test("pending checkpoint decisions stay scoped to one Run and never update a baseline", async () => {
  document.body.replaceChildren();
  serverMock.reviewRun.mockImplementation(
    async (_runId: string, action: "approve" | "reject" | "defer", note?: string) => ({
      schemaVersion: 1,
      status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending",
      capability: "localization-checkpoint",
      reason: "A person must review this localized checkpoint.",
      requestedAt: 20,
      ...(action === "defer"
        ? { requestedBy: { id: "human:reviewer", kind: "human" as const } }
        : {
            decidedAt: 21,
            decidedBy: { id: "human:reviewer", kind: "human" as const },
          }),
      ...(note ? { note } : {}),
    }),
  );
  const root = document.createElement("div");
  document.body.append(root);
  const current = job({
    id: "pending-review",
    batchId: "new",
    persisted: true,
    outcome: "uncertain",
    review: {
      schemaVersion: 1,
      status: "pending",
      capability: "localization-checkpoint",
      reason: "A person must review this localized checkpoint.",
      requestedAt: 10,
    },
  });
  const dispose = render(
    () => (
      <RepeatResultDialog
        row={{
          job: current,
          world: "Português · Pixel 9",
          values: [{ name: "language", value: "Português" }],
          captures: [],
          missingCaptures: 0,
        }}
        capture={{
          index: 0,
          caption: "Data Controls",
          frame: { path: "current.png", caption: "screen:Data Controls", capturedAt: 101 },
        }}
        source="data:image/png;base64,iVBORw0KGgo="
        verdict="clipped"
        history={[current]}
        position={1}
        total={1}
        onOpenRun={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );
  await Promise.resolve();

  const decision = root.querySelector<HTMLElement>("[data-repeat-result-decision]")!;
  expect(root.textContent).toContain("Evidence completeness");
  expect(root.textContent).toContain("partial");
  expect(decision.textContent).toContain("Approve result");
  expect(decision.textContent).toContain("Reject result");
  expect(decision.textContent).toContain("Request review");
  expect(decision.textContent).toContain("does not replace the approved screenshot");
  const note = decision.querySelector<HTMLTextAreaElement>("textarea")!;
  note.value = "Please ask the localization owner.";
  note.dispatchEvent(new InputEvent("input", { bubbles: true }));
  const requestReview = [...decision.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Request review"),
  )!;
  requestReview.click();
  await Promise.resolve();
  expect(serverMock.reviewRun).toHaveBeenCalledWith(
    "pending-review",
    "defer",
    "Please ask the localization owner.",
  );
  expect(decision.textContent).toContain("Needs review");

  const approve = [...decision.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Approve result"),
  )!;
  approve.click();
  await Promise.resolve();
  expect(serverMock.reviewRun).toHaveBeenLastCalledWith("pending-review", "approve", "");
  expect(decision.textContent).toContain("Approved");
  expect(decision.textContent).not.toContain("Approve result");
  expect(serverMock.runAction).not.toHaveBeenCalledWith(
    "run.visual-baseline.update",
    expect.anything(),
  );

  dispose();
  document.body.replaceChildren();
});
