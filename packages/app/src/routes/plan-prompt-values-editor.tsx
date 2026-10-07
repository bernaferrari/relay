/** @jsxImportSource react */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { MAX_INPUT_DATA_SET_VALUE_LENGTH } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";

export type PromptValuesDraft = { name: string; source: "list" | "static"; values: string[] };

/** This fieldset lives inside New Plan's form. Its explicit save and keyboard
 * handling never submit the surrounding Plan or discard a failed-save draft. */
export function PlanPromptValuesEditor({
  definition,
  disabled,
  onBusy,
  onSave,
  onSaved,
  onCancel,
  onReload,
}: {
  definition?: PromptValuesDraft;
  disabled: boolean;
  onBusy(pending: boolean): void;
  onSave(draft: PromptValuesDraft): Promise<void>;
  onSaved(): void;
  onCancel(): void;
  onReload(): Promise<unknown>;
}) {
  const id = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [name, setName] = useState(definition?.name ?? "");
  const [values, setValues] = useState(definition?.values ?? ["", ""]);
  const source = definition?.source ?? "list";
  const [errors, setErrors] = useState<{ name?: string; values?: (string | undefined)[] }>({});
  const save = useMutation({
    mutationFn: (draft: PromptValuesDraft) => onSave(draft),
    retry: false,
    onSuccess: () => onSaved(),
    onSettled: () => {
      inFlight.current = false;
      onBusy(false);
    },
  });
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string>();
  const busy = disabled || save.isPending || reloading;
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) firstInput.current?.focus();
  }, []);

  function nameError(value: string) {
    return !value.trim()
      ? "Enter an input name."
      : !/^[A-Za-z0-9_.-]+$/u.test(value.trim())
        ? "Use letters, numbers, underscores, periods or hyphens."
        : undefined;
  }
  function valueError(value: string) {
    return !value.trim()
      ? "Enter a prompt."
      : value.length > MAX_INPUT_DATA_SET_VALUE_LENGTH
        ? `Keep each prompt within ${MAX_INPUT_DATA_SET_VALUE_LENGTH.toLocaleString()} characters.`
        : undefined;
  }
  function submit() {
    if (busy || inFlight.current || save.isError) return;
    const next = { name: nameError(name), values: values.map(valueError) };
    setErrors(next);
    if (next.name || next.values.some(Boolean)) {
      document
        .getElementById(next.name ? `${id}-name` : `${id}-value-${next.values.findIndex(Boolean)}`)
        ?.focus();
      return;
    }
    inFlight.current = true;
    onBusy(true);
    save.mutate({ name: name.trim(), source, values: [...values] });
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    if (event.target instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey) return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  }
  return (
    <fieldset className="grid min-w-0 gap-3 border-t border-border pt-3" onKeyDown={keyDown}>
      <legend className="mb-2 text-sm font-medium">
        {definition ? "Edit prompt values" : "Create prompt values"}
      </legend>
      <p className="text-xs leading-5 text-muted-foreground">
        Public values are shared across this Project.
      </p>
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Input name</FieldLabel>
        <Input
          ref={firstInput}
          id={`${id}-name`}
          value={name}
          placeholder="For example, chat_prompt"
          className="text-base md:text-base"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={`${id}-name-help${errors.name ? ` ${id}-name-error` : ""}`}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setName(next);
            if (errors.name) setErrors((current) => ({ ...current, name: nameError(next) }));
          }}
        />
        <p id={`${id}-name-help`} className="text-xs text-muted-foreground">
          Match the Test’s Run input name. Use letters, numbers, _ . or -.
        </p>
        {errors.name ? <FieldError id={`${id}-name-error`}>{errors.name}</FieldError> : null}
      </Field>
      {values.map((value, index) => (
        <Field key={index}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor={`${id}-value-${index}`}>Prompt {index + 1}</FieldLabel>
            {source === "list" && values.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Remove prompt ${index + 1}`}
                onClick={() => {
                  setValues((current) => current.filter((_, at) => at !== index));
                  setErrors((current) => ({
                    ...current,
                    values: current.values?.filter((_, at) => at !== index),
                  }));
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <Textarea
            id={`${id}-value-${index}`}
            rows={4}
            value={value}
            className="min-h-28 max-h-64 resize-y text-base md:text-base"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.values?.[index])}
            aria-describedby={errors.values?.[index] ? `${id}-value-error-${index}` : undefined}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setValues((current) => current.map((item, at) => (at === index ? next : item)));
              if (errors.values?.[index])
                setErrors((current) => ({
                  ...current,
                  values: current.values?.map((error, at) =>
                    at === index ? valueError(next) : error,
                  ),
                }));
            }}
          />
          {errors.values?.[index] ? (
            <FieldError id={`${id}-value-error-${index}`}>{errors.values[index]}</FieldError>
          ) : null}
        </Field>
      ))}
      {source === "list" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={busy}
          onClick={() => setValues((current) => [...current, ""])}
        >
          Add another prompt
        </Button>
      ) : null}
      {save.error ? (
        <FieldError>
          {save.error instanceof Error
            ? save.error.message
            : "Save was not confirmed. Reload saved inputs before trying again."}
        </FieldError>
      ) : null}
      {reloadError ? <FieldError>{reloadError}</FieldError> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {save.error ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setReloading(true);
              setReloadError(undefined);
              onBusy(true);
              try {
                await onReload();
                save.reset();
              } catch (error) {
                setReloadError(
                  error instanceof Error ? error.message : "Could not reload saved inputs.",
                );
              } finally {
                setReloading(false);
                onBusy(false);
              }
            }}
          >
            {reloading ? "Reloading…" : "Reload saved inputs"}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel editing
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || save.isError}
          onClick={submit}
          title="Save prompt values (Ctrl or ⌘ + Enter)"
        >
          {save.isPending ? "Saving values…" : "Save prompt values"}
        </Button>
      </div>
    </fieldset>
  );
}
