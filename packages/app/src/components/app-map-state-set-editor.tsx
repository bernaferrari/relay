import { For, Show, createMemo, createSignal } from "solid-js";
import { panelSectionLabel } from "../lib/ui";
import type { AppMapVariable, AppMapVariableKind } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "../lib/human-error";
import {
  assignableSwitcherConnections,
  inspectVisibleList,
  taughtExampleFromSnapshotNode,
} from "../lib/app-map-locale-teach";
import { suggestedAndroidAppPackage } from "../lib/app-map-android-package";
import { cn } from "../lib/cn";
import { plural } from "../lib/plural";
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
type SourceMode = "device" | "manual" | "android";
type ReadStatus = { tone: "info" | "warning" | "success"; message: string };

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
  const map = createMemo(() => server.selectedAppMap());
  const suggestedPackage = createMemo(() => suggestedAndroidAppPackage(map()));
  const existingListApply = () =>
    props.variable?.apply.kind === "list" ? props.variable.apply : undefined;
  const [sourceMode, setSourceMode] = createSignal<SourceMode>(
    props.variable?.apply.kind === "appLocale"
      ? "android"
      : props.variable
        ? "manual"
        : suggestedPackage()
          ? "android"
          : "device",
  );
  const [kind, setKind] = createSignal<AppMapVariableKind>(props.variable?.kind ?? "language");
  const [name, setName] = createSignal(props.variable?.name ?? "");
  const [manualText, setManualText] = createSignal(
    props.variable?.options.map((option) => option.label ?? option.text ?? option.id).join("\n") ??
      "",
  );
  const [androidPackage, setAndroidPackage] = createSignal(
    props.variable?.apply.kind === "appLocale"
      ? props.variable.apply.app
      : (suggestedPackage() ?? ""),
  );
  const [localeText, setLocaleText] = createSignal(
    props.variable?.apply.kind === "appLocale"
      ? props.variable.options
          .map((option) => `${option.id}${option.label ? ` | ${option.label}` : ""}`)
          .join("\n")
      : "",
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
  const [readStatus, setReadStatus] = createSignal<ReadStatus>();
  const [discoveringLocales, setDiscoveringLocales] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [pathsOpen, setPathsOpen] = createSignal(true);
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
  const localeRows = createMemo(() => {
    const seen = new Set<string>();
    return localeText()
      .split(/\r?\n/)
      .map((line) => {
        const [id = "", label = ""] = line.split("|").map((part) => part.trim());
        return { id, label };
      })
      .filter((row) => {
        if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(row.id) || seen.has(row.id)) {
          return false;
        }
        seen.add(row.id);
        return true;
      })
      .slice(0, 100);
  });
  const canCreate = createMemo(() => {
    if (sourceMode() === "device") return pickedRows().length > 0;
    if (sourceMode() === "android") return Boolean(androidPackage().trim() && localeRows().length);
    return manualRows().length > 0;
  });

  async function readCurrentList() {
    setReading(true);
    try {
      const snapshot = await server.captureUiSnapshot();
      const device = server.devices().find((item) => item.serial === server.selectedDevice());
      const deviceName = device?.name?.trim() || device?.serial || "the selected device";
      if (!snapshot) {
        const message = `Relay could not read visible controls from ${deviceName}. Open the device, show the value list, then try again.`;
        setRows([]);
        setSelectedKeys([]);
        setReadStatus({ tone: "warning", message });
        toast(message, "warning");
        return;
      }
      if (snapshot.inspectable === false && !snapshot.nodes.length) {
        const issue = snapshot.inspectionError?.trim();
        const message = issue
          ? `${issue} Open the device after resolving that, show the value list, then try again.`
          : `Relay cannot read visible controls from ${deviceName} yet. Open the device, resolve its setup, then show the value list and try again.`;
        setRows([]);
        setSelectedKeys([]);
        setReadStatus({ tone: "warning", message });
        toast(message, "warning");
        return;
      }
      const read = inspectVisibleList(snapshot.nodes, kind(), 24);
      if (read.status !== "ready") {
        const message =
          read.status === "empty"
            ? "No selectable values are visible. Open the value list on the device, then read it again."
            : read.context === "file-picker"
              ? "Relay is seeing a file picker, not language options. Close it, open the app’s language picker, then read the visible list. For Android’s declared locales, choose App languages."
              : "Relay cannot recognize language options on this screen. Open the app’s language picker, or choose App languages for Android’s declared locales.";
        setRows([]);
        setSelectedKeys([]);
        setReadStatus({ tone: "warning", message });
        toast(message, "warning");
        return;
      }
      setRows(read.rows);
      setSelectedKeys([]);
      const message = `Read ${read.rows.length} visible value${read.rows.length === 1 ? "" : "s"}. Select one or two examples to teach Relay.`;
      setReadStatus({ tone: "success", message });
      toast(message, "success");
    } catch (error) {
      const message = humanError(error, "Could not read the current screen");
      setReadStatus({ tone: "warning", message });
      toast(message, "error");
    } finally {
      setReading(false);
    }
  }

  async function discoverAndroidLocales() {
    const packageName = androidPackage().trim();
    if (!packageName) {
      toast("Enter the Android app package first", "warning");
      return;
    }
    setDiscoveringLocales(true);
    try {
      const locales = await server.loadAndroidAppLocales(packageName);
      if (!locales.length) {
        toast("This app does not declare an Android locale list — enter tags manually", "warning");
        return;
      }
      const lines = locales.map((tag) => {
        try {
          const label = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
          return `${tag}${label ? ` | ${label}` : ""}`;
        } catch {
          return tag;
        }
      });
      setLocaleText(lines.join("\n"));
      toast(`Found ${locales.length} app languages`, "success");
    } catch (error) {
      toast(humanError(error, "Could not read this app's languages"), "error");
    } finally {
      setDiscoveringLocales(false);
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
      const fallbackName = KINDS.find((item) => item.id === kind())?.label ?? "Variable";
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
          : sourceMode() === "android"
            ? {
                id:
                  props.variable?.id ??
                  uniqueVariableId(currentMap.variables, name().trim() || fallbackName),
                name: name().trim() || fallbackName,
                kind: "language" as const,
                apply: { kind: "appLocale" as const, app: androidPackage().trim() },
                options: localeRows().map((row) => ({
                  id: row.id,
                  ...(row.label ? { label: row.label } : {}),
                })),
                restoreId: localeRows()[0]?.id,
              }
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
        `${props.variable ? "Updated" : "Created"} ${variable.name} with ${plural(variable.options.length, "value")}`,
        "success",
      );
      props.onSaved(props.variable?.id ?? variable.id);
    } catch (error) {
      toast(humanError(error, "Could not save this variable"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section class="grid w-full gap-3" aria-labelledby="variable-editor-title">
      <div>
        <h3
          id="variable-editor-title"
          class="m-0 text-body font-semibold text-[var(--text-strong)]"
        >
          {props.variable ? `Edit ${props.variable.name}` : "New variable"}
        </h3>
        <p class="m-0 mt-1 max-w-[52ch] text-caption/[1.45] text-[var(--text-weak)]">
          A variable changes one thing before a test—such as language, account, theme, or model.
          Relay applies a value, returns to the test start, and repeats.
        </p>
      </div>

      <div
        class="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-base)] p-1"
        role="tablist"
        aria-label="How Relay learns variable values"
      >
        <For
          each={[
            { id: "android" as const, label: "App languages" },
            { id: "device" as const, label: "Visible list" },
            { id: "manual" as const, label: "Enter labels" },
          ]}
        >
          {(source) => (
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode() === source.id}
              class={cn(
                "min-h-10 rounded-lg px-2 text-caption font-medium",
                sourceMode() === source.id
                  ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[var(--shadow-xs-border-base)]"
                  : "text-[var(--text-weak)] hover:text-[var(--text-strong)]",
              )}
              onClick={() => {
                setSourceMode(source.id);
                setReadStatus(undefined);
                if (source.id === "android") setKind("language");
              }}
            >
              {source.label}
            </button>
          )}
        </For>
      </div>

      <label class="grid gap-1.5">
        <span class={panelSectionLabel}>Name</span>
        <input
          class="h-10 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-body text-[var(--text-strong)] placeholder:text-[var(--text-weaker)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
          value={name()}
          placeholder={KINDS.find((item) => item.id === kind())?.label ?? "Variable"}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>

      <label class="grid gap-1.5">
        <span class={panelSectionLabel}>What changes?</span>
        <select
          class="h-10 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-body text-[var(--text-strong)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
          value={kind()}
          disabled={sourceMode() === "android"}
          onChange={(event) => {
            setKind(event.currentTarget.value as AppMapVariableKind);
            setReadStatus(undefined);
          }}
        >
          <For each={KINDS}>{(item) => <option value={item.id}>{item.label}</option>}</For>
        </select>
      </label>

      <Show
        when={sourceMode() === "device"}
        fallback={
          <Show
            when={sourceMode() === "android"}
            fallback={
              <label class="grid gap-1.5">
                <span class={cn("flex items-center justify-between gap-2", panelSectionLabel)}>
                  Labels Relay should tap
                  <span class="font-normal text-[var(--text-weak)]">One per line</span>
                </span>
                <textarea
                  class="min-h-36 resize-y rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-body/[1.5] text-[var(--text-strong)] placeholder:text-[var(--text-weaker)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]"
                  value={manualText()}
                  placeholder={"English\nPortuguês\n日本語"}
                  onInput={(event) => setManualText(event.currentTarget.value)}
                />
                <span class="text-micro text-[var(--text-weak)]">
                  Relay looks for each label in the value list. You can set the paths below.
                </span>
              </label>
            }
          >
            <div class="grid gap-2 rounded-xl bg-[var(--surface-base)] p-2.5">
              <label class="grid gap-1.5">
                <span class={panelSectionLabel}>Android app</span>
                <input
                  class="h-10 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-body"
                  value={androidPackage()}
                  placeholder="ai.x.grok"
                  onInput={(event) => setAndroidPackage(event.currentTarget.value)}
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                class="justify-self-start"
                disabled={discoveringLocales() || !androidPackage().trim()}
                onClick={() => void discoverAndroidLocales()}
              >
                <Icon
                  name="refresh"
                  size={12}
                  class={
                    discoveringLocales() ? "ui-refresh-spin motion-reduce:opacity-70" : undefined
                  }
                />
                {discoveringLocales() ? "Reading app languages…" : "Read supported languages"}
              </Button>
              <label class="grid gap-1.5">
                <span class={cn("flex items-center justify-between gap-2", panelSectionLabel)}>
                  App languages
                  <span class="font-normal text-[var(--text-weak)]">Locale | label</span>
                </span>
                <textarea
                  class="min-h-36 resize-y rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 font-mono text-caption/[1.5] text-[var(--text-strong)]"
                  value={localeText()}
                  placeholder={"en | English\nit | Italiano\npt-BR | Português (Brasil)"}
                  onInput={(event) => setLocaleText(event.currentTarget.value)}
                />
                <span class="text-micro/[1.4] text-[var(--text-weak)]">
                  Reads the installed app’s declared languages. No device navigation is needed.
                </span>
              </label>
            </div>
          </Show>
        }
      >
        <div class="grid gap-2">
          <div class="rounded-xl bg-[var(--surface-base)] px-3 py-2.5 text-caption/[1.45] text-[var(--text-weak)]">
            Visible list reads exactly what is open on the device now. It does not search the app or
            discover every supported language.
            <Show when={kind() === "language"}>
              <span class="mt-1 block text-[var(--text-base)]">
                Use App languages above when you want an Android app’s declared locale list.
              </span>
            </Show>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                toast(
                  "Device panel opened. Navigate to the value list, then reopen Combine and read the visible list.",
                  "info",
                );
                props.onOpenDevice();
              }}
            >
              <Icon name="smartphone" size={12} /> Choose list on device
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
              {reading() ? "Reading…" : "Read visible list"}
            </Button>
          </div>

          <Show when={readStatus()}>
            {(status) => (
              <p
                class={cn(
                  "m-0 rounded-lg px-2.5 py-2 text-micro/[1.4]",
                  status().tone === "success"
                    ? "bg-[var(--product-accent-soft)] text-[var(--text-base)]"
                    : "bg-[var(--surface-base)] text-[var(--text-base)]",
                )}
                role="status"
              >
                {status().message}
              </p>
            )}
          </Show>

          <Show
            when={rows().length}
            fallback={
              <div class="rounded-xl bg-[var(--surface-base)] px-3 py-4 text-center">
                <strong class="block text-caption text-[var(--text-strong)]">
                  Open a value list on your device
                </strong>
                <span class="mt-1 block text-caption text-[var(--text-weak)]">
                  Then choose Read visible list and mark one or two examples.
                </span>
              </div>
            }
          >
            <div
              class="grid max-h-56 gap-1 overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-weak-base)] p-1.5"
              onWheel={(event) => event.stopPropagation()}
            >
              <For each={rows()}>
                {(row) => {
                  const selected = () => selectedKeys().includes(rowKey(row));
                  return (
                    <button
                      type="button"
                      class={cn(
                        "flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-left transition-colors duration-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--border-focus)]",
                        selected()
                          ? "bg-[var(--product-accent-soft)] text-[var(--text-strong)]"
                          : "text-[var(--text-base)] hover:bg-[var(--surface-base-hover)]",
                      )}
                      aria-pressed={selected()}
                      onClick={() => toggleRow(row)}
                    >
                      <span
                        class={cn(
                          "grid size-4 shrink-0 place-items-center rounded border",
                          selected()
                            ? "border-[var(--text-interactive-base)] bg-[var(--text-interactive-base)] text-[var(--button-primary-foreground,var(--icon-invert-base))]"
                            : "border-[var(--border-strong-base)]",
                        )}
                      >
                        <Show when={selected()}>
                          <Icon name="check" size={9} />
                        </Show>
                      </span>
                      <span class="min-w-0 flex-1 truncate text-caption">
                        {row.label ?? row.value}
                      </span>
                      <Show when={selected()}>
                        <span class="text-micro text-[var(--text-weak)]">Example</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={sourceMode() !== "android"}>
        <button
          type="button"
          class="flex min-h-10 items-center justify-between rounded-lg px-2 text-left text-caption text-[var(--text-base)] hover:bg-[var(--surface-base-hover)] focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
          aria-expanded={pathsOpen()}
          onClick={() => setPathsOpen((open) => !open)}
        >
          <span>Where is the list?</span>
          <span class="flex items-center gap-1 text-micro text-[var(--text-weak)]">
            Set start and return paths
            <Icon name={pathsOpen() ? "chevron-up" : "chevron-down"} size={11} />
          </span>
        </button>
      </Show>
      <Show when={sourceMode() !== "android" && pathsOpen()}>
        <div class="grid gap-2 rounded-xl bg-[var(--surface-base)] p-2.5">
          <label class="grid gap-1">
            <span class="text-micro text-[var(--text-base)]">Open the value list with</span>
            <select
              class="h-10 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-caption"
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
            <span class="text-micro text-[var(--text-base)]">After choosing a value</span>
            <select
              class="h-10 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 text-caption"
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
            <Icon name="trash" size={12} /> Delete variable
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
            {saving() ? "Saving…" : props.variable ? "Save variable" : "Create variable"}
          </Button>
        </div>
      </footer>
    </section>
  );
}
