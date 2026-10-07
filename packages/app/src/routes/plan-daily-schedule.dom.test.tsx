import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PlanDailySchedule } from "./plan-daily-schedule";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
async function render(props: Partial<ComponentProps<typeof PlanDailySchedule>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const onSave = props.onSave ?? vi.fn();
  await act(async () =>
    root.render(<PlanDailySchedule disabled={false} pending={false} {...props} onSave={onSave} />),
  );
  return { host, onSave };
}
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function select(id: string, label: string) {
  await act(async () => document.getElementById(id)!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!option) throw new Error(`Missing option ${label}`);
  await act(async () => option.click());
}
it("removes the exact saved schedule without creating another", async () => {
  const onRemove = vi.fn();
  const { host, onSave } = await render({
    schedules: [{ id: "daily-1", hour: 8, timezone: "UTC", nextRunAt: 1, enabled: true }],
    onRemove,
  });
  expect(host.textContent).toContain("Daily at 8:00 AM");
  expect(host.textContent).not.toContain("Add schedule");
  await act(async () => button("Remove schedule").click());
  expect(onRemove).toHaveBeenCalledWith("daily-1");
  expect(onSave).not.toHaveBeenCalled();
});
it("keeps the existing daily default when adding a schedule", async () => {
  const { onSave } = await render();
  expect(document.getElementById("plan-schedule-frequency")?.textContent).toContain(
    "Daily at time",
  );
  await act(async () => button("Add schedule").click());
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ hour: 8, timezone: expect.any(String) });
});
it.each([
  { label: "Every 30 minutes", intervalMinutes: 30 },
  { label: "Hourly", intervalMinutes: 60 },
])("submits $label without retaining the hidden daily hour", async ({ label, intervalMinutes }) => {
  const { onSave } = await render();
  await select("plan-daily-hour", "9:00 AM");
  await select("plan-schedule-frequency", label);
  expect(document.getElementById("plan-daily-hour")).toBeNull();
  await act(async () => button("Add schedule").click());
  expect(onSave).toHaveBeenCalledExactlyOnceWith({ intervalMinutes, timezone: expect.any(String) });
});
it("changes an existing daily frequency by its saved identity and timezone", async () => {
  const { onSave } = await render({
    schedules: [
      {
        id: "daily-native",
        intervalMinutes: 1_440,
        hour: 9,
        timezone: "Asia/Tokyo",
        nextRunAt: 1,
        enabled: false,
      },
    ],
  });
  await act(async () => button("Change frequency").click());
  expect(document.getElementById("plan-daily-hour")?.textContent).toContain("9:00 AM");
  expect(button("Save schedule").disabled).toBe(true);
  await select("plan-schedule-frequency", "Every 30 minutes");
  await act(async () => button("Save schedule").click());
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    scheduleId: "daily-native",
    intervalMinutes: 30,
    timezone: "Asia/Tokyo",
  });
  expect(document.body.textContent).toContain("Paused");
});
it.each([
  { disabled: true, pending: false },
  { disabled: false, pending: true },
])("does not submit a disabled or pending schedule ($disabled/$pending)", async (state) => {
  const { onSave } = await render(state);
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(onSave).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});
