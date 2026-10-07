/** @jsxImportSource react */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Plus } from "lucide-react";
import { SelectField } from "../components/filter-select";
import type { PlanInputDataSetService } from "../data/plan-input-data-set-service";
import type { ProductSuiteEditor, ProductSuiteTest } from "../data/suite-profile-product-service";
import { PlanPromptValuesEditor, type PromptValuesDraft } from "./plan-prompt-values-editor";

/** Inline so adding saved values never abandons the unsaved Plan. */
export function PlanInputDataSetPicker({
  appMapId,
  revision,
  service,
  selectedTests = [],
  disabled,
  onBusy,
  onAdded,
  onReload,
}: {
  appMapId: string;
  revision: number;
  service: Pick<PlanInputDataSetService, "listInputDataSets" | "addInputDataSet"> &
    Partial<Pick<PlanInputDataSetService, "saveInputDefinition">>;
  selectedTests?: readonly Pick<ProductSuiteTest, "id" | "name">[];
  disabled: boolean;
  onBusy(pending: boolean): void;
  onAdded(result: { editor: ProductSuiteEditor; variableId: string }): void;
  onReload(): Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [inputId, setInputId] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ inputId?: string; definition?: PromptValuesDraft }>();
  const [editRevision, setEditRevision] = useState(0);
  const [savingValues, setSavingValues] = useState(false);
  const [reloadIssue, setReloadIssue] = useState<string>();
  const inFlight = useRef(false);
  const queryClient = useQueryClient();
  const catalogKey = ["suites", "input-data-sets", appMapId] as const;
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => service.listInputDataSets(appMapId),
    enabled: open,
    staleTime: 0,
  });
  const selected = catalog.data?.inputs.find((input) => input.id === inputId);
  const add = useMutation({
    mutationFn: () => {
      if (!catalog.data || !selected || selected.addedToApp)
        throw new TypeError("Choose saved values that have not been added yet.");
      return service.addInputDataSet({
        appMapId,
        expectedRevision: revision,
        catalogRevision: catalog.data.revision,
        inputId: selected.id,
        name,
      });
    },
    retry: false,
    onSuccess: (result) => {
      onAdded(result);
      setOpen(false);
      setInputId("");
      setName("");
    },
    onSettled: () => {
      inFlight.current = false;
      onBusy(false);
    },
  });
  function addSelected() {
    if (
      disabled ||
      savingValues ||
      editing ||
      inFlight.current ||
      catalog.isFetching ||
      !selected ||
      selected.addedToApp ||
      !name.trim()
    )
      return;
    inFlight.current = true;
    onBusy(true);
    add.mutate();
  }
  async function reload() {
    setReloadIssue(undefined);
    await onReload();
    const latest = await catalog.refetch();
    if (latest.error || !latest.data)
      throw latest.error ?? new Error("Could not load saved inputs.");
    setEditRevision(latest.data.revision);
    add.reset();
  }
  async function saveDefinition(draft: PromptValuesDraft) {
    if (inFlight.current || !service.saveInputDefinition)
      throw new Error("Prompt value editing is unavailable.");
    inFlight.current = true;
    try {
      const saved = await service.saveInputDefinition({
        appMapId,
        catalogRevision: editRevision,
        ...(editing?.inputId ? { inputId: editing.inputId } : {}),
        ...draft,
      });
      queryClient.setQueryData(catalogKey, saved.catalog);
      setInputId(saved.inputId);
      if (!editing?.inputId) setName(draft.name.replace(/_/gu, " "));
      add.reset();
    } finally {
      inFlight.current = false;
    }
  }
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
        <Plus aria-hidden="true" />{" "}
        {service.saveInputDefinition ? "Add prompt values" : "Use saved input values"}
      </Button>
    );
  const busy = disabled || add.isPending || savingValues;
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
        <p className="text-sm text-muted-foreground">No saved prompt values yet.</p>
      ) : null}
      {catalog.data?.inputs.length ? (
        <>
          <SelectField
            label="Saved input"
            value={inputId}
            placeholder="Choose an input"
            disabled={busy || Boolean(editing) || catalog.isFetching}
            options={catalog.data.inputs.map((input) => ({
              value: input.id,
              label: `${input.name}${input.addedToApp ? " · Already added" : ""}`,
            }))}
            onValueChange={(id) => {
              setInputId(id);
              setEditing(undefined);
              setName(
                catalog.data?.inputs.find((input) => input.id === id)?.name.replace(/_/gu, " ") ??
                  "",
              );
              add.reset();
            }}
          />
          {selected ? (
            <>
              {!selected.addedToApp ? (
                <Field>
                  <FieldLabel htmlFor="input-data-set-name">Data set name</FieldLabel>
                  <Input
                    id="input-data-set-name"
                    value={name}
                    className="text-base md:text-base"
                    disabled={busy}
                    onChange={(event) => setName(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      event.stopPropagation();
                      addSelected();
                    }}
                  />
                </Field>
              ) : null}
              <ul aria-label="Saved values" className="grid max-h-48 gap-2 overflow-y-auto text-sm">
                {selected.values.map((value, index) => (
                  <li
                    key={index}
                    className="whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2"
                  >
                    {value}
                  </li>
                ))}
              </ul>
              {selected.linked ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  Used by a saved Data set. Create a new input to keep existing Plans unchanged.
                </p>
              ) : service.saveInputDefinition && !editing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="justify-self-start"
                  disabled={busy || catalog.isFetching}
                  onClick={() => {
                    setEditing({
                      inputId: selected.id,
                      definition: {
                        name: selected.name,
                        source: selected.source,
                        values: [...selected.values],
                      },
                    });
                    setEditRevision(catalog.data!.revision);
                  }}
                >
                  Edit prompt values
                </Button>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {service.saveInputDefinition && !editing ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={busy || catalog.isFetching || !catalog.data}
          onClick={() => {
            setEditing({});
            setEditRevision(catalog.data!.revision);
            add.reset();
          }}
        >
          Create prompt values
        </Button>
      ) : null}
      {editing ? (
        <PlanPromptValuesEditor
          definition={editing.definition}
          disabled={disabled || add.isPending}
          onBusy={(pending) => {
            setSavingValues(pending);
            onBusy(pending);
          }}
          onSave={saveDefinition}
          onSaved={() => setEditing(undefined)}
          onCancel={() => setEditing(undefined)}
          onReload={reload}
        />
      ) : null}
      {selected ? (
        <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
          <p>
            To use these values, change the Test’s recorded text to Run input named{" "}
            <span className="font-medium text-foreground">{selected.name}</span>. Fixed text stays
            unchanged.
          </p>
          {selectedTests.length ? (
            selectedTests.map((test) => (
              <a
                key={test.id}
                href={`#/tests/${encodeURIComponent(test.id)}?app=${encodeURIComponent(appMapId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit underline underline-offset-4"
              >
                Edit {test.name} in a new tab
              </a>
            ))
          ) : (
            <a
              href={`#/tests?app=${encodeURIComponent(appMapId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-fit underline underline-offset-4"
            >
              Open this App’s Tests in a new tab
            </a>
          )}
        </div>
      ) : null}
      {add.error ? (
        <FieldError>
          {add.error instanceof Error ? add.error.message : "Could not add this Data set."}
        </FieldError>
      ) : null}
      {reloadIssue ? <FieldError>{reloadIssue}</FieldError> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {catalog.error || add.error ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || catalog.isFetching}
            onClick={async () => {
              try {
                await reload();
              } catch (error) {
                setReloadIssue(
                  error instanceof Error ? error.message : "Could not reload Data sets.",
                );
              }
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
          disabled={
            busy ||
            Boolean(editing) ||
            catalog.isFetching ||
            !selected ||
            selected.addedToApp ||
            !name.trim()
          }
          onClick={addSelected}
        >
          {add.isPending ? "Adding…" : selected?.addedToApp ? "Already added" : "Add Data set"}
        </Button>
      </div>
    </div>
  );
}
