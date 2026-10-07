/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState, useId } from "react";
import type { ProductTestTextAction } from "../data/test-text-actions";

export function TestRecordedTextEditor({
  action,
  value,
  busy,
  onChange,
  onSave,
}: {
  action: ProductTestTextAction;
  value: string;
  busy: boolean;
  onChange(text: string): void;
  onSave(): void;
}) {
  const id = useId();
  const parameter = /^\{\{([^{}]*)\}\}$/u.exec(value)?.[1]?.trim();
  const [source, setSource] = useState(parameter !== undefined ? "parameter" : "text");
  const [parameterName, setParameterName] = useState(parameter ?? "chat_prompt");
  const [literal, setLiteral] = useState(parameter !== undefined ? "" : value);
  const { testEditorService } = useRouteContext({ from: "__root__" });
  const definitions = useQuery({
    queryKey: ["test-text-parameters"],
    queryFn: () => testEditorService.listTextParameters!(),
    enabled: Boolean(testEditorService.listTextParameters),
  });
  const changed = value !== action.text;
  const valid =
    value.trim() && (source !== "parameter" || /^[A-Za-z0-9_.-]+$/u.test(parameterName));
  return (
    <form
      className="grid gap-3 border-t border-border/50 px-3 py-4"
      aria-label="Recorded text"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && valid && !busy) onSave();
      }}
    >
      <label className="grid gap-1.5 text-xs font-medium" htmlFor={`${id}-source`}>
        Text source
        <select
          id={`${id}-source`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={source}
          disabled={busy}
          onChange={(event) => {
            setSource(event.target.value);
            if (event.target.value === "parameter") {
              setLiteral(value);
              onChange(`{{${parameterName}}}`);
            } else onChange(literal);
          }}
        >
          <option value="text">Fixed text</option>
          <option value="parameter">Run input</option>
        </select>
      </label>
      {source === "parameter" ? (
        <label className="grid gap-1.5 text-xs font-medium" htmlFor={`${id}-parameter`}>
          Input name
          <Input
            id={`${id}-parameter`}
            list={`${id}-parameters`}
            value={parameterName}
            disabled={busy}
            pattern="[A-Za-z0-9_.-]+"
            onChange={(event) => {
              setParameterName(event.target.value);
              onChange(`{{${event.target.value}}}`);
            }}
          />
          <datalist id={`${id}-parameters`}>
            {definitions.data?.map((definition) => (
              <option key={definition.id} value={definition.name} />
            ))}
          </datalist>
        </label>
      ) : (
        <label className="grid gap-1.5 text-xs font-medium" htmlFor={`${id}-text`}>
          Text to type
          <Textarea
            id={`${id}-text`}
            rows={4}
            value={value}
            maxLength={20_000}
            disabled={busy}
            onChange={(event) => {
              setLiteral(event.target.value);
              onChange(event.target.value);
            }}
          />
        </label>
      )}
      {action.sharedTestNames.length ? (
        <p className="text-xs text-muted-foreground" title={action.sharedTestNames.join(", ")}>
          Also updates {action.sharedTestNames.length} other{" "}
          {action.sharedTestNames.length === 1 ? "Test" : "Tests"}.
        </p>
      ) : null}
      <div>
        <Button size="sm" type="submit" disabled={!changed || !valid || busy}>
          {busy ? "Saving…" : source === "parameter" ? "Save input" : "Save text"}
        </Button>
      </div>
    </form>
  );
}
