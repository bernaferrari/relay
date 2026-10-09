import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { projectProductRuns } from "@relay/product/catalog";
import type { RunSummary } from "@relay/protocol";
import { PlanChecklist } from "./plan-checklist";

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => context.value,
  Link: ({
    to,
    params,
    search: _search,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: unknown;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (url, [key, value]) => url.replace(`$${key}`, value),
        to,
      )}
      {...props}
    />
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
const run = (patch: Partial<RunSummary>): RunSummary => ({
  id: "run",
  action: "test.run",
  status: "ok",
  queuedAt: 1,
  frameCount: 0,
  writtenAt: 1,
  artifactCount: 0,
  artifactBytes: 0,
  storageBytes: 0,
  pinned: false,
  retentionClass: "standard",
  ...patch,
});
const matrixCase = {
  kind: "combine" as const,
  appMapId: "grok",
  testId: "speed",
  combineId: "prompts",
  world: "one",
  values: { prompts: "value-1" },
};
async function render(runs: RunSummary[] | (() => Promise<RunSummary[]>)) {
  const listRuns = vi.fn(async () =>
    projectProductRuns(typeof runs === "function" ? await runs() : runs),
  );
  context.value = { catalogService: { listRuns } };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <PlanChecklist
          appId="grok"
          suiteId="prompts"
          tests={[{ id: "speed", name: "Speed images", status: "ready" }]}
        />
      </QueryClientProvider>,
    ),
  );
  return listRuns;
}
async function settled() {
  await act(async () => {
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Loading results"));
  });
}
it("unrelated failed runs do not become results of a new plan", async () => {
  const listRuns = await render([
    run({ id: "standalone", action: "app-map:grok:test:speed:run", status: "error", queuedAt: 3 }),
    run({
      id: "other-plan",
      matrixCase: { ...matrixCase, combineId: "navigation" },
      status: "error",
      queuedAt: 4,
    }),
    run({
      id: "other-app",
      matrixCase: { ...matrixCase, appMapId: "other" },
      status: "error",
      queuedAt: 5,
    }),
    run({
      id: "legacy",
      matrixCase: { ...matrixCase, combineId: undefined },
      title: "prompts",
      status: "error",
      queuedAt: 6,
    }),
  ]);
  await settled();
  expect(document.body.textContent).toContain("Latest plan runs");
  expect(document.body.textContent).toContain("No plan runs found");
  expect(document.body.textContent).not.toContain("not run");
  expect(document.body.textContent).not.toContain("failed");
  expect(document.querySelector('a[href^="/runs/"]')).toBeNull();
  expect(listRuns).toHaveBeenCalledWith({ appMapId: "grok" });
});
it("only an exactly attributed plan run supplies result state and its evidence link", async () => {
  await render([
    run({ id: "own-plan", matrixCase, status: "ok", outcome: "passed", queuedAt: 2 }),
    run({
      id: "newer-standalone",
      action: "app-map:grok:test:speed:run",
      status: "error",
      queuedAt: 9,
    }),
  ]);
  await settled();
  expect(document.body.textContent).toContain("1 passed");
  expect(document.body.textContent).not.toContain("failed");
  expect(document.querySelector('a[href="/runs/own-plan"]')).not.toBeNull();
});

it("loading and failed history never claim that the plan has not run", async () => {
  let finish!: (runs: RunSummary[]) => void;
  await render(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(document.body.textContent).toContain("Loading results…");
  expect(document.body.textContent).not.toContain("No plan run");
  expect(document.body.textContent).not.toContain("not run");
  await act(async () => finish([]));
  await settled();
  expect(document.body.textContent).toContain("No plan runs found");
  act(() => root.unmount());
  document.body.replaceChildren();
  await render(async () => {
    throw new Error("History unavailable");
  });
  await settled();
  expect(document.body.textContent).toContain("Results unavailable");
  expect(document.body.textContent).not.toContain("No plan run");
  expect(document.body.textContent).not.toContain("not run");
});
