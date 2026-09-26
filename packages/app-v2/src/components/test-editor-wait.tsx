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
    <div className="grid gap-3">
      <label className="grid gap-1.5" htmlFor="wait-control">
        Control label
        <Input
          id="wait-control"
          className="text-base"
          value={value.label}
          placeholder="Download or Generating"
          onChange={(event) => onChange({ ...value, label: event.currentTarget.value })}
        />
      </label>
      <SelectField
        label="Wait until"
        value={value.condition}
        options={[
          { value: "visible", label: "The control appears" },
          { value: "gone", label: "The control disappears" },
        ]}
        onValueChange={(condition) =>
          onChange({ ...value, condition: condition === "gone" ? "gone" : "visible" })
        }
      />
      <label className="grid gap-1.5" htmlFor="wait-seconds">
        Wait up to (seconds)
        <Input
          id="wait-seconds"
          className="text-base"
          type="number"
          min="0.001"
          max="900"
          step="any"
          value={value.seconds}
          aria-invalid={!valid}
          aria-describedby="wait-seconds-help"
          onChange={(event) => onChange({ ...value, seconds: event.currentTarget.value })}
        />
      </label>
      <div className="flex flex-wrap gap-2" aria-label="Wait duration presets">
        {[30, 60, 120].map((seconds) => (
          <Button
            key={seconds}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={Number(value.seconds) === seconds}
            onClick={() => onChange({ ...value, seconds: String(seconds) })}
          >
            {seconds}s
          </Button>
        ))}
      </div>
      <p
        id="wait-seconds-help"
        className="text-xs font-normal leading-normal text-muted-foreground"
      >
        {valid
          ? "Continues when ready; fails after the time limit."
          : "Enter a duration greater than 0 and no more than 900 seconds."}
      </p>
    </div>
  );
}
