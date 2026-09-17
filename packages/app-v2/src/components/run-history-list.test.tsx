import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { ProductRunSummary } from "@relay/product/catalog";
import { RunHistoryList } from "./run-history-list";

it("preserves the scroll position when a background refresh updates the same Runs", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const runs: ProductRunSummary[] = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    title: `Run ${index}`,
    action: "test",
    status: "ok",
    phase: "completed",
    queuedAt: index,
    identity: { runId: String(index) },
    links: { self: `/runs/${index}` },
  }));
  const view = (items: ProductRunSummary[]) => (
    <RunHistoryList runs={items}>
      {(run) => <a href={run.links.self}>{run.title}</a>}
    </RunHistoryList>
  );
  try {
    await act(async () => root.render(view(runs)));
    const viewport = host.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
    expect(viewport).not.toBeNull();
    await act(async () => {
      viewport.scrollTop = 400;
      viewport.dispatchEvent(new Event("scroll"));
    });
    await act(async () => root.render(view(runs.map((run) => ({ ...run, outcome: "passed" })))));
    expect(viewport.scrollTop).toBe(400);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
