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

describe("Plan screenshot review filters", () => {
  it("keeps coverage counts and bulk-accepts only the visible selection", async () => {
    const reviewCaptures = vi.fn(async () => ({
      queue: {
        items: [],
        summary: {
          captured: 3,
          missing: 0,
          pending: 1,
          accepted: 2,
          issue: 0,
          needMoreEvidence: 0,
          planned: 3,
          blocked: 0,
        },
      },
      results: [],
    }));
    const host = await render(reviewCaptures);
    expect(host.textContent).toContain("3 planned · 3 captured");
    expect(host.textContent).toContain("3 pending");
    expect(host.textContent).toContain("Looks correct does not approve a visual baseline.");
    const itemChecks = [
      ...host.querySelectorAll('ul[aria-label="Screenshots for review"] input[type="checkbox"]'),
    ];
    expect(itemChecks).toHaveLength(3);
    for (const box of itemChecks) {
      await act(async () => {
        if (box instanceof HTMLInputElement) box.click();
      });
    }
    const screen = host.querySelector('select[aria-label="Filter by screen"]');
    if (!(screen instanceof HTMLSelectElement)) throw new Error("screen filter missing");
    await act(async () => {
      screen.value = "Settings";
      screen.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("3 planned · 3 captured");
    expect(host.textContent).not.toContain("Composer is empty");
    const bulk = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Looks correct for 2 selected"),
    );
    if (!(bulk instanceof HTMLButtonElement)) throw new Error("filtered bulk accept missing");
    await act(async () => bulk.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect(reviewCaptures).toHaveBeenCalledTimes(1);
    expect(reviewCaptures).toHaveBeenCalledWith("plan-1", {
      action: "accept",
      items: [
        {
          runId: "run-member-settings",
          captureId: "frames/001.png::aaa",
          imageSha256: "aaa",
        },
        {
          runId: "run-admin-settings",
          captureId: "frames/003.png::ccc",
          imageSha256: "ccc",
        },
      ],
    });
    expect(
      host.querySelector('ul[aria-label="Screenshots for review"] button')?.className,
    ).toContain("min-h-20");
  });

  it("shows blocked iOS Imagine as blocked, not missing, in freeze counts", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <PlanCaptureReviewSection
            batchId="plan-1"
            platform={platform()}
            runAcrossService={
              {
                getCaptureReview: async () => ({
                  items: [
                    item({
                      runId: "run-web-imagine",
                      caption: "Imagine",
                      captureId: "frames/imagine-web.png::web",
                      framePath: "frames/imagine-web.png",
                      imageSha256: "web",
                      checkpointId: "imagine",
                      account: "Member",
                      device: "Chrome",
                    }),
                    {
                      ...item({
                        runId: "run-ios-imagine",
                        caption: "Imagine",
                        captureId: "missing::imagine",
                        checkpointId: "imagine",
                      }),
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
                }),
              } as unknown as RunAcrossProductService
            }
          />
        </QueryClientProvider>,
      );
    });
    for (let index = 0; index < 4; index += 1) {
      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    }
    expect(host.textContent).toContain(
      "2 planned · 1 captured · 1 blocked · 0 missing · 1 pending · 0 accepted",
    );
    expect(host.textContent).not.toContain("Imagine Unbound");
    expect(host.textContent).toContain("Blocked");
    expect(host.textContent).not.toContain("2 tests passed");
    const checks = [
      ...host.querySelectorAll('ul[aria-label="Screenshots for review"] input[type="checkbox"]'),
    ];
    expect(checks).toHaveLength(1);
  });
});

async function settleReview() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe("Plan review acknowledgements", () => {
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
    await act(async () => button(host, "Retry loading screenshots").click());
    await settleReview();
    expect(host.textContent).toContain("No screenshots are available for this Plan.");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("clears only acknowledged selections and explains conflicts", async () => {
    const review = vi.fn(async () => ({
      queue: { items: [], summary: {} },
      results: [
        { runId: "run-member-settings", captureId: "frames/001.png::aaa", status: "applied" },
        { runId: "run-member-home", captureId: "frames/002.png::bbb", status: "conflict" },
      ],
    })) as unknown as NonNullable<RunAcrossProductService["reviewCaptures"]>;
    const host = await render(review);
    const checks = [...host.querySelectorAll<HTMLInputElement>('ul input[type="checkbox"]')];
    await act(async () => {
      checks[0]!.click();
      checks[1]!.click();
    });
    await act(async () => button(host, "Looks correct for 2 selected").click());
    await settleReview();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "1 of 2 review decisions saved",
    );
    expect(host.textContent).toContain("Home: The screenshot or its review changed");
    expect(checks[0]!.checked).toBe(false);
    expect(checks[1]!.checked).toBe(true);
  });

  it("retains selection after an unconfirmed save and exposes refresh", async () => {
    const host = await render(vi.fn().mockRejectedValue(new Error("Offline")));
    const check = host.querySelector<HTMLInputElement>('ul input[type="checkbox"]')!;
    await act(async () => check.click());
    await act(async () => button(host, "Looks correct").click());
    await settleReview();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Review could not be confirmed. Offline",
    );
    expect(check.checked).toBe(true);
    expect(button(host, "Refresh screenshots")).toBeTruthy();
  });

  it("keeps the inspected screenshot when streaming results reorder", async () => {
    const client = new QueryClient();
    const host = await render(undefined, undefined, client);
    await act(async () =>
      host
        .querySelectorAll<HTMLButtonElement>('ul[aria-label="Screenshots for review"] button')[1]!
        .click(),
    );
    expect(host.textContent).toContain("Look for: Composer is empty");
    const key = ["run-across", "batch", "plan-1", "capture-review"];
    const queue = client.getQueryData<{ items: PlanCaptureReviewItem[]; summary: unknown }>(key)!;
    await act(async () => {
      client.setQueryData(key, {
        ...queue,
        items: [queue.items[1], queue.items[2], queue.items[0]],
      });
    });
    await settleReview();
    const pressed = host.querySelector('ul button[aria-pressed="true"]');
    expect(pressed?.textContent).toContain("Home");
    expect(host.textContent).toContain("Look for: Composer is empty");
  });
});
