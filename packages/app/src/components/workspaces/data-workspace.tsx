import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { TestData } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../../context/server";
import { toast } from "../../context/toast";
import { humanError } from "../../lib/human-error";
import { cn } from "../../lib/cn";
import { Icon } from "../icon";
import { DataSourceControl } from "../data-source-control";
import {
  dataSourceModePatch,
  dataSourceScopePatch,
  type DataSourceMode,
} from "../../lib/data-source-mode";
import {
  readPrivateVariableValues,
  readSharedVariableDrafts,
  removePrivateVariableValue,
  removeSharedVariableDraft,
  writeSharedVariableDraft,
  writePrivateVariableValue,
  type SharedVariableDraft,
} from "../../lib/private-variables";
import {
  eyebrow,
  productPage,
  productPageHero,
  productPageTitle,
  productPageLead,
  productIconButton,
  copyDescription,
  copyStack,
  copyTitle,
} from "../../lib/ui";

type DataRow = {
  id: string;
  name: string;
  scope: "shared" | "private";
  mode: DataSourceMode;
  sharedMode?: DataSourceMode;
  preview: string;
  values?: string[];
  fallback: string;
  privateValue: string;
};

const fieldClass =
  "w-full rounded-lg border border-border-weak-base bg-background-base px-2.5 py-2 text-body/[1.4] text-text-base outline-none focus:border-border-focus focus:ring-2 focus:ring-surface-info-weak";

export function DataWorkspace(props: {
  onConfigureProvider: () => void;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const server = useServer();
  const [rows, setRows] = createSignal<DataRow[]>([]);
  const [hydrated, setHydrated] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [draftIds, setDraftIds] = createSignal<ReadonlySet<string>>(new Set());
  const selectedRow = () => rows().find((row) => row.id === selectedId()) ?? null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSavedSnapshot = "";

  createEffect(() => {
    const remote = server.projectVariables();
    if (remote.updatedAt <= 0 || hydrated()) return;
    const privateValues = readPrivateVariableValues(server.projectId());
    const sharedDrafts = readSharedVariableDrafts(server.projectId());
    const nextRows = remote.value.map((variable) =>
      variableToDataRow(variable, privateValues[variable.id], sharedDrafts[variable.id]),
    );
    setRows(nextRows);
    lastSavedSnapshot = JSON.stringify(nextRows.map(dataRowToVariable));
    setHydrated(true);
  });
  createEffect(() => {
    const value = rows()
      .filter((row) => !draftIds().has(row.id))
      .map(dataRowToVariable);
    if (!hydrated()) return;
    const snapshot = JSON.stringify(value);
    if (snapshot === lastSavedSnapshot) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void server
        .saveProjectVariables(value)
        .then(() => {
          lastSavedSnapshot = snapshot;
        })
        .catch((error: unknown) => toast(humanError(error, "Could not save this data"), "error"));
    }, 450);
  });
  onCleanup(() => clearTimeout(saveTimer));

  const patchRow = (id: string, changes: Partial<DataRow>) => {
    setDraftIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setRows((items) => items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  };
  const deleteRow = (id: string) => {
    removePrivateVariableValue(server.projectId(), id);
    removeSharedVariableDraft(server.projectId(), id);
    setDraftIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setRows((items) => items.filter((item) => item.id !== id));
    if (selectedId() === id) setSelectedId(null);
  };
  const addRow = () => {
    const id = crypto.randomUUID();
    setDraftIds((current) => new Set(current).add(id));
    setRows((current) => [
      ...current,
      {
        id,
        name: `variable_${current.length + 1}`,
        scope: "shared",
        mode: "Default",
        preview: "",
        fallback: "",
        privateValue: "",
      },
    ]);
    setSelectedId(id);
  };

  return (
    <section
      class={
        props.embedded ? "flex h-full min-h-0 flex-col bg-[var(--background-deep)]" : productPage
      }
    >
      <div
        class={
          props.embedded
            ? "flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border-weak-base px-4"
            : productPageHero
        }
      >
        <div class="min-w-0">
          <Show when={!props.embedded}>
            <span class={eyebrow}>Variables</span>
          </Show>
          <h2
            class={
              props.embedded
                ? "m-0 mt-0.5 truncate text-title font-semibold tracking-[-0.015em] text-text-strong"
                : productPageTitle
            }
          >
            Variables
          </h2>
          <Show when={!props.embedded}>
            <p class={productPageLead}>
              Languages, accounts, models, and other lists a run can vary. A Combine multiplies
              selected values by the tests you choose.
            </p>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="lg" onClick={props.onConfigureProvider}>
            Accounts
          </Button>
          <Button variant="primary" size="lg" onClick={addRow}>
            <Icon name="plus" size={15} /> New variable
          </Button>
          <Show when={props.embedded && props.onClose}>
            <button
              type="button"
              class={productIconButton}
              aria-label="Close variables"
              onClick={() => props.onClose?.()}
            >
              <Icon name="x" size={14} />
            </button>
          </Show>
        </div>
      </div>
      <div
        class={cn(
          "mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-3",
          selectedRow() && "grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)] max-[900px]:grid-cols-1",
          props.embedded && "min-h-0 flex-1 overflow-y-auto p-4",
        )}
      >
        <div class="min-w-0 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger shadow-[0_1px_2px_rgb(0_0_0/4%)]">
          <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_88px_100px_minmax(0,1fr)_18px] items-center gap-3 border-b border-border-weak-base bg-surface-weak px-3 text-micro/[1.25] font-semibold tracking-wide text-text-weaker uppercase max-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18px]">
            <span>Variable</span>
            <span class="max-[900px]:hidden">Scope</span>
            <span class="max-[900px]:hidden">Source</span>
            <span>Preview</span>
            <span />
          </div>
          <For each={rows()}>
            {(row) => (
              <button
                type="button"
                aria-current={selectedId() === row.id ? "true" : undefined}
                class={cn(
                  "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_88px_100px_minmax(0,1fr)_18px] items-center gap-3 border-b border-border-weak-base px-3 text-left last:border-b-0 hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-strong-focus max-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18px]",
                  selectedId() === row.id && "bg-surface-base-active",
                )}
                onClick={() => setSelectedId(row.id)}
              >
                <span class={copyStack}>
                  <strong class={`${copyTitle} block truncate text-body`}>{row.name}</strong>
                  <small class={`${copyDescription} block truncate text-micro text-text-weaker`}>
                    {draftIds().has(row.id)
                      ? "Not saved yet"
                      : row.scope === "private"
                        ? "Value stays on this computer"
                        : row.mode === "List"
                          ? `${row.values?.length ?? 0} allowed values`
                          : "Shared across tests"}
                  </small>
                </span>
                <span class="w-fit rounded-md bg-surface-weak px-2 py-1 text-micro/[1.25] text-text-weak max-[900px]:hidden">
                  {row.scope === "private" ? "Private" : "Shared"}
                </span>
                <span
                  class={cn(
                    "w-fit rounded-md bg-surface-weak px-2 py-1 text-micro/[1.25] text-text-weak max-[900px]:hidden",
                    row.mode === "AI" && "bg-surface-info-weak text-text-info-base",
                  )}
                >
                  {row.mode === "AI" ? "Generated" : row.mode === "List" ? "List" : "Fixed"}
                </span>
                <span class="min-w-0 truncate text-caption/[1.3] text-text-weak">
                  {row.scope === "private"
                    ? row.privateValue
                      ? "Set locally"
                      : "Needs a value"
                    : row.preview || row.fallback || "No value"}
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            )}
          </For>
          <Show when={rows().length === 0}>
            <div class="grid min-h-56 place-items-center px-6 py-10 text-center">
              <div class="max-w-[360px]">
                <span class="mx-auto grid size-10 place-items-center rounded-xl bg-surface-info-weak text-text-info-base">
                  <Icon name="grid" size={17} />
                </span>
                <strong class="mt-3 block text-body/[1.3] text-text-strong">
                  Add a variable only when a test needs it
                </strong>
                <p class="m-0 mt-1.5 text-caption/[1.5] text-text-weaker">
                  Use a list to cover plans or roles. Language and theme can drive a data run. Keep
                  logins private so each teammate can use their own account.
                </p>
                <Button variant="primary" size="lg" class="mt-4" onClick={addRow}>
                  <Icon name="plus" size={14} /> Add a variable
                </Button>
              </div>
            </div>
          </Show>
        </div>
        <Show when={selectedRow()}>
          {(row) => (
            <aside
              class="min-w-0 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger"
              aria-label={`Edit ${row().name}`}
            >
              <header class="flex min-h-16 items-center justify-between border-b border-border-weak-base px-4">
                <div class="min-w-0">
                  <span class={eyebrow}>Variable</span>
                  <strong class="mt-1 block truncate text-title/[1.25] text-text-base">
                    {row().name}
                  </strong>
                </div>
                <button
                  type="button"
                  class="grid size-10 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                  aria-label="Close variable editor"
                  onClick={() => setSelectedId(null)}
                >
                  <Icon name="x" size={14} />
                </button>
              </header>
              <div class="grid gap-4 p-4">
                <fieldset class="grid gap-1.5 border-0 p-0">
                  <legend class="text-caption/[1.25] font-semibold text-text-weak">
                    Who can see the value
                  </legend>
                  <div class="grid grid-cols-2 gap-1 rounded-lg bg-surface-weak p-1">
                    <For each={["shared", "private"] as const}>
                      {(scope) => (
                        <button
                          type="button"
                          class={cn(
                            "min-h-10 rounded-md px-2 text-caption font-medium text-text-weak transition-colors duration-hover",
                            row().scope === scope &&
                              "bg-background-stronger text-text-strong shadow-[0_1px_2px_rgb(0_0_0/8%)]",
                          )}
                          aria-pressed={row().scope === scope}
                          onClick={() => {
                            if (scope === "private" && row().scope === "shared") {
                              writeSharedVariableDraft(server.projectId(), row().id, {
                                mode: row().mode,
                                preview: row().preview,
                                ...(row().values ? { values: row().values } : {}),
                                fallback: row().fallback,
                              });
                            }
                            patchRow(row().id, dataSourceScopePatch(row(), scope));
                          }}
                        >
                          {scope === "shared" ? "Project" : "Only me"}
                        </button>
                      )}
                    </For>
                  </div>
                  <small class="text-micro/[1.4] text-text-weaker">
                    {row().scope === "private"
                      ? "The definition is shared; your value stays in this app on this computer."
                      : "Project values sync with the map and are visible to collaborators."}
                  </small>
                </fieldset>
                <label class="grid gap-1.5">
                  <span class="text-caption/[1.25] font-semibold text-text-weak">Name</span>
                  <input
                    class={fieldClass}
                    value={row().name}
                    spellcheck={false}
                    onInput={(event) => patchRow(row().id, { name: event.currentTarget.value })}
                  />
                </label>
                <DataSourceControl
                  scope={row().scope}
                  mode={row().mode}
                  class={fieldClass}
                  onModeChange={(mode) => patchRow(row().id, dataSourceModePatch(mode))}
                />
                <Show
                  when={row().scope === "private"}
                  fallback={
                    <Show
                      when={row().mode === "List"}
                      fallback={
                        <label class="grid gap-1.5">
                          <span class="text-caption/[1.25] font-semibold text-text-weak">
                            {row().mode === "AI" ? "Generation prompt" : "Value"}
                          </span>
                          <textarea
                            class={fieldClass}
                            value={row().preview}
                            rows={4}
                            onInput={(event) =>
                              patchRow(row().id, { preview: event.currentTarget.value })
                            }
                          />
                        </label>
                      }
                    >
                      <label class="grid gap-1.5">
                        <span class="text-caption/[1.25] font-semibold text-text-weak">
                          Allowed values
                        </span>
                        <textarea
                          class={fieldClass}
                          value={(row().values ?? [row().preview]).join("\n")}
                          rows={7}
                          placeholder="One value per line"
                          onInput={(event) => {
                            const values = event.currentTarget.value
                              .split("\n")
                              .map((value) => value.trim())
                              .filter(Boolean);
                            patchRow(row().id, { values, preview: values[0] ?? "" });
                          }}
                        />
                      </label>
                    </Show>
                  }
                >
                  <label class="grid gap-1.5">
                    <span class="text-caption/[1.25] font-semibold text-text-weak">Your value</span>
                    <input
                      class={fieldClass}
                      type="password"
                      autocomplete="off"
                      value={row().privateValue}
                      placeholder="Stored only on this computer"
                      onInput={(event) => {
                        const privateValue = event.currentTarget.value;
                        patchRow(row().id, { privateValue });
                        writePrivateVariableValue(server.projectId(), row().id, privateValue);
                      }}
                    />
                  </label>
                </Show>
                <Show when={row().scope === "shared"}>
                  <label class="grid gap-1.5">
                    <span class="text-caption/[1.25] font-semibold text-text-weak">
                      Safe fallback
                    </span>
                    <textarea
                      class={fieldClass}
                      value={row().fallback}
                      rows={3}
                      onInput={(event) =>
                        patchRow(row().id, { fallback: event.currentTarget.value })
                      }
                    />
                    <small class="text-micro/[1.3] text-text-weaker">
                      Used when generation is unavailable.
                    </small>
                  </label>
                </Show>
              </div>
              <footer class="flex min-h-14 items-center justify-between gap-3 border-t border-border-weak-base px-4">
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-caption/[1.25] text-text-critical-base hover:bg-surface-critical-weak"
                  onClick={() => deleteRow(row().id)}
                >
                  <Icon name="trash" size={14} /> Delete variable
                </button>
                <span class="text-micro/[1.25] text-text-weaker">
                  {draftIds().has(row().id)
                    ? "Edit anything to save"
                    : "Changes save automatically"}
                </span>
              </footer>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
}

export function variableToDataRow(
  variable: TestData,
  privateValue = "",
  sharedDraft?: SharedVariableDraft,
): DataRow {
  const privateDraft = variable.scope === "private" ? sharedDraft : undefined;
  return {
    id: variable.id,
    name: variable.name,
    scope: variable.scope ?? "shared",
    mode:
      variable.scope === "private"
        ? "Default"
        : variable.source === "generated"
          ? "AI"
          : variable.source === "list"
            ? "List"
            : "Default",
    ...(privateDraft ? { sharedMode: privateDraft.mode } : {}),
    preview:
      privateDraft?.preview ?? variable.values?.[0] ?? variable.prompt ?? variable.fallback ?? "",
    ...(privateDraft?.values
      ? { values: privateDraft.values }
      : variable.source === "list"
        ? { values: variable.values ?? [] }
        : {}),
    fallback: privateDraft?.fallback ?? variable.fallback ?? "",
    privateValue,
  };
}

export function dataRowToVariable(row: DataRow): TestData {
  const values =
    row.mode === "List"
      ? (row.values ?? [row.preview]).map((value) => value.trim()).filter(Boolean)
      : row.mode === "AI"
        ? undefined
        : [row.preview];
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    source: row.mode === "AI" ? "generated" : row.mode === "List" ? "list" : "static",
    prompt: row.scope === "shared" && row.mode === "AI" ? row.preview : undefined,
    values: row.scope === "shared" ? values : undefined,
    fallback: row.scope === "shared" ? row.fallback : undefined,
  };
}
