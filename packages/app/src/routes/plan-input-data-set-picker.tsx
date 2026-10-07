/** @jsxImportSource react */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Plus } from "lucide-react";
import { SelectField } from "../components/filter-select";
import type { PlanInputDataSetService } from "../data/plan-input-data-set-service";
import type { ProductSuiteEditor } from "../data/suite-profile-product-service";

/** Inline so adding saved values never abandons the unsaved Plan. */
export function PlanInputDataSetPicker({
  appMapId,
  revision,
  service,
  disabled,
  onBusy,
  onAdded,
  onReload,
}: {
  appMapId: string;
  revision: number;
  service: PlanInputDataSetService;
  disabled: boolean;
  onBusy(pending: boolean): void;
  onAdded(result: { editor: ProductSuiteEditor; variableId: string }): void;
  onReload(): Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [inputId, setInputId] = useState("");
  const [name, setName] = useState("");
  const catalog = useQuery({
    queryKey: ["suites", "input-data-sets", appMapId],
    queryFn: () => service.listInputDataSets(appMapId),
    enabled: open,
    staleTime: 0,
  });
  const selected = catalog.data?.inputs.find((input) => input.id === inputId);
  const add = useMutation({
    mutationFn: () => {
      if (!catalog.data || !selected) throw new TypeError("Choose a saved input.");
      return service.addInputDataSet({
        appMapId,
        expectedRevision: revision,
        catalogRevision: catalog.data.revision,
        inputId: selected.id,
        name,
      });
    },
    onMutate: () => onBusy(true),
    onSuccess: (result) => {
      onAdded(result);
      setOpen(false);
      setInputId("");
      setName("");
    },
    onSettled: () => onBusy(false),
  });
  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          add.reset();
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" /> Use saved input values
      </Button>
    );
  const busy = disabled || add.isPending;
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-sm text-muted-foreground">
        Run the same Tests with saved prompts or other inputs.
      </p>
      {catalog.isPending ? (
        <p role="status" className="text-sm">
          Loading saved inputs…
        </p>
      ) : null}
      {catalog.error ? <FieldError>Could not load saved inputs.</FieldError> : null}
      {catalog.data?.inputs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No shared inputs to add. Save values in Project Data sets first.
        </p>
      ) : null}
      {catalog.data?.inputs.length ? (
        <>
          <SelectField
            label="Saved input"
            value={inputId}
            placeholder="Choose an input"
            disabled={busy || catalog.isFetching}
            options={catalog.data.inputs.map((input) => ({ value: input.id, label: input.name }))}
            onValueChange={(id) => {
              setInputId(id);
              setName(
                catalog.data?.inputs.find((input) => input.id === id)?.name.replace(/_/gu, " ") ??
                  "",
              );
              add.reset();
            }}
          />
          {selected ? (
            <>
              <Field>
                <FieldLabel htmlFor="input-data-set-name">Data set name</FieldLabel>
                <Input
                  id="input-data-set-name"
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!busy && !catalog.isFetching && selected && name.trim()) add.mutate();
                  }}
                />
              </Field>
              <ul aria-label="Saved values" className="grid max-h-48 gap-2 overflow-y-auto text-sm">
                {selected.values.map((value, index) => (
                  <li key={index} className="break-words rounded-md bg-background px-3 py-2">
                    {value}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
      {add.error ? (
        <FieldError>
          {add.error instanceof Error ? add.error.message : "Could not add this Data set."}
        </FieldError>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {catalog.error || add.error ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || catalog.isFetching}
            onClick={async () => {
              await onReload();
              await catalog.refetch();
              add.reset();
            }}
          >
            Reload Data sets
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || catalog.isFetching || !selected || !name.trim()}
          onClick={() => add.mutate()}
        >
          {add.isPending ? "Adding…" : "Add Data set"}
        </Button>
      </div>
    </div>
  );
}
