import { For, Show, createMemo, createSignal } from "solid-js";
import type { AppMapVariable, AppMapVariableKind } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import {
  assignableSwitcherConnections,
  taughtExampleFromSnapshotNode,
  teachableLocaleRows,
} from "../lib/app-map-locale-teach";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

const KINDS: Array<{ id: AppMapVariableKind; label: string }> = [
  { id: "language", label: "Language" },
  { id: "location", label: "Location" },
  { id: "theme", label: "Theme" },
  { id: "account", label: "Account" },
  { id: "workspace", label: "Workspace" },
  { id: "build", label: "Build" },
  { id: "custom", label: "Custom" },
];

type LiveRow = { identifier?: string; label?: string; value?: string };
type SourceMode = "device" | "manual";

function rowKey(row: LiveRow): string {
  return `${row.identifier ?? ""}|${row.label ?? row.value ?? ""}`;
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "value"
  );
}

function uniqueVariableId(existing: Record<string, unknown>, label: string): string {
  const base = slug(label);
  if (!existing[base]) return base;
  let suffix = 2;
  while (existing[`${base}-${suffix}`]) suffix += 1;
  return `${base}-${suffix}`;
}

export function AppMapStateSetEditor(props: {
  variable?: AppMapVariable;
  onSaved: (id: string) => void;
  onDelete?: () => void;
  onCancel: () => void;
  onOpenDevice: () => void;
}) {
  const server = useServer();
  const existingListApply = () =>
    props.variable?.apply.kind === "list" ? props.variable.apply : undefined;
  const [sourceMode, setSourceMode] = createSignal<SourceMode>(
    props.variable ? "manual" : "device",
  );
  const [kind, setKind] = createSignal<AppMapVariableKind>(props.variable?.kind ?? "language");
  const [name, setName] = createSignal(props.variable?.name ?? "");
  const [manualText, setManualText] = createSignal(
    props.variable?.options.map((option) => option.label ?? option.text ?? option.id).join("\n") ??
      "",
  );
  const [rows, setRows] = createSignal<LiveRow[]>(props.variable?.options ?? []);
  const [selectedKeys, setSelectedKeys] = createSignal<string[]>(
    (props.variable?.options ?? []).slice(0, 2).map(rowKey),
  );
  const [inConnectionId, setInConnectionId] = createSignal(
    existingListApply()?.inConnectionId ?? "",
  );
  const [outConnectionId, setOutConnectionId] = createSignal(
    existingListApply()?.outConnectionId ?? "",
  );
  const [reading, setReading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [pathsOpen, setPathsOpen] = createSignal(true);
  const map = createMemo(() => server.selectedAppMap());
  const connections = createMemo(() => {
    const current = map();
    return current ? assignableSwitcherConnections(current) : [];
  });
  const pickedRows = createMemo(() => {
    const selected = new Set(selectedKeys());
    return rows()
      .filter((row) => selected.has(rowKey(row)))
      .slice(0, 2);
  });
  const manualRows = createMemo(() => {
    const seen = new Set<string>();
    return manualText()
      .split(/\r?\n/)
      .map((label) => label.trim())
      .filter((label) => {
        const key = label.toLocaleLowerCase();
        if (!label || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 100);
  });
  const canCreate = createMemo(() =>
    sourceMode() === "device" ? pickedRows().length > 0 : manualRows().length > 0,
  );

  async function readCurrentList() {
    setReading(true);
    try {
      const snapshot = await server.captureUiSnapshot();
      const next = teachableLocaleRows(snapshot?.nodes ?? [], 24);
      setRows(next);
      setSelectedKeys([]);
      if (!next.length) toast("Open the list on the device, then read it again", "warning");
    } catch (error) {
      toast(humanError(error, "Could not read the current screen"), "error");
    } finally {
      setReading(false);
    }
  }

  function toggleRow(row: LiveRow) {
    const key = rowKey(row);
    setSelectedKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      return [...current.slice(-1), key];
    });
  }

  async function createSet() {
    const currentMap = map();
    if (!currentMap || !canCreate()) return;
    setSaving(true);
    try {
      const now = Date.now();
      const fallbackName = KINDS.find((item) => item.id === kind())?.label ?? "Modifier";
      const variable =
        sourceMode() === "device"
          ? (
              await server.inferVariableFromDevice(
                rows(),
                pickedRows().map((row) => {
                  const example = taughtExampleFromSnapshotNode(row);
                  return {
                    id: example.locale,
                    ...(example.identifier ? { identifier: example.identifier } : {}),
                    ...(example.label ? { label: example.label } : {}),
                  };
                }),
                {
                  kind: kind(),
                  name: name().trim() || fallbackName,
                  appMapId: currentMap.id,
                  ...(inConnectionId() ? { inConnectionId: inConnectionId() } : {}),
                  ...(outConnectionId() ? { outConnectionId: outConnectionId() } : {}),
                },
              )
            ).variable
          : {
              id:
                props.variable?.id ??
                uniqueVariableId(currentMap.variables, name().trim() || fallbackName),
              name: name().trim() || fallbackName,
              kind: kind(),
              apply: {
                ...existingListApply(),
                kind: "list" as const,
                ...(inConnectionId() ? { inConnectionId: inConnectionId() } : {}),
                ...(outConnectionId() ? { outConnectionId: outConnectionId() } : {}),
              },
              options: manualRows().map((label, index) => {
                const existing = props.variable?.options.find(
                  (option) =>
                    (option.label ?? option.text ?? option.id).toLocaleLowerCase() ===
                    label.toLocaleLowerCase(),
                );
                return existing
                  ? { ...existing, label }
                  : { id: `${slug(label)}-${index + 1}`, label };
              }),
            };
      await server.saveVariable({
        appMapId: currentMap.id,
        expectedRevision: currentMap.revision,
        variable: {
          ...variable,
          id: props.variable?.id ?? variable.id,
          organizationId: currentMap.organizationId,
          projectId: currentMap.projectId,
          appMapId: currentMap.id,
          createdAt: props.variable?.createdAt ?? now,
          updatedAt: now,
        },
      });
      await server.refreshAppMaps();
      toast(
        `${props.variable ? "Updated" : "Created"} ${variable.name} with ${variable.options.length} values`,
        "success",
      );
      props.onSaved(props.variable?.id ?? variable.id);
    } catch (error) {
      toast(humanError(error, "Could not save this modifier"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section class="grid w-full gap-3" aria-labelledby="modifier-editor-title">
      <div>
        <h3
          id="modifier-editor-title"
          class="m-0 text-[13px] font-semibold text-[var(--text-strong)]"
        >
          {props.variable ? `Edit ${props.variable.name}` : "New modifier"}
        </h3>
        <p class="m-0 mt-1 max-w-[52ch] text-[11.5px]/[1.45] text-[var(--text-weak)]">
          A modifier changes one thing before a test—such as language, account, theme, or model.
          Relay applies a value, returns to the test start, and repeats.
        </p>
      </div>

      <div
        class="grid grid-cols-2 gap-1 rounded-[9px] bg-[var(--surface-base)] p-1"
        role="tablist"
        aria-label="How Relay learns modifier values"
      >
        <For
          each={[
            { id: "device" as const, label: "Read an open list" },
            { id: "manual" as const, label: "Enter labels" },
          ]}
        >
          {(source) => (
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode() === source.id}
              class={cn(
                "min-h-10 rounded-[7px] px-2 text-[11.5px] font-medium",
                sourceMode() === source.id
                  ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[var(--shadow-xs-border-base)]"
                  : "text-[var(--text-weak)] hover:text-[var(--text-strong)]",
              )}
              onClick={() => setSourceMode(source.id)}
            >
              {source.label}
            </button>
          )}
        </For>
      </div>

      <label class="grid gap-1.5">
        <span class="text-[10.5px] font-medium text-[var(--text-base)]">Name</span>
        <input
          class="h-10 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-[13px] text-[var(--text-strong)] placeholder:text-[var(--text-weaker)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
          value={name()}
          placeholder={KINDS.find((item) => item.id === kind())?.label ?? "Modifier"}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>

      <label class="grid gap-1.5">
        <span class="text-[10.5px] font-medium text-[var(--text-base)]">What changes?</span>
        <select
          class="h-10 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-[13px] text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
          value={kind()}
          onChange={(event) => setKind(event.currentTarget.value as AppMapVariableKind)}
        >
          <For each={KINDS}>{(item) => <option value={item.id}>{item.label}</option>}</For>
        </select>
      </label>

      <Show
        when={sourceMode() === "device"}
        fallback={
          <label class="grid gap-1.5">
            <span class="flex items-center justify-between gap-2 text-[10.5px] font-medium text-[var(--text-base)]">
              Labels Relay should tap
              <span class="font-normal text-[var(--text-weak)]">One per line</span>
            </span>
            <textarea
              class="min-h-36 resize-y rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-[13px]/[1.5] text-[var(--text-strong)] placeholder:text-[var(--text-weaker)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
              value={manualText()}
              placeholder={"English\nPortuguês\n日本語"}
              onInput={(event) => setManualText(event.currentTarget.value)}
            />
            <span class="text-[10.5px] text-[var(--text-weak)]">
              Relay looks for each label in the value list. You can set the paths below.
            </span>
          </label>
        }
      >
        <div class="grid gap-2">
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={props.onOpenDevice}>
              <Icon name="smartphone" size={12} /> Show device
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={reading()}
              onClick={() => void readCurrentList()}
            >
              <Icon
                name="refresh"
                size={12}
                class={reading() ? "ui-refresh-spin motion-reduce:opacity-70" : undefined}
              />
              {reading() ? "Reading…" : "Read current list"}
            </Button>
          </div>

          <Show
            when={rows().length}
            fallback={
              <div class="rounded-[9px] bg-[var(--surface-base)] px-3 py-4 text-center">
                <strong class="block text-[12px] text-[var(--text-strong)]">
                  Open the list on your device
                </strong>
                <span class="mt-1 block text-[11px] text-[var(--text-weak)]">
                  Then choose Read current list and mark one or two examples.
                </span>
              </div>
            }
          >
            <div
              class="grid max-h-56 gap-1 overflow-y-auto overscroll-contain rounded-[9px] border border-[var(--border-weak-base)] p-1.5"
              onWheel={(event) => event.stopPropagation()}
            >
              <For each={rows()}>
                {(row) => {
                  const selected = () => selectedKeys().includes(rowKey(row));
                  return (
                    <button
                      type="button"
                      class={cn(
                        "flex min-h-10 items-center gap-2 rounded-[7px] px-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]",
                        selected()
                          ? "bg-[var(--product-accent-soft)] text-[var(--text-strong)]"
                          : "text-[var(--text-base)] hover:bg-[var(--surface-base-hover)]",
                      )}
                      aria-pressed={selected()}
                      onClick={() => toggleRow(row)}
                    >
                      <span
                        class={cn(
                          "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                          selected()
                            ? "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]"
                            : "border-[var(--border-strong-base)]",
                        )}
                      >
                        <Show when={selected()}>
                          <Icon name="check" size={9} />
                        </Show>
                      </span>
                      <span class="min-w-0 flex-1 truncate text-[12px]">
                        {row.label ?? row.value}
                      </span>
                      <Show when={selected()}>
                        <span class="text-[10px] text-[var(--text-weak)]">Example</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <button
        type="button"
        class="flex min-h-10 items-center justify-between rounded-[8px] px-2 text-left text-[11.5px] text-[var(--text-base)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
        aria-expanded={pathsOpen()}
        onClick={() => setPathsOpen((open) => !open)}
      >
        <span>Where is the list?</span>
        <span class="flex items-center gap-1 text-[10.5px] text-[var(--text-weak)]">
          Set start and return paths
          <Icon name={pathsOpen() ? "chevron-up" : "chevron-down"} size={11} />
        </span>
      </button>
      <Show when={pathsOpen()}>
        <div class="grid gap-2 rounded-[9px] bg-[var(--surface-base)] p-2.5">
          <label class="grid gap-1">
            <span class="text-[10.5px] text-[var(--text-base)]">Open the value list with</span>
            <select
              class="h-10 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-[12px]"
              value={inConnectionId()}
              onChange={(event) => setInConnectionId(event.currentTarget.value)}
            >
              <option value="">The list is already open</option>
              <For each={connections()}>
                {(item) => <option value={item.id}>{item.label}</option>}
              </For>
            </select>
          </label>
          <label class="grid gap-1">
            <span class="text-[10.5px] text-[var(--text-base)]">After choosing a value</span>
            <select
              class="h-10 rounded-[8px] border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-[12px]"
              value={outConnectionId()}
              onChange={(event) => setOutConnectionId(event.currentTarget.value)}
            >
              <option value="">The resulting screen is the test start</option>
              <For each={connections()}>
                {(item) => <option value={item.id}>{item.label}</option>}
              </For>
            </select>
          </label>
        </div>
      </Show>

      <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-weak-base)] pt-3">
        <Show when={props.variable && props.onDelete} fallback={<span />}>
          <Button
            variant="ghost"
            class="text-[var(--icon-critical-base)] hover:text-[var(--icon-critical-base)]"
            onClick={() => props.onDelete?.()}
          >
            <Icon name="trash" size={12} /> Delete modifier
          </Button>
        </Show>
        <div class="flex items-center gap-2">
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving() || !canCreate()}
            onClick={() => void createSet()}
          >
            {saving() ? "Saving…" : props.variable ? "Save modifier" : "Create modifier"}
          </Button>
        </div>
      </footer>
    </section>
  );
}
