/** @jsxImportSource react */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { E2EProjectLibrary } from "./e2e-project-library";
const fixture = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  source: vi.fn(),
  run: vi.fn(),
  execution: vi.fn(),
  cancel: vi.fn(),
  retryImport: vi.fn(),
  queryClient: undefined as QueryClient | undefined,
}));
vi.mock("../data/e2e-project-service", () => ({ createE2EProjectService: () => fixture }));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ platform: {}, queryClient: fixture.queryClient }),
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params: { runId: string };
  }) => <a href={to.replace("$runId", params.runId)}>{children}</a>,
}));
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  fixture.queryClient?.clear();
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const project = {
  id: "project",
  name: "Accounts",
  path: "/trusted/project",
  configFile: "e2e.config.ts",
  harness: "e2e" as const,
  version: "0.20.0" as const,
  openedAt: 1,
  updatedAt: 1,
  tests: [
    {
      id: "case",
      file: "tests/account.e2e.ts",
      title: "Account settings",
      titlePath: ["Account settings"],
      target: "web",
      agent: "default",
      disposition: "run" as const,
    },
  ],
};
const execution = {
  id: "execution",
  projectId: "project",
  status: "complete",
  startedAt: 1,
  logs: "",
  upstreamStatus: "passed",
  exitCode: 0,
  runIds: ["retained"],
  results: [{ runId: "retained", title: "Account settings · web", status: "succeeded" }],
  availableCaptures: 1,
  pendingReview: 1,
  accepted: 0,
  issues: 0,
};
const button = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === text,
  )!;
it("requires explicit project trust, displays authoritative source, and opens retained Runs with review pending", async () => {
  fixture.queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fixture.list.mockResolvedValue({ projects: [], executions: [] });
  fixture.open.mockImplementation(async () => {
    fixture.list.mockResolvedValue({ projects: [project], executions: [] });
    return { project };
  });
  fixture.source.mockResolvedValue({
    file: "tests/account.e2e.ts",
    text: "test('Account settings', originalHelper);",
  });
  fixture.run.mockResolvedValue({ execution });
  fixture.execution.mockResolvedValue({ execution });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={fixture.queryClient!}>
        <E2EProjectLibrary
          open
          onOpenChange={vi.fn()}
          search=""
          onCount={vi.fn()}
          onProjectClose={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  );
  expect(fixture.open).not.toHaveBeenCalled();
  expect(button("Trust project and open").disabled).toBe(true);
  const input = document.querySelector<HTMLInputElement>("#e2e-project-folder")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "/trusted/project",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Trust project and open").click());
  expect(fixture.open).toHaveBeenCalledOnce();
  await act(async () => button("Source").click());
  expect(document.body.textContent).toContain("test('Account settings', originalHelper);");
  await act(async () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .filter((item) => item.textContent?.trim() === "Close")
      .at(-1)
      ?.click(),
  );
  await act(async () => button("Run project").click());
  expect(fixture.run).toHaveBeenCalledWith("project", undefined);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.body.textContent).toContain("Evidence imported");
  });
  expect(document.body.textContent).toContain("1 captures produced");
  expect(document.body.textContent).toContain("1 pending review");
  expect(document.querySelector('a[href="/runs/retained"]')?.textContent).toBe(
    "Account settings · web",
  );
});
