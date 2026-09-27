/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { SelectField } from "./filter-select";
import { validWaitSeconds, type ValidationDraft } from "./test-editor-assertion-model";

type WaitDraft = Extract<ValidationDraft, { kind: "wait-for" }>;

export function ConditionWaitEditor({
  value,
  onChange,
}: {
  value: WaitDraft;
  onChange(value: WaitDraft): void;
}) {
  const valid = validWaitSeconds(value.seconds);
  return (
    <div className="grid gap-3 text-sm font-normal">
      <label className="grid gap-1.5 text-xs text-muted-foreground" htmlFor="wait-control">
        Control label
        <Input
          id="wait-control"
          className="text-sm text-foreground"
          value={value.label}
          placeholder="Download or Generating"
          onChange={(event) => onChange({ ...value, label: event.currentTarget.value })}
        />
      </label>
      <SelectField
        label="Wait until"
        value={value.condition}
        options={[
          { value: "visible", label: "Appears" },
          { value: "gone", label: "Disappears" },
        ]}
        onValueChange={(condition) =>
          onChange({ ...value, condition: condition === "gone" ? "gone" : "visible" })
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
        <label htmlFor="wait-seconds" className="mr-auto text-xs text-muted-foreground">
          Timeout
        </label>
        <div className="relative w-20">
          <Input
            id="wait-seconds"
            aria-label="Wait up to (seconds)"
            className="h-8 pr-6 text-sm"
            type="number"
            min="0.001"
            max="900"
            step="any"
            value={value.seconds}
            aria-invalid={!valid}
            aria-describedby="wait-seconds-help"
            onChange={(event) => onChange({ ...value, seconds: event.currentTarget.value })}
          />
          <span className="pointer-events-none absolute right-2 top-2 text-xs text-muted-foreground">
            s
          </span>
        </div>
        <div className="flex gap-0.5" aria-label="Wait duration presets">
          {[30, 60, 120].map((seconds) => (
            <Button
              key={seconds}
              type="button"
              size="xs"
              variant="ghost"
              aria-pressed={Number(value.seconds) === seconds}
              onClick={() => onChange({ ...value, seconds: String(seconds) })}
            >
              {seconds}s
            </Button>
          ))}
        </div>
      </div>
      <p
        id="wait-seconds-help"
        className="text-xs font-normal leading-normal text-muted-foreground"
      >
        {valid
          ? "Stops waiting as soon as the condition is met."
          : "Enter a duration greater than 0 and no more than 900 seconds."}
      </p>
    </div>
  );
}
