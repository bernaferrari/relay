/** @jsxImportSource react */
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useState, type FormEvent } from "react";

export function PlanDailySchedule({
  disabled,
  pending,
  error,
  onSave,
}: {
  disabled: boolean;
  pending: boolean;
  error?: unknown;
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
        Starts this Plan every day at the chosen hour on the first selected browser or device. Slack
        is unsupported; Relay writes `.relay/notifications.json` and can POST
        `RELAY_NOTIFY_WEBHOOK`.
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="plan-daily-hour">Hour (0–23)</FieldLabel>
          <Input
            id="plan-daily-hour"
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(event) => setHour(event.target.value)}
            disabled={disabled || pending}
          />
        </Field>
        <p className="mb-2 text-xs text-muted-foreground">{timezone}</p>
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
