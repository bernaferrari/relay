import { For, Show, createMemo, createSignal } from "solid-js";
import type { EvidenceChannelRecord, RunEvidenceQuery } from "@relay/protocol";
import { cn } from "../lib/cn";
import { titleize } from "../lib/job";
import {
  evidenceChannelIsInspectable,
  evidenceChannelNote,
} from "../lib/run-evidence-presentation";
import { Icon, type IconName } from "./icon";
import { EmptyState } from "./empty-state";

export function EvidenceList(props: {
  items: { kind: string; capturedAt: number; data: unknown }[];
  empty: string;
}) {
  return (
    <div class="grid gap-2.5">
      <For
        each={props.items}
        fallback={<EmptyState appearance="quiet" size="sm" title={props.empty} />}
      >
        {(item) => {
          const summary = () => evidenceSummary(item.data);
          return (
            <article class="overflow-hidden rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)]">
              <header class="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5">
                <span class="grid size-[30px] place-items-center rounded-lg bg-surface-base-active text-text-weak">
                  <Icon name={evidenceIcon(item.kind)} size={14} />
                </span>
                <div class="min-w-0">
                  <strong class="block truncate text-body font-medium text-text-strong">
                    {evidenceTitle(item.kind)}
                  </strong>
                  <Show when={summary()}>
                    <span class="mt-0.5 block truncate text-micro text-text-weaker">
                      {summary()}
                    </span>
                  </Show>
                </div>
                <time class="font-mono text-micro tabular-nums text-text-weaker">
                  {new Date(item.capturedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </header>
              <details class="group border-t border-[var(--border-weak-base)]">
                <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-3 text-micro font-medium text-text-weaker hover:text-text-base [&::-webkit-details-marker]:hidden">
                  View payload
                  <Icon
                    name="chevron-down"
                    size={11}
                    class="transition-transform duration-hover group-open:rotate-180"
                  />
                </summary>
                <pre class="m-0 max-h-64 overflow-auto border-t border-[var(--border-weak-base)] bg-[var(--background-deep)] p-3 font-mono text-micro/[1.5] text-[var(--text-base)]">
                  {JSON.stringify(item.data, null, 2)}
                </pre>
              </details>
            </article>
          );
        }}
      </For>
    </div>
  );
}

function EvidenceChannelBanner(props: {
  title: string;
  channel: EvidenceChannelRecord | undefined;
  loading?: boolean;
  note?: string;
}) {
  const status = () => props.channel?.status ?? "unavailable";
  const tone = () =>
    status() === "captured"
      ? "text-[var(--icon-success-active)]"
      : status() === "partial"
        ? "text-[var(--icon-warning-active)]"
        : "text-[var(--icon-critical-active)]";
  return (
    <header class="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <strong class="block text-body font-semibold text-text-strong">{props.title}</strong>
        <span class="mt-0.5 block text-micro leading-[1.4] text-text-weaker">
          {props.loading
            ? "Refreshing structured evidence…"
            : evidenceChannelNote(props.channel, props.note)}
        </span>
      </div>
      <span
        class={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border-weak-base px-2 py-1 text-micro font-medium",
          tone(),
        )}
      >
        <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {props.loading ? "Updating" : status()}
      </span>
    </header>
  );
}

export function RunNetworkEvidence(props: { evidence: RunEvidenceQuery | null; loading: boolean }) {
  const [filter, setFilter] = createSignal("");
  const rows = createMemo(() => {
    const query = filter().trim().toLowerCase();
    const entries = props.evidence?.network ?? [];
    return query
      ? entries.filter((entry) =>
          [entry.method, entry.url, entry.source, entry.result].some((value) =>
            value?.toLowerCase().includes(query),
          ),
        )
      : entries;
  });
  const channel = () => props.evidence?.channels.network;
  const networkEntries = () =>
    (props.evidence?.network.length ?? 0) + (props.evidence?.androidNetwork?.flows.length ?? 0);
  const inspectable = () =>
    evidenceChannelIsInspectable(channel(), networkEntries(), props.loading);
  return (
    <div>
      <EvidenceChannelBanner
        title="Network activity"
        channel={channel()}
        loading={props.loading}
        note={
          props.evidence?.networkCapture.detail ??
          (props.evidence?.limits.bodiesIncluded
            ? "Request and response detail is available for this run."
            : "Summary traffic is shown. Payloads stay hidden unless consented and requested.")
        }
      />
      <Show
        when={props.evidence && inspectable()}
        fallback={
          <Show when={!props.evidence}>
            <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-5 text-center text-caption text-text-weak">
              {props.loading
                ? "Preparing network evidence…"
                : "No structured network evidence is available for this run."}
            </div>
          </Show>
        }
      >
        <Show when={props.evidence?.androidNetwork}>
          {(packet) => (
            <section class="mb-3 overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha">
              <div class="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <strong class="text-caption font-semibold text-text-strong">
                      Emulator packet summary
                    </strong>
                    <span class="rounded-full bg-surface-base-active px-2 py-0.5 text-micro font-medium text-text-weak">
                      {titleize(packet().coverage)}
                    </span>
                  </div>
                  <p class="mt-1 max-w-2xl text-micro leading-[1.45] text-text-weaker">
                    Entire-emulator transport metadata for this Run window. Packet capture does not
                    parse HTTP methods, statuses, headers, or bodies; encrypted payloads remain
                    opaque.
                  </p>
                </div>
                <div class="grid grid-cols-3 gap-3 text-right font-mono text-micro tabular-nums">
                  <span>
                    <b class="block text-caption text-text-strong">{packet().packets}</b>
                    <span class="text-text-weaker">packets</span>
                  </span>
                  <span>
                    <b class="block text-caption text-text-strong">
                      {formatEvidenceBytes(packet().bytesSent)}
                    </b>
                    <span class="text-text-weaker">sent</span>
                  </span>
                  <span>
                    <b class="block text-caption text-text-strong">
                      {formatEvidenceBytes(packet().bytesReceived)}
                    </b>
                    <span class="text-text-weaker">received</span>
                  </span>
                </div>
              </div>
              <div class="grid gap-2 border-t border-border-weak-base px-3 py-2 text-micro text-text-weaker sm:grid-cols-2">
                <span>
                  Attribution: {titleize(packet().attribution.confidence)}
                  {packet().attribution.package ? ` · ${packet().attribution.package}` : ""}
                </span>
                <span class="sm:text-right">
                  Raw packets: {titleize(packet().rawCapture.status)}
                </span>
              </div>
              <Show when={packet().flows.length > 0 || packet().limitations.length > 0}>
                <details class="group border-t border-border-weak-base">
                  <summary class="flex min-h-9 cursor-pointer list-none items-center gap-1.5 px-3 text-micro font-medium text-text-weak outline-none hover:bg-surface-raised-base-hover hover:text-text-base focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-focus max-[760px]:min-h-11 [&::-webkit-details-marker]:hidden">
                    Inspect transport flows and coverage limits
                    <Icon
                      name="chevron-down"
                      size={11}
                      class="transition-transform duration-hover group-open:rotate-180"
                    />
                  </summary>
                  <div class="grid gap-3 border-t border-border-weak-base p-3">
                    <Show when={packet().flows.length > 0}>
                      <div class="overflow-hidden rounded-lg border border-border-weak-base">
                        <For each={packet().flows.slice(0, 20)}>
                          {(flow) => (
                            <div class="grid grid-cols-[54px_minmax(0,1fr)_70px] items-center gap-2 border-b border-border-weak-base px-2.5 py-2 text-micro last:border-0">
                              <span class="font-mono text-text-weak uppercase">
                                {flow.protocol}
                              </span>
                              <span class="min-w-0 truncate font-mono text-text-base">
                                {flow.host ?? flow.remoteAddress ?? "Unknown peer"}
                                {flow.port ? `:${flow.port}` : ""}
                              </span>
                              <span class="text-right font-mono tabular-nums text-text-weaker">
                                {formatEvidenceBytes(flow.sentBytes + flow.receivedBytes)}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                      <Show when={packet().flows.length > 20}>
                        <p class="m-0 text-micro text-text-weaker">
                          Showing 20 of {packet().flows.length} bounded flows.
                        </p>
                      </Show>
                    </Show>
                    <ul class="m-0 grid gap-1 pl-4 text-micro leading-[1.45] text-text-weaker">
                      <For each={packet().limitations}>{(limit) => <li>{limit}</li>}</For>
                    </ul>
                  </div>
                </details>
              </Show>
            </section>
          )}
        </Show>
        <div class="mb-2 flex items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <Icon
              name="search"
              size={13}
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-weaker"
            />
            <input
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              placeholder="Filter HTTP URL, method, or result"
              aria-label="Filter HTTP network evidence"
              class="h-8 w-full rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha pl-8 pr-2.5 text-caption text-text-base outline-none placeholder:text-text-weaker focus:border-border-strong-focus max-[760px]:h-11 max-[760px]:text-body"
            />
          </div>
          <span class="shrink-0 font-mono text-micro text-text-weaker">{rows().length} shown</span>
        </div>
        <Show
          when={rows().length > 0}
          fallback={
            <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-5 text-center text-caption text-text-weak">
              {filter()
                ? "No requests match this filter."
                : props.evidence?.androidNetwork
                  ? "No app-reported HTTP or WebSocket exchanges were observed. Packet metadata is shown above."
                  : "No HTTP or WebSocket exchanges were observed."}
            </div>
          }
        >
          <div class="overflow-hidden rounded-xl border border-border-weak-base">
            <div class="grid grid-cols-[62px_72px_minmax(0,1fr)_74px_62px] gap-2 border-b border-border-weak-base bg-surface-raised-stronger-non-alpha px-3 py-2 text-micro font-medium tracking-[0.08em] text-text-weaker uppercase">
              <span>Result</span>
              <span>Method</span>
              <span>URL</span>
              <span>Status</span>
              <span>Time</span>
            </div>
            <For each={rows()}>
              {(entry) => (
                <details class="group border-b border-border-weak-base last:border-0">
                  <summary class="grid min-h-8 cursor-pointer list-none grid-cols-[62px_72px_minmax(0,1fr)_74px_62px] items-center gap-2 px-3 py-2.5 text-micro outline-none hover:bg-surface-raised-base-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-focus max-[760px]:min-h-11 [&::-webkit-details-marker]:hidden">
                    <span
                      class={cn(
                        "font-medium",
                        entry.result === "failure"
                          ? "text-[var(--icon-critical-base)]"
                          : entry.result === "success"
                            ? "text-[var(--icon-success-base)]"
                            : "text-text-weak",
                      )}
                    >
                      {entry.result}
                    </span>
                    <code class="text-text-base">{entry.method ?? "—"}</code>
                    <span
                      class="min-w-0 truncate font-mono text-micro text-text-base"
                      title={entry.url}
                    >
                      {entry.url ?? "Unknown endpoint"}
                    </span>
                    <span class="font-mono tabular-nums text-text-weak">{entry.status ?? "—"}</span>
                    <span class="font-mono tabular-nums text-text-weaker">
                      {entry.durationMs === undefined ? "—" : `${Math.round(entry.durationMs)}ms`}
                    </span>
                  </summary>
                  <div class="grid gap-2 border-t border-border-weak-base bg-background-weak px-3 py-2.5 text-micro text-text-weak">
                    <Show when={entry.source || entry.at}>
                      <span>
                        {entry.source ?? "Runtime"}
                        {entry.at ? ` · ${new Date(entry.at).toLocaleTimeString()}` : ""}
                      </span>
                    </Show>
                    <Show when={entry.requestBody || entry.responseBody}>
                      <pre class="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-micro/[1.45] text-text-base">
                        {entry.requestBody ? `Request\n${entry.requestBody}` : ""}
                        {entry.responseBody ? `\nResponse\n${entry.responseBody}` : ""}
                      </pre>
                    </Show>
                    <Show when={!entry.requestBody && !entry.responseBody}>
                      <span>Payloads were not included in this evidence view.</span>
                    </Show>
                  </div>
                </details>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function formatEvidenceBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function RunLogsEvidence(props: {
  evidence: RunEvidenceQuery | null;
  loading: boolean;
  orchestrationLogs: string[];
}) {
  const [filter, setFilter] = createSignal("");
  const [source, setSource] = createSignal<"device" | "relay">("device");
  const deviceLogs = createMemo(() => props.evidence?.logs ?? []);
  const relayChannel = (): EvidenceChannelRecord => ({
    channel: "logs",
    status: "captured",
    entries: props.orchestrationLogs.length,
    bytes: props.orchestrationLogs.reduce((total, message) => total + message.length, 0),
    dropped: 0,
    redactions: 0,
  });
  const rows = createMemo(() => {
    const query = filter().trim().toLowerCase();
    const entries =
      source() === "device"
        ? deviceLogs()
        : props.orchestrationLogs.map((message, index) => ({
            id: `relay-${index + 1}`,
            at: undefined as number | undefined,
            level: "info" as const,
            message,
          }));
    return query ? entries.filter((entry) => entry.message.toLowerCase().includes(query)) : entries;
  });
  const deviceInspectable = () =>
    evidenceChannelIsInspectable(props.evidence?.channels.logs, deviceLogs().length, props.loading);
  const activeSourceInspectable = () => source() === "relay" || deviceInspectable();
  return (
    <div>
      <EvidenceChannelBanner
        title={source() === "device" ? "Device logs" : "Relay execution log"}
        channel={source() === "device" ? props.evidence?.channels.logs : relayChannel()}
        loading={props.loading}
        note={
          source() === "device"
            ? deviceInspectable()
              ? "Captured from the target while the run was active."
              : undefined
            : "Orchestration messages from Relay; separate from device output."
        }
      />
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <div
          class="flex rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha p-0.5"
          role="tablist"
          aria-label="Log source"
        >
          {(["device", "relay"] as const).map((kind) => (
            <button
              type="button"
              role="tab"
              aria-selected={source() === kind}
              class={cn(
                "min-h-7 rounded-md px-2.5 text-micro font-medium text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base",
                source() === kind && "bg-surface-base-active text-text-strong",
              )}
              onClick={() => setSource(kind)}
            >
              {kind === "device"
                ? `Device${deviceLogs().length ? ` · ${deviceLogs().length}` : ""}`
                : "Relay"}
            </button>
          ))}
        </div>
        <Show when={activeSourceInspectable()}>
          <div class="relative min-w-[180px] flex-1">
            <Icon
              name="search"
              size={13}
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-weaker"
            />
            <input
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              placeholder="Filter log messages"
              aria-label="Filter log messages"
              class="h-8 w-full rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha pl-8 pr-2.5 text-caption text-text-base outline-none placeholder:text-text-weaker focus:border-border-strong-focus"
            />
          </div>
        </Show>
      </div>
      <Show
        when={activeSourceInspectable() && rows().length > 0}
        fallback={
          <Show when={activeSourceInspectable()}>
            <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-5 text-center text-caption text-text-weak">
              {props.loading
                ? "Preparing device logs…"
                : source() === "device"
                  ? "No device logs were observed during this run."
                  : "No Relay messages were recorded."}
            </div>
          </Show>
        }
      >
        <div class="max-h-[480px] overflow-auto rounded-xl border border-border-weak-base bg-background-weak">
          <For each={rows()}>
            {(entry) => (
              <div class="grid grid-cols-[48px_62px_minmax(0,1fr)] gap-2 border-b border-border-weak-base px-3 py-2 last:border-0">
                <span class="font-mono text-micro tabular-nums text-text-weaker">
                  {entry.at
                    ? new Date(entry.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })
                    : "—"}
                </span>
                <span
                  class={cn(
                    "font-mono text-micro uppercase",
                    entry.level === "error" || entry.level === "warn"
                      ? "text-[var(--icon-warning-base)]"
                      : "text-text-weaker",
                  )}
                >
                  {entry.level}
                </span>
                <span class="whitespace-pre-wrap break-words font-mono text-micro/[1.45] text-text-base">
                  {entry.message}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function RunPerformanceEvidence(props: {
  evidence: RunEvidenceQuery | null;
  loading: boolean;
}) {
  const samples = () => props.evidence?.performance ?? [];
  const inspectable = () =>
    evidenceChannelIsInspectable(
      props.evidence?.channels.performance,
      samples().length,
      props.loading,
    );
  return (
    <div>
      <EvidenceChannelBanner
        title="Performance samples"
        channel={props.evidence?.channels.performance}
        loading={props.loading}
        note={
          inspectable()
            ? "Run-level samples are shown with their collector phase and provenance. Deeper traces remain downloadable artifacts."
            : undefined
        }
      />
      <Show
        when={inspectable() && samples().length > 0}
        fallback={
          <Show when={inspectable()}>
            <div class="rounded-xl border border-dashed border-border-weak-base px-3 py-5 text-center text-caption text-text-weak">
              {props.loading
                ? "Preparing performance evidence…"
                : "No performance samples were observed during this run."}
            </div>
          </Show>
        }
      >
        <div class="grid gap-2">
          <For each={samples()}>
            {(sample) => (
              <article class="rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha p-3">
                <header class="flex items-center justify-between gap-2">
                  <strong class="text-caption font-semibold text-text-strong">
                    {sample.phase}
                  </strong>
                  <span class="font-mono text-micro text-text-weaker">
                    {sample.at ? new Date(sample.at).toLocaleTimeString() : "—"}
                  </span>
                </header>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(sample.metrics).map(([key, value]) => (
                    <span class="rounded-md bg-surface-base-active px-2 py-1 font-mono text-micro text-text-base">
                      {key}: {String(value)}
                    </span>
                  ))}
                </div>
              </article>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function evidenceTitle(kind: string): string {
  const labels: Record<string, string> = {
    network: "Network exchange",
    "response-completion": "Response completed",
    "conversation-turn": "Conversation turn",
    "content-assertion": "Content check",
    "semantic-evaluation": "Quality evaluation",
    "judge-consensus": "Evaluation consensus",
    "frozen-inputs": "Run inputs",
    "app-build": "App build",
  };
  return labels[kind] ?? titleize(kind);
}

function evidenceIcon(kind: string): IconName {
  if (kind === "network") return "wave";
  if (["content-assertion", "semantic-evaluation", "judge-consensus"].includes(kind)) {
    return "check";
  }
  if (kind === "app-build") return "bag";
  return "info";
}

function evidenceSummary(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return typeof data === "string" ? data : null;
  const value = data as Record<string, unknown>;
  const method = typeof value.method === "string" ? value.method.toUpperCase() : null;
  const url = typeof value.url === "string" ? value.url : null;
  const status = typeof value.status === "number" ? String(value.status) : null;
  if (method || url || status) return [method, status, url].filter(Boolean).join(" · ");
  const verdict = [value.verdict, value.result, value.outcome].find(
    (candidate) => typeof candidate === "string",
  );
  const score = typeof value.score === "number" ? `${Math.round(value.score * 100)}%` : null;
  if (verdict || score) return [verdict, score].filter(Boolean).join(" · ");
  const message = [value.message, value.summary, value.text, value.label].find(
    (candidate) => typeof candidate === "string",
  );
  return typeof message === "string" ? message : null;
}
