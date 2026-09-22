/** @jsxImportSource react */
import { FieldError } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { SelectField } from "../components/filter-select";
import { useState, type FormEvent } from "react";
import type { ProductPlanSchedule } from "../data/suite-profile-product-service";

export function planScheduleWhen(at: number, timezone?: string): string {
  const zone = timezone?.trim();
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...(zone ? { timeZone: zone } : {}),
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString();
  }
}

export function planScheduleStatus(schedule: ProductPlanSchedule): {
  next: string;
  last: string;
  failure?: string;
} {
  return {
    next: schedule.enabled ? planScheduleWhen(schedule.nextRunAt, schedule.timezone) : "Paused",
    last: schedule.lastRunAt ? planScheduleWhen(schedule.lastRunAt, schedule.timezone) : "Never",
    ...(schedule.lastFailure
      ? {
          failure: `Last run could not start: ${schedule.lastFailure}`,
        }
      : {}),
  };
}

export function PlanDailySchedule({
  disabled,
  pending,
  error,
  schedules = [],
  onSave,
  onRemove,
  targetName,
}: {
  disabled: boolean;
  pending: boolean;
  error?: unknown;
  schedules?: readonly ProductPlanSchedule[];
  targetName?: string;
  onRemove?(id: string): void;
  onSave(input: { hour: number; timezone: string }): void;
}) {
  const [hour, setHour] = useState("8");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(hour);
    if (!Number.isInteger(value) || value < 0 || value > 23) return;
    onSave({ hour: value, timezone });
  }
  return (
    <section className="mt-8 border-t border-border pt-5" aria-labelledby="plan-daily-title">
      <div className="grid gap-1">
        <h2 id="plan-daily-title" className="text-base font-semibold">
          Schedule
        </h2>
        <p className="text-sm text-muted-foreground">Run this plan automatically each day.</p>
      </div>
      {schedules.length ? (
        <ul className="mt-4 grid gap-3">
          {schedules.map((schedule) => {
            const status = planScheduleStatus(schedule);
            return (
              <li
                key={schedule.id}
                className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/40 p-4"
              >
                <div className="grid min-w-0 gap-1">
                  <p className="text-sm font-medium">
                    {schedule.hour === undefined
                      ? "Recurring run"
                      : `Daily at ${clockLabel(schedule.hour)}`}
                    {!schedule.enabled ? " · Paused" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {schedule.timezone || "Local time"}
                  </p>
                  <p className="mt-2 text-sm">Next scheduled run: {status.next}</p>
                </div>
                {onRemove ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => onRemove(schedule.id)}
                  >
                    Remove schedule
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <form className="mt-4 grid gap-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">No automatic runs scheduled.</p>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              id="plan-daily-hour"
              label="Run every day at"
              value={hour}
              options={Array.from({ length: 24 }, (_, value) => ({
                value: String(value),
                label: clockLabel(value),
              }))}
              onValueChange={setHour}
              disabled={disabled || pending}
              className="min-w-40 flex-1"
            />
            <Button type="submit" disabled={disabled || pending}>
              {pending ? "Saving…" : "Add schedule"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {timezone} ·{" "}
            {targetName
              ? `Uses ${targetName} and the selected account setup.`
              : "Choose where to run above first."}
          </p>
          {disabled && targetName ? (
            <p className="text-sm text-muted-foreground">
              Resolve the run setup issues above before adding a schedule.
            </p>
          ) : null}
        </form>
      )}
      {schedules.some((item) => item.lastRunAt || item.lastFailure) ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer py-2 text-muted-foreground">
            Previous scheduled runs
          </summary>
          <ul className="grid gap-2 py-2">
            {schedules
              .filter((item) => item.lastRunAt || item.lastFailure)
              .map((item) => {
                const status = planScheduleStatus(item);
                return (
                  <li key={item.id}>
                    {item.lastRunAt ? <p>Last run: {status.last}</p> : null}
                    {status.failure ? <p className="text-destructive">{status.failure}</p> : null}
                  </li>
                );
              })}
          </ul>
        </details>
      ) : null}
      {error ? (
        <FieldError>
          {error instanceof Error ? error.message : "Could not update the schedule. Try again."}
        </FieldError>
      ) : null}
    </section>
  );
}

function clockLabel(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "the chosen hour";
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 || 12;
  return `${twelve}:00 ${suffix}`;
}
