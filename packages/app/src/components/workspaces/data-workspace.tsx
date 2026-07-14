import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { TestVariable } from "@relay/protocol";
import { useServer } from "../../context/server";
import { toast } from "../../context/toast";
import { cn } from "../../lib/cn";
import { Icon } from "../icon";

type DataRow = {
  id: string;
  name: string;
  mode: "AI" | "List" | "Default";
  preview: string;
  values?: string[];
  fallback: string;
};

const INITIAL_DATA: DataRow[] = [
  {
    id: "daily-question",
    name: "daily_question",
    mode: "AI",
    preview: "Where is Paris located?",
    fallback: "What is the capital of France?",
  },
  {
    id: "image-prompt",
    name: "image_prompt",
    mode: "AI",
    preview: "A tram crossing Lisbon at dusk",
    fallback: "A red bicycle beside a lake",
  },
  { id: "account-tier", name: "account_tier", mode: "List", preview: "Pro", fallback: "Free" },
  {
    id: "login-email",
    name: "login_email",
    mode: "List",
    preview: "qa.primary@example.test",
    values: ["qa.primary@example.test", "qa.secondary@example.test"],
    fallback: "qa.primary@example.test",
  },
];

const fieldClass =
  "w-full rounded-lg border border-border-weak-base bg-background-base px-2.5 py-2 text-[13px]/[1.4] text-text-base outline-none focus:border-border-focus focus:ring-2 focus:ring-surface-info-weak";

export function DataWorkspace(props: { onConfigureProvider: () => void }) {
  const server = useServer();
  const [rows, setRows] = createSignal<DataRow[]>(INITIAL_DATA);
  const [hydrated, setHydrated] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const selectedRow = () => rows().find((row) => row.id === selectedId()) ?? null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const remote = server.projectVariables();
    if (remote.updatedAt <= 0 || hydrated()) return;
    setRows(remote.value.length ? remote.value.map(variableToDataRow) : INITIAL_DATA);
    setHydrated(true);
  });
  createEffect(() => {
    const value = rows();
    if (!hydrated()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void server
        .saveProjectVariables(value.map(dataRowToVariable))
        .catch((error: unknown) =>
          toast(error instanceof Error ? error.message : String(error), "error"),
        );
    }, 450);
  });
  onCleanup(() => clearTimeout(saveTimer));

  const patchRow = (id: string, changes: Partial<DataRow>) =>
    setRows((items) => items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  const deleteRow = (id: string) => {
    setRows((items) => items.filter((item) => item.id !== id));
    if (selectedId() === id) setSelectedId(null);
  };
  const addRow = () => {
    const id = crypto.randomUUID();
    setRows((current) => [
      ...current,
      {
        id,
        name: `variable_${current.length + 1}`,
        mode: "Default",
        preview: "Sample value",
        fallback: "Fallback value",
      },
    ]);
    setSelectedId(id);
  };

  return (
    <section class="relay-page">
      <div class="relay-page__hero">
        <div>
          <span class="relay-eyebrow">Variables</span>
          <h2>Test data</h2>
          <p>
            Prepare fresh inputs before a run while keeping every test deterministic and debuggable.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="relay-secondary" onClick={props.onConfigureProvider}>
            Generation settings
          </button>
          <button type="button" class="relay-primary" onClick={addRow}>
            <Icon name="plus" size={15} /> New variable
          </button>
        </div>
      </div>
      <div
        class={cn(
          "mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-3",
          selectedRow() && "grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)] max-[900px]:grid-cols-1",
        )}
      >
        <div class="min-w-0 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger">
          <div class="grid min-h-9 grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_18px] items-center gap-3 border-b border-border-weak-base bg-surface-weak px-3 text-[10px]/[1.25] font-semibold tracking-wide text-text-weaker uppercase">
            <span>Variable</span>
            <span>Source</span>
            <span>Preview</span>
            <span />
          </div>
          <For each={rows()}>
            {(row) => (
              <button
                type="button"
                aria-current={selectedId() === row.id ? "true" : undefined}
                class={cn(
                  "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_18px] items-center gap-3 border-b border-border-weak-base px-3 text-left last:border-b-0 hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
                  selectedId() === row.id && "bg-surface-base-active",
                )}
                onClick={() => setSelectedId(row.id)}
              >
                <span class="min-w-0">
                  <strong class="block truncate text-[13px]/[1.25] text-text-base">
                    {row.name}
                  </strong>
                  <small class="mt-1 block truncate text-[10px]/[1.25] text-text-weaker">
                    {row.mode === "List"
                      ? `${row.values?.length ?? 1} allowed values`
                      : "Shared across tests"}
                  </small>
                </span>
                <span
                  class={cn(
                    "w-fit rounded-md bg-surface-weak px-2 py-1 text-[10px]/[1.25] text-text-weak",
                    row.mode === "AI" && "bg-surface-info-weak text-text-info-base",
                  )}
                >
                  {row.mode === "AI" ? "Generated" : row.mode === "List" ? "List" : "Fixed"}
                </span>
                <span class="min-w-0 truncate text-[11px]/[1.3] text-text-weak">
                  {row.preview || row.fallback || "No value"}
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            )}
          </For>
        </div>
        <Show when={selectedRow()}>
          {(row) => (
            <aside
              class="min-w-0 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger"
              aria-label={`Edit ${row().name}`}
            >
              <header class="flex min-h-16 items-center justify-between border-b border-border-weak-base px-4">
                <div class="min-w-0">
                  <span class="relay-eyebrow">Variable</span>
                  <strong class="mt-1 block truncate text-[16px]/[1.25] text-text-base">
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
                <label class="grid gap-1.5">
                  <span class="text-[11px]/[1.25] font-semibold text-text-weak">Name</span>
                  <input
                    class={fieldClass}
                    value={row().name}
                    spellcheck={false}
                    onInput={(event) => patchRow(row().id, { name: event.currentTarget.value })}
                  />
                </label>
                <label class="grid gap-1.5">
                  <span class="text-[11px]/[1.25] font-semibold text-text-weak">
                    How to choose it
                  </span>
                  <select
                    class={fieldClass}
                    value={row().mode}
                    onChange={(event) =>
                      patchRow(row().id, { mode: event.currentTarget.value as DataRow["mode"] })
                    }
                  >
                    <option value="AI">Generate with AI</option>
                    <option value="List">Choose from a list</option>
                    <option value="Default">Fixed value</option>
                  </select>
                </label>
                <Show
                  when={row().mode === "List"}
                  fallback={
                    <label class="grid gap-1.5">
                      <span class="text-[11px]/[1.25] font-semibold text-text-weak">
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
                    <span class="text-[11px]/[1.25] font-semibold text-text-weak">
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
                <label class="grid gap-1.5">
                  <span class="text-[11px]/[1.25] font-semibold text-text-weak">Safe fallback</span>
                  <textarea
                    class={fieldClass}
                    value={row().fallback}
                    rows={3}
                    onInput={(event) => patchRow(row().id, { fallback: event.currentTarget.value })}
                  />
                  <small class="text-[10px]/[1.3] text-text-weaker">
                    Used when generation is unavailable.
                  </small>
                </label>
              </div>
              <footer class="flex min-h-14 items-center justify-between gap-3 border-t border-border-weak-base px-4">
                <button
                  type="button"
                  class="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px]/[1.25] text-text-critical-base hover:bg-surface-critical-weak"
                  onClick={() => deleteRow(row().id)}
                >
                  <Icon name="trash" size={14} /> Delete variable
                </button>
                <span class="text-[10px]/[1.25] text-text-weaker">Changes save automatically</span>
              </footer>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
}

function variableToDataRow(variable: TestVariable): DataRow {
  return {
    id: variable.id,
    name: variable.name,
    mode: variable.source === "generated" ? "AI" : variable.source === "list" ? "List" : "Default",
    preview: variable.values?.[0] ?? variable.prompt ?? variable.fallback,
    ...(variable.source === "list" ? { values: variable.values ?? [] } : {}),
    fallback: variable.fallback,
  };
}

function dataRowToVariable(row: DataRow): TestVariable {
  const values =
    row.mode === "List"
      ? (row.values ?? [row.preview]).map((value) => value.trim()).filter(Boolean)
      : row.mode === "AI"
        ? undefined
        : [row.preview];
  return {
    id: row.id,
    name: row.name,
    source: row.mode === "AI" ? "generated" : row.mode === "List" ? "list" : "static",
    prompt: row.mode === "AI" ? row.preview : undefined,
    values,
    fallback: row.fallback,
  };
}
