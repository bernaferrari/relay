/** @jsxImportSource react */
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
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
    next: planScheduleWhen(schedule.nextRunAt, schedule.timezone),
    last: schedule.lastRunAt ? planScheduleWhen(schedule.lastRunAt, schedule.timezone) : "Never",
    ...(schedule.lastFailure
      ? {
          failure: `${schedule.lastFailure} Infra. This does not accept a visual baseline.`,
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
}: {
  disabled: boolean;
  pending: boolean;
  error?: unknown;
  schedules?: readonly ProductPlanSchedule[];
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
    <section
      className="mt-8 border-t border-border-weak-base pt-5"
      aria-labelledby="plan-daily-title"
    >
      <h2 id="plan-daily-title" className="text-sm font-semibold text-text-strong">
        Run daily
      </h2>
      <p className="mt-1 text-xs leading-5 text-text-weak">
        Starts this Plan every day at {clockLabel(Number(hour))} ({timezone}) on the first selected
        browser or device. Slack is unsupported; Relay writes `.relay/notifications.json` and can
        POST `RELAY_NOTIFY_WEBHOOK`. Next and last run come from the saved schedule. An admission
        failure stays Infra and does not accept a visual baseline.
      </p>
      {schedules.length ? (
        <ol className="mt-3 grid gap-2 text-xs leading-5 text-text-weak">
          {schedules.map((schedule) => {
            const status = planScheduleStatus(schedule);
            return (
              <li key={schedule.id} className="rounded-md border border-border-weak-base px-3 py-2">
                <p>
                  <span className="font-medium text-text-strong">Next</span> {status.next}
                </p>
                <p>
                  <span className="font-medium text-text-strong">Last</span> {status.last}
                </p>
                {status.failure ? <p>{status.failure}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-xs leading-5 text-text-weak">No daily run is scheduled yet.</p>
      )}
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="plan-daily-hour">Hour (0–23)</FieldLabel>
          <Input
            id="plan-daily-hour"
            type="number"
            min={0}
            max={23}
            className="tabular-nums"
            value={hour}
            onChange={(event) => setHour(event.target.value)}
            disabled={disabled || pending}
          />
        </Field>
        <p className="mb-2 text-xs text-muted-foreground">{clockLabel(Number(hour))}</p>
        <Button type="submit" variant="outline" disabled={disabled || pending}>
          {pending ? "Scheduling…" : "Schedule Plan"}
        </Button>
      </form>
      {error ? (
        <FieldError>
          {error instanceof Error ? error.message : "Relay could not schedule this Plan."}
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
