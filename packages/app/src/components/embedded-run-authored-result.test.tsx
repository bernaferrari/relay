import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { projectRunReport } from "../data/run-report-projection";
import { retainedNativeFastRun } from "../data/fixtures/native-fast-authored-run";
import { EmbeddedRunResult } from "./embedded-run-result";

it("presents the retained 31-trace Fast Run as seven authored actions", () => {
  expect(retainedNativeFastRun.steps).toHaveLength(31);
  const report = projectRunReport("a1a09d67", retainedNativeFastRun, {});
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <EmbeddedRunResult report={report} />
    </QueryClientProvider>,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  const outline = host.querySelector('[aria-label="Run steps"]');
  expect(outline?.querySelectorAll("li")).toHaveLength(7);
  expect(outline?.textContent).toContain("Start a new conversation");
  expect(outline?.textContent).toContain("Open model menu");
  expect(outline?.textContent).toContain("Fast");
  expect(outline?.textContent).toContain("Type text");
  expect(outline?.textContent).toContain("Send prompt");
  expect(outline?.textContent).not.toContain("Captured result");
  expect(outline?.textContent).not.toContain("Tap label");
});

it("discloses exact child frames for the selected action without adding duplicate actions", async () => {
  const report = projectRunReport("a1a09d67", retainedNativeFastRun, {});
  report.evidence = [
    {
      id: "screenshot",
      label: "Screenshots",
      count: 24,
      detail: "",
      summary: "",
      inspectable: true,
      items: retainedNativeFastRun.frames.map((frame) => ({
        id: frame.path,
        title: frame.caption,
        media: { kind: "image" as const, src: `/saved/${frame.path}` },
      })),
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <EmbeddedRunResult report={report} />
        </QueryClientProvider>,
      ),
    );
    const button = [...host.querySelectorAll('[aria-label="Run steps"] button')].find((item) =>
      item.textContent?.includes("Type text"),
    );
    await act(async () => (button as HTMLButtonElement).click());
    const disclosure = host.querySelector("details");
    expect(disclosure?.textContent).toContain("Execution details · 5");
    expect(disclosure?.textContent).toContain("Reach Grok home");
    expect(disclosure?.textContent).toContain("Type text");
    const child = [...host.querySelectorAll('[aria-label="Execution details"] button')].find(
      (item) => item.textContent?.includes("Type text"),
    );
    await act(async () => (child as HTMLButtonElement).click());
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      `/saved/${retainedNativeFastRun.steps[21]!.frames.at(-1)!.path}`,
    );
    expect(host.querySelectorAll('[aria-label="Run steps"] > li')).toHaveLength(7);
    const runDetails = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Run details"),
    );
    await act(async () => (runDetails as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="Execution details"]')?.textContent).toContain(
      "Screenshot · final",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("opens failed internal evidence even when no authored capture was reached", () => {
  const run = structuredClone(retainedNativeFastRun);
  run.outcome = "failed";
  run.steps = run.steps.slice(0, 4);
  for (const index of [0, 1, 3]) {
    run.steps[index]!.status = "error";
    run.steps[index]!.finishedAt = run.steps[3]!.finishedAt;
  }
  const html = renderToStaticMarkup(
    <EmbeddedRunResult report={projectRunReport("failed", run, {})} />,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  expect(host.querySelector("details")?.open).toBe(true);
  expect(
    host.querySelector('[aria-label="Run steps"] button[aria-pressed="true"]')?.textContent,
  ).toContain("Start a new conversation");
  expect(host.querySelector('[aria-label="Execution details"]')?.textContent).toContain(
    "Tap identifier sidebar.open.button",
  );
  expect(host.textContent).toContain("failed internal step");
});
