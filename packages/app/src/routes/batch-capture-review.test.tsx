/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanCaptureReviewItem } from "@relay/protocol";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import type { Platform } from "../platform/types";
import { PlanCaptureReviewSection } from "./batch-capture-review";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  sessionStorage.clear();
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

function platform(): Platform {
  return {
    platform: "web",
    getServerUrl: () => "http://127.0.0.1:8787",
    getServerConnection: () => ({
      url: "http://127.0.0.1:8787",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:qa",
      actorKind: "human",
    }),
    storage: { get: () => null, set: () => undefined, remove: () => undefined },
  };
}

function item(
  extras: Partial<PlanCaptureReviewItem> &
    Pick<PlanCaptureReviewItem, "runId" | "caption" | "captureId">,
): PlanCaptureReviewItem {
  return {
    status: "pending",
    framePath: "frames/001.png",
    imageSha256: "aaa",
    ...extras,
  };
}

async function render(
  reviewCaptures: RunAcrossProductService["reviewCaptures"],
  getCaptureReview?: RunAcrossProductService["getCaptureReview"],
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  onInspectProblems?: () => void,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PlanCaptureReviewSection
          batchId="plan-1"
          platform={platform()}
          onInspectProblems={onInspectProblems}
          runAcrossService={
            {
              getCaptureReview:
                getCaptureReview ??
                (async () => ({
                  items: [
                    item({
                      runId: "run-member-settings",
                      caption: "Settings",
                      captureId: "frames/001.png::aaa",
                      account: "Member",
                      device: "iPad",
                      lookFor: "Account section",
                    }),
                    item({
                      runId: "run-member-home",
                      caption: "Home",
                      captureId: "frames/002.png::bbb",
                      framePath: "frames/002.png",
                      imageSha256: "bbb",
                      account: "Member",
                      device: "iPad",
                      lookFor: "Composer is empty",
                    }),
                    item({
                      runId: "run-admin-settings",
                      caption: "Settings",
                      captureId: "frames/003.png::ccc",
                      framePath: "frames/003.png",
                      imageSha256: "ccc",
                      account: "Admin",
                      device: "Chrome",
                      lookFor: "Account section",
                    }),
                  ],
                  summary: {
                    captured: 3,
                    missing: 0,
                    pending: 3,
                    accepted: 0,
                    issue: 0,
                    needMoreEvidence: 0,
                    planned: 3,
                    blocked: 0,
                  },
                })),
              reviewCaptures,
            } as unknown as RunAcrossProductService
          }
        />
      </QueryClientProvider>,
    );
  });
  for (let index = 0; index < 4; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
  return host;
}

describe("Plan screenshot review", () => {
  it("opens the first unreviewed screenshot when the remembered one is gone", async () => {
    sessionStorage.setItem(
      "relay.plan-review.plan-1",
      JSON.stringify({ selectedKey: "removed-capture" }),
    );
    const host = await render(undefined);
    expect(dialogTitle()).toBeUndefined();
    await act(async () => button(host, "Start reviewing").click());
    expect(dialogTitle()).toBe("Settings");
  });

  it("explains missing captures and opens the affected case", async () => {
    const inspect = vi.fn();
    const host = await render(
      undefined,
      async () => ({
        items: [
          item({
            runId: "run-1",
            caption: "Settings",
            captureId: "missing-settings",
            framePath: undefined,
            status: "missing",
            executionCaseId: "case-1",
          }),
        ],
        summary: {
          planned: 1,
          captured: 0,
          missing: 1,
          blocked: 0,
          pending: 0,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
        },
      }),
      undefined,
      inspect,
    );
    expect(host.textContent).toContain("1 screenshot wasn’t captured");
    await act(async () => button(host, "See what went wrong").click());
    expect(inspect).toHaveBeenCalledExactlyOnceWith("case-1");
  });

  it("shows review progress and accepts one step across configurations", async () => {
    const reviewCaptures = vi.fn(async () => ({ results: [] }));
    const host = await render(reviewCaptures);
    expect(host.textContent).toContain("0 of 3 reviewed");
    expect(host.textContent).not.toContain("Use as baseline");
    expect(groupLabels(host)).toEqual(["Settings2", "Home1"]);
    expect(
      host.querySelectorAll('[aria-label="Settings screenshots"] [role="checkbox"]'),
    ).toHaveLength(2);
    await act(async () => button(host, "Mark 2 as correct").click());
    await settleReview();
    expect(reviewCaptures).toHaveBeenCalledExactlyOnceWith("plan-1", {
      action: "accept",
      items: [
        { runId: "run-member-settings", captureId: "frames/001.png::aaa", imageSha256: "aaa" },
        { runId: "run-admin-settings", captureId: "frames/003.png::ccc", imageSha256: "ccc" },
      ],
    });
  });

  it("groups by configuration and shows an empty issues view", async () => {
    const host = await render(vi.fn(async () => ({ results: [] })));
    await chooseOption(host, "Group screenshots", "Group by device and account");
    expect(groupLabels(host)).toEqual(["iPad · Member2", "Chrome · Admin1"]);
    await act(async () => tab(host, "Issues").click());
    expect(host.textContent).toContain("No issues reported.");
    expect(host.textContent).toContain("0 of 3 reviewed");
  });

  it("keeps issues and evidence gaps visible in the progress summary", async () => {
    const host = await render(vi.fn(), async () => ({
      items: [],
      summary: {
        captured: 27,
        missing: 2,
        pending: 5,
        accepted: 20,
        issue: 2,
        needMoreEvidence: 3,
        planned: 30,
        blocked: 1,
      },
    }));
    expect(host.textContent).toContain("22 of 27 reviewed");
    expect(host.textContent).toContain("2 with issues");
    expect(host.textContent).toContain("3 screenshots weren’t captured");
  });

  it("never offers a blocked capture for approval", async () => {
    const host = await render(vi.fn(), async () => ({
      items: [
        item({
          runId: "run-web-imagine",
          caption: "Imagine",
          captureId: "frames/imagine-web.png::web",
          framePath: "frames/imagine-web.png",
          imageSha256: "web",
          account: "Member",
          device: "Chrome",
        }),
        {
          ...item({ runId: "run-ios-imagine", caption: "Imagine", captureId: "missing::imagine" }),
          status: "missing" as const,
          framePath: undefined,
          imageSha256: undefined,
          blocked: true,
          configuration: { app: "ai.x.GrokApp" },
        },
      ],
      summary: {
        captured: 1,
        missing: 0,
        pending: 1,
        accepted: 0,
        issue: 0,
        needMoreEvidence: 0,
        planned: 2,
        blocked: 1,
      },
    }));
    expect(host.textContent).toContain("0 of 1 reviewed");
    expect(host.textContent).toContain("1 screenshot wasn’t captured");
    await act(async () => tab(host, "All").click());
    expect(host.textContent).toContain("Couldn’t capture");
    expect(host.querySelectorAll('ul [role="checkbox"]')).toHaveLength(1);
  });

  it("keeps the open screenshot when a newer capture arrives", async () => {
    const client = new QueryClient();
    const host = await render(undefined, undefined, client);
    await act(async () => openCard(host, "Open Home"));
    expect(dialogTitle()).toBe("Home");
    const key = ["run-across", "batch", "plan-1", "capture-review"];
    const queue = client.getQueryData<{ items: PlanCaptureReviewItem[]; summary: unknown }>(key)!;
    await act(async () =>
      client.setQueryData(key, {
        ...queue,
        items: [
          item({ runId: "run-new", caption: "Newest", captureId: "frames/009.png::zzz" }),
          ...queue.items.reverse(),
        ],
      }),
    );
    await settleReview();
    expect(dialogTitle()).toBe("Home");
    expect(document.body.textContent).toContain("Composer is empty");
  });

  it("remembers the review focus and grouping", async () => {
    let host = await render(vi.fn(async () => ({ results: [] })));
    await act(async () => tab(host, "Issues").click());
    await chooseOption(host, "Group screenshots", "Group by device and account");
    act(() => roots.splice(0).forEach((root) => root.unmount()));
    document.body.replaceChildren();
    host = await render(vi.fn(async () => ({ results: [] })));
    expect(tab(host, "Issues").getAttribute("aria-selected")).toBe("true");
    expect(
      host.querySelector('[role="combobox"][aria-label="Group screenshots"]')?.textContent,
    ).toContain("Group by device and account");
  });

  it("advances to the next unreviewed screenshot after a decision", async () => {
    const save = vi.fn(
      async (_batch: string, input: { items: Array<{ runId: string; captureId: string }> }) => ({
        results: input.items.map((entry) => ({ ...entry, status: "applied" })),
      }),
    );
    const host = await render(save as unknown as RunAcrossProductService["reviewCaptures"]);
    await act(async () => button(host, "Start reviewing").click());
    expect(dialogTitle()).toBe("Settings");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    await settleReview();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1].items[0]?.runId).toBe("run-member-settings");
  });
});

function dialogTitle() {
  return document.querySelector('[role="dialog"] h2')?.textContent ?? undefined;
}

function groupLabels(host: HTMLElement) {
  return [...host.querySelectorAll("section[aria-label] h3")].map((node) => node.textContent);
}

function openCard(host: HTMLElement, label: string) {
  const card = [...host.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find((node) =>
    node.getAttribute("aria-label")?.startsWith(label),
  );
  if (!card) throw new Error(`Missing card: ${label}`);
  card.click();
}

function tab(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((node) =>
    node.textContent?.startsWith(label),
  );
  if (!found) throw new Error(`Missing tab: ${label}`);
  return found;
}

async function chooseOption(host: HTMLElement, field: string, label: string) {
  const select = host.querySelector<HTMLElement>(`[role="combobox"][aria-label="${field}"]`);
  if (!select) throw new Error(`Missing field: ${field}`);
  await act(async () => select.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (node) => node.textContent === label,
  );
  if (!option) throw new Error(`Missing option: ${label}`);
  await act(async () => option.click());
}

async function settleReview() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

function button(host: ParentNode, label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.replace(/\s+/g, " ").trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function checkboxes(host: HTMLElement) {
  return [...host.querySelectorAll<HTMLElement>('ul [role="checkbox"]')];
}

describe("Plan review acknowledgements", () => {
  it("bulk-reviews the current selection without silently including later screenshots", async () => {
    const client = new QueryClient();
    const save = vi.fn(async (_batch: string, _input: { items: unknown[] }) => ({ results: [] }));
    const host = await render(
      save as unknown as RunAcrossProductService["reviewCaptures"],
      undefined,
      client,
    );
    for (const box of checkboxes(host)) await act(async () => box.click());
    const key = ["run-across", "batch", "plan-1", "capture-review"];
    const queue = client.getQueryData<{ items: PlanCaptureReviewItem[]; summary: unknown }>(key)!;
    await act(async () =>
      client.setQueryData(key, {
        ...queue,
        items: [
          ...queue.items,
          item({ runId: "later-run", captureId: "later", caption: "Later arrival" }),
        ],
      }),
    );
    await settleReview();
    expect(checkboxes(host).map((box) => box.getAttribute("aria-checked") === "true")).toEqual([
      true,
      true,
      true,
      false,
    ]);
    await act(async () => button(host, "Looks correct for 3 selected").click());
    expect(save.mock.calls[0]?.[1].items).toHaveLength(3);
    expect(JSON.stringify(save.mock.calls)).not.toContain("later-run");
  });

  it("bulk Report issue asks for a note before saving", async () => {
    const save = vi.fn(async () => ({ results: [] }));
    const host = await render(save as unknown as RunAcrossProductService["reviewCaptures"]);
    for (const box of checkboxes(host)) await act(async () => box.click());
    await act(async () => button(host, "Report issue for 3 selected").click());
    expect(save).not.toHaveBeenCalled();
    await act(async () => button(host, "Save issue for 3 selected").click());
    expect(save).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        action: "report-issue",
        items: expect.arrayContaining([expect.objectContaining({ runId: "run-member-settings" })]),
      }),
    );
    expect(host.querySelector('[aria-label="More review options"]')).not.toBeNull();
  });

  it("shows a load error and allows retry instead of hiding the queue", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValue({
        items: [],
        summary: {
          planned: 0,
          captured: 0,
          missing: 0,
          pending: 0,
          accepted: 0,
          issue: 0,
          needMoreEvidence: 0,
          blocked: 0,
        },
      });
    const host = await render(undefined, get);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
    await act(async () => button(host, "Try again").click());
    await settleReview();
    expect(host.textContent).toContain("This Plan didn’t capture any screenshots.");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("clears only acknowledged selections and explains conflicts", async () => {
    const review = vi.fn(async () => ({
      results: [
        { runId: "run-member-settings", captureId: "frames/001.png::aaa", status: "applied" },
        { runId: "run-admin-settings", captureId: "frames/003.png::ccc", status: "conflict" },
      ],
    })) as unknown as NonNullable<RunAcrossProductService["reviewCaptures"]>;
    const host = await render(review);
    const [first, second] = checkboxes(host);
    await act(async () => first!.click());
    await act(async () => second!.click());
    await act(async () => button(host, "Looks correct for 2 selected").click());
    await settleReview();
    const alert = host.querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain("1 of 2 decisions weren’t saved");
    expect(alert).toContain("Someone else reviewed these screenshots first");
    expect(alert).toContain("Settings: The screenshot or its review changed");
    expect(first!.getAttribute("aria-checked") === "true").toBe(false);
    expect(second!.getAttribute("aria-checked") === "true").toBe(true);
  });

  it("retains selection after an unconfirmed save and exposes refresh", async () => {
    const host = await render(vi.fn().mockRejectedValue(new Error("Offline")));
    const check = checkboxes(host)[0]!;
    await act(async () => check.click());
    await act(async () => button(host, "Looks correct for 1 selected").click());
    await settleReview();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Your decision wasn’t saved.",
    );
    expect(check.getAttribute("aria-checked") === "true").toBe(true);
    expect(button(host, "Refresh screenshots")).toBeTruthy();
  });

  it("refreshes the final capture queue when the Plan stops running", async () => {
    const missing = {
      items: [{ status: "missing", captureId: "missing::last", caption: "Last image" }],
      summary: { captured: 0, missing: 1, pending: 0, planned: 1, blocked: 0 },
    };
    const complete = {
      items: [item({ runId: "last-run", captureId: "last", caption: "Last image" })],
      summary: { captured: 1, missing: 0, pending: 1, planned: 1, blocked: 0 },
    };
    const getCaptureReview = vi.fn().mockResolvedValueOnce(missing).mockResolvedValue(complete);
    const service = { getCaptureReview } as unknown as RunAcrossProductService;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const draw = (streaming: boolean) =>
      root.render(
        <QueryClientProvider client={client}>
          <PlanCaptureReviewSection
            batchId="final-captures"
            platform={platform()}
            runAcrossService={service}
            streaming={streaming}
          />
        </QueryClientProvider>,
      );
    await act(async () => draw(true));
    await settleReview();
    expect(getCaptureReview).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Waiting for the first screenshots");
    await act(async () => draw(false));
    await settleReview();
    expect(getCaptureReview).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("0 of 1 reviewed");
    expect(host.textContent).not.toContain("wasn’t captured");
  });
});
