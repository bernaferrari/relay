/** @jsxImportSource react */
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { Button } from "@relay/ui-react/components/button";
import { useId, useState } from "react";
import type { TestTextInput, useTestTextInputs } from "../data/use-test-text-inputs";

function TextRunInput({
  input,
  onChange,
}: {
  input: TestTextInput;
  onChange(value: string): void;
}) {
  const id = useId();
  const saved =
    input.definition?.scope === "shared" && !input.definition.sensitive
      ? (input.definition.values?.filter((value) => value.trim()) ?? [])
      : [];
  const [custom, setCustom] = useState(false);
  const label = input.name.replace(/[_-]/gu, " ");
  return (
    <label htmlFor={id} className="grid gap-1.5 text-xs font-medium">
      {label}
      {saved.length > 1 && !custom && saved.includes(input.value) ? (
        <select
          id={id}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={input.value}
          onChange={(event) => {
            if (event.target.value === "__custom__") setCustom(true);
            else onChange(event.target.value);
          }}
        >
          {saved.map((value, index) => (
            <option key={index} value={value}>
              {value}
            </option>
          ))}
          <option value="__custom__">Enter a value…</option>
        </select>
      ) : input.definition?.sensitive || input.definition?.scope === "private" ? (
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={input.value}
          required={input.required}
          onChange={(event) => onChange(event.target.value)}
          placeholder={input.required ? "Enter a value for this run" : "Use saved value"}
          maxLength={20_000}
        />
      ) : (
        <Textarea
          id={id}
          rows={3}
          value={input.value}
          required={input.required}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            input.definition?.source === "generated"
              ? "Use generated value"
              : "Enter a value for this run"
          }
          maxLength={20_000}
        />
      )}
    </label>
  );
}

export function TestTextRunInputs({ state }: { state: ReturnType<typeof useTestTextInputs> }) {
  if (!state.inputs.length) return null;
  return (
    <section className="grid gap-3 border-t border-border/60 pt-3" aria-label="Run inputs">
      {state.inputs.map((input) => (
        <TextRunInput
          key={input.name}
          input={input}
          onChange={(value) => state.setValue(input.name, value)}
        />
      ))}
      {state.loading ? (
        <p className="text-xs text-muted-foreground">Loading saved values…</p>
      ) : state.error ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Saved values unavailable.
          <Button size="sm" variant="ghost" onClick={state.retry}>
            Reload values
          </Button>
        </div>
      ) : null}
    </section>
  );
}
