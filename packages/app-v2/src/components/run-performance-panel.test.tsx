import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RunPerformancePanel } from "./run-performance-panel";

it("inspects samples directly and switches metrics without rendering settings sliders", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const seek = vi.fn();
  act(() =>
    root.render(
      <RunPerformancePanel
        series={[
          {
            name: "CPU (%)",
            points: [
              { at: 1000, value: 5 },
              { at: 2000, value: 9 },
            ],
          },
          { name: "Fps total Frame Count", points: [{ at: 1000, value: 30 }] },
        ]}
        onSeek={seek}
      />,
    ),
  );
  expect(host.querySelector('input[type="range"]')).toBeNull();
  act(() =>
    host
      .querySelectorAll<SVGElement>('[role="button"]')[1]!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(seek).toHaveBeenCalledWith(2000);
  act(() =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Frames rendered")!
      .click(),
  );
  expect(host.querySelector("svg")?.getAttribute("aria-label")).toBe("Frames rendered, 1 samples");
  act(() => root.unmount());
  host.remove();
});

it("shows startup as a launch measurement rather than a timeline", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <RunPerformancePanel
        series={[{ name: "Startup last Duration Ms", points: [{ at: 1000, value: 2500 }] }]}
        onSeek={() => {}}
      />,
    ),
  );
  expect(host.querySelector("svg")).toBeNull();
  expect(host.textContent).toContain("2.50");
  expect(host.textContent).toContain("does not measure when the first screen became interactive");
  expect(host.textContent).not.toContain("Peak");
  act(() => root.unmount());
  host.remove();
});
