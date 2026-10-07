/** @jsxImportSource react */
import { FieldError } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { SelectField } from "../components/filter-select";
import { useState, type FormEvent } from "react";
import type {
  ProductPlanSchedule,
  ProductPlanScheduleTiming,
} from "../data/suite-profile-product-service";

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
  onSave(input: ProductPlanScheduleTiming): void;
}) {
  const [editingId, setEditingId] = useState<string>();
  const editing = schedules.find((schedule) => schedule.id === editingId);
  return (
    <section className="mt-8 border-t border-border pt-5" aria-labelledby="plan-daily-title">
      <div className="grid gap-1">
        <h2 id="plan-daily-title" className="text-base font-semibold">
          Schedule
        </h2>
        <p className="text-sm text-muted-foreground">Repeat this Plan automatically.</p>
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
                    {planScheduleFrequency(schedule)}
                    {!schedule.enabled ? " · Paused" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {schedule.timezone || "Local time"}
                  </p>
                  <p className="mt-2 text-sm">Next scheduled run: {status.next}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled || pending}
                    onClick={() => setEditingId(schedule.id)}
                  >
                    Change frequency
                  </Button>
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
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!schedules.length || editing ? (
        <PlanScheduleForm
          key={editing?.id ?? "new"}
          schedule={editing}
          disabled={disabled}
          pending={pending}
          targetName={targetName}
          onSave={onSave}
          onCancel={editing ? () => setEditingId(undefined) : undefined}
        />
      ) : null}
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

export function planScheduleFrequency(schedule: ProductPlanSchedule): string {
  if (schedule.hour !== undefined) return `Daily at ${clockLabel(schedule.hour)}`;
  if (schedule.intervalMinutes === 30) return "Every 30 minutes";
  if (schedule.intervalMinutes === 60) return "Hourly";
  if (!schedule.intervalMinutes) return "Recurring run";
  return schedule.intervalMinutes % 60 === 0
    ? `Every ${schedule.intervalMinutes / 60} hours`
    : `Every ${schedule.intervalMinutes} minutes`;
}

function PlanScheduleForm({
  schedule,
  disabled,
  pending,
  targetName,
  onSave,
  onCancel,
}: {
  schedule?: ProductPlanSchedule;
  disabled: boolean;
  pending: boolean;
  targetName?: string;
  onSave(input: ProductPlanScheduleTiming): void;
  onCancel?(): void;
}) {
  const [frequency, setFrequency] = useState(
    schedule?.hour !== undefined || !schedule?.intervalMinutes
      ? "daily"
      : String(schedule.intervalMinutes),
  );
  const [hour, setHour] = useState(String(schedule?.hour ?? 8));
  const timezone =
    schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";
  const intervalMinutes = frequency === "daily" ? 1_440 : Number(frequency);
  const changed =
    !schedule ||
    intervalMinutes !== schedule.intervalMinutes ||
    (frequency === "daily" ? Number(hour) !== schedule.hour : schedule.hour !== undefined);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || pending || !changed) return;
    const value = Number(hour);
    if (frequency === "daily" && (!Number.isInteger(value) || value < 0 || value > 23)) return;
    onSave({
      ...(schedule ? { scheduleId: schedule.id } : {}),
      ...(frequency === "daily" ? { hour: value } : { intervalMinutes }),
      timezone,
    });
  }
  return (
    <form
      className="mt-4 grid gap-4"
      onSubmit={submit}
      aria-label={schedule ? "Change schedule frequency" : "Add schedule"}
    >
      {!schedule ? (
        <p className="text-sm text-muted-foreground">No automatic runs scheduled.</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          id="plan-schedule-frequency"
          label="Repeat"
          value={frequency}
          options={[
            { value: "30", label: "Every 30 minutes" },
            { value: "60", label: "Hourly" },
            { value: "daily", label: "Daily at time" },
            ...(schedule?.hour === undefined &&
            schedule?.intervalMinutes &&
            ![30, 60].includes(schedule.intervalMinutes)
              ? [
                  {
                    value: String(schedule.intervalMinutes),
                    label: planScheduleFrequency(schedule),
                  },
                ]
              : []),
          ]}
          onValueChange={setFrequency}
          disabled={disabled || pending}
          className="min-w-40 flex-1"
        />
        {frequency === "daily" ? (
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
        ) : null}
        <Button type="submit" disabled={disabled || pending || !changed}>
          {pending ? "Saving…" : schedule ? "Save schedule" : "Add schedule"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {timezone} ·{" "}
        {schedule
          ? "Keeps the saved run setup and next scheduled run."
          : targetName
            ? `Uses ${targetName} and the selected account setup.`
            : "Choose where to run above first."}
      </p>
      {disabled && targetName ? (
        <p className="text-sm text-muted-foreground">
          Resolve the run setup issues above before saving a schedule.
        </p>
      ) : null}
    </form>
  );
}

function clockLabel(hour: number): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "the chosen hour";
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 || 12;
  return `${twelve}:00 ${suffix}`;
}
