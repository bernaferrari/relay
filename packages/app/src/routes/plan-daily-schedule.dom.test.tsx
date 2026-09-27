import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PlanDailySchedule } from "./plan-daily-schedule";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
it("removes the exact saved schedule without creating another", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onRemove = vi.fn();
  const onSave = vi.fn();
  await act(async () =>
    root.render(
      <PlanDailySchedule
        disabled={false}
        pending={false}
        schedules={[{ id: "daily-1", hour: 8, timezone: "UTC", nextRunAt: 1, enabled: true }]}
        onSave={onSave}
        onRemove={onRemove}
      />,
    ),
  );
  expect(host.textContent).toContain("Daily at 8:00 AM");
  expect(host.textContent).not.toContain("Add schedule");
  await act(async () => host.querySelector("button")!.click());
  expect(onRemove).toHaveBeenCalledWith("daily-1");
  expect(onSave).not.toHaveBeenCalled();
});
