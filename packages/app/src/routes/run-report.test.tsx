/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ProductRunReportOverview } from "../data/run-report-model";
import type { RunProductService } from "../data/run-product-service";
import { RunReport } from "./run-report";

const route = vi.hoisted(() => ({ search: {} as { reportView?: string } }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useRouteContext: () => ({ queryClient: {} }),
  useNavigate: () => navigate,
  useLocation: ({ select }: { select?: (value: unknown) => unknown } = {}) => {
    const value = { search: route.search, pathname: "/runs/layout" };
    return select ? select(value) : value;
  },
}));
vi.mock("../components/test-workspace", () => ({
  TestWorkspaceHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("./run-test-link", () => ({ RunTestLink: () => null }));
vi.mock("./run-report-actions", () => ({ RunReportActions: () => null }));
vi.mock("./run-report-panels", () => ({ EvidencePreview: () => null }));
vi.mock("../components/issue-draft-button", () => ({ IssueDraftButton: () => null }));
vi.mock("./run-replay", () => ({
  RunReplayStatus: () => <p role="status">Replay recovery notice</p>,
}));
// Keep real RunReport/SavedRunStory/RunStoryFailure composition. The visual
// workbenches are outside this notice and failure-action behavior.
vi.mock("./run-story", () => ({
  RunStoryView: ({ header, notice }: { header: ReactNode; notice: ReactNode }) => (
    <section>
      {header}
      {notice}
    </section>
  ),
}));
vi.mock("./run-workbench", () => ({
  RunWorkbench: ({ failureNotice }: { failureNotice: ReactNode }) => (
    <section>{failureNotice}</section>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let client: QueryClient | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client?.clear();
  client = undefined;
  route.search = {};
  navigate.mockClear();
  document.body.replaceChildren();
});

const error =
  "layout assertion: identifier team-seats overlaps identifier save-settings by 44×44 px";
function report(): ProductRunReportOverview {
  return {
    runId: "layout",
    title: "Settings layout",
    outcome: "product-failure",
    cause: "Relay could not complete this Test with the saved recording.",
    technicalCause: `1 campaign check failed: Check settings: ${error}`,
    timeline: [
      {
        id: "layout-trace",
        index: 8,
        title: "Check Team seats and Save do not overlap",
        state: "failed",
        evidenceCount: 1,
        failure: {
          kind: "layout-overlap",
          cause: error,
          summary: "Team seats and Save overlap.",
          technicalDetail: `Check layout: identifier team-seats does not overlap identifier save-settings\n${error}`,
        },
      },
    ],
    evidence: [],
    evidenceUnavailable: true,
  };
}
async function render(value: ProductRunReportOverview) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient();
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client!}>
        <RunReport report={value} runService={{} as RunProductService} />
      </QueryClientProvider>,
    ),
  );
  return container;
}

it("shows exact failed-trace technical detail once while preserving unrelated notices", async () => {
  const container = await render(report());
  expect(container.querySelectorAll("summary")).toHaveLength(1);
  expect(container.querySelector("summary")?.textContent).toBe("Technical details");
  expect(container.querySelector('button[aria-label="Technical details"]')).toBeNull();
  expect(container.querySelector("pre")?.textContent).toContain(error);
  expect(container.textContent).toContain("Team seats and Save overlap.");
  expect(container.textContent).toContain("Replay recovery notice");
  expect(container.textContent).toContain("Evidence details are temporarily unavailable");
});

it.each([
  { technicalCause: "Another selector failed" },
  { technicalCause: undefined },
  { technicalCause: `2 campaign check failed: Check settings: ${error}` },
  { outcome: "harness-failure" as const },
  { timeline: [{ ...report().timeline[0]!, failure: undefined }] },
  {
    timeline: [
      {
        id: "earlier",
        index: 0,
        title: "Tap Settings",
        state: "failed" as const,
        evidenceCount: 0,
      },
      ...report().timeline,
    ],
  },
])(
  "retains the generic notice when the story does not account for the Run cause: %o",
  async (override) => {
    const container = await render({ ...report(), ...override });
    expect(container.querySelector('button[aria-label="Technical details"]')).not.toBeNull();
  },
);

it("keeps Run-level technical details available outside the story", async () => {
  route.search = { reportView: "steps" };
  const container = await render(report());
  expect(container.querySelector('button[aria-label="Technical details"]')).not.toBeNull();
});

it("shows persisted account context without inferring it from the test title", async () => {
  const value = {
    ...report(),
    outcome: "passed" as const,
    executionContext: { browser: "chromium", account: "Member" },
  };
  const container = await render(value);
  expect(container.querySelector('[aria-label="Recorded run context"]')?.textContent).toBe(
    "chromium · Account: Member",
  );
  await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  const missing = await render({
    ...value,
    title: "Admin test",
    executionContext: { browser: "chromium" },
  });
  expect(missing.querySelector('[aria-label="Recorded run context"]')?.textContent).toBe(
    "chromium · Account not recorded",
  );
});

it.each([
  ["passed", "pending", "Passed", "1 screenshot needs review"],
  ["passed", "issue", "Screenshot issues", "1 screenshot issue"],
  ["product-failure", "issue", "Failed", "1 screenshot issue"],
] as const)(
  "distinguishes %s execution from %s screenshot review",
  async (outcome, status, label, action) => {
    const container = await render({
      ...report(),
      outcome,
      captureReview: {
        items: [{ captureId: "capture", caption: "Settings", status }],
        summary: {
          captured: 1,
          missing: 0,
          pending: status === "pending" ? 1 : 0,
          accepted: 0,
          issue: status === "issue" ? 1 : 0,
          needMoreEvidence: 0,
        },
      },
    });
    expect(container.querySelector('[data-slot="status-pill"]')?.textContent).toBe(label);
    const review = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === action,
    )!;
    await act(async () => review.click());
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/runs/$runId", params: { runId: "layout" } }),
    );
    expect(navigate.mock.calls[0]![0].search({})).toEqual({ reportView: "captures" });
  },
);
