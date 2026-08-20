import { Show } from "solid-js";
import type { ReviewedDocumentOriginInspection } from "@relay/protocol";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export type OriginLineage = ReviewedDocumentOriginInspection["lineage"][number];
export type OriginStatus = "not-reviewed" | "pending" | "active" | "revoked" | "invalid";
export type OriginLifecycleStatus = "pending" | "active" | "revoked";
export type ReviewedDocumentOriginEvidenceUrl = (
  uri: string,
  mime: "image/png" | "application/json",
) => string;

/** The append-only decision state, independent from whether its evidence still
 * matches the current App Map. An invalid active record must remain revocable. */
export function originLifecycleStatus(lineage: OriginLineage): OriginLifecycleStatus {
  const latest = lineage.revocationTombstone ?? lineage.ledger ?? lineage.ledgerEvents.at(-1);
  if (latest?.status === "revoked") return "revoked";
  if (latest?.status === "active") return "active";
  return "pending";
}

export function originStatus(lineage: OriginLineage): OriginStatus {
  const lifecycle = originLifecycleStatus(lineage);
  if (lifecycle === "revoked") return "revoked";
  if (!lineage.currentBinding) return "invalid";
  return lifecycle;
}

function statusCopy(status: OriginStatus) {
  switch (status) {
    case "active":
      return { label: "Active", icon: "check" as const };
    case "revoked":
      return { label: "Revoked", icon: "slash" as const };
    case "invalid":
      return { label: "Invalid now", icon: "alert" as const };
    case "pending":
      return { label: "Pending", icon: "clock" as const };
    default:
      return { label: "Not reviewed", icon: "info" as const };
  }
}

function statusClass(status: OriginStatus): string {
  switch (status) {
    case "active":
      return "bg-[color-mix(in_srgb,var(--icon-success-base)_13%,transparent)] text-[var(--icon-success-base)]";
    case "revoked":
      return "bg-[color-mix(in_srgb,var(--icon-critical-base)_12%,transparent)] text-[var(--icon-critical-base)]";
    case "invalid":
    case "pending":
      return "bg-[color-mix(in_srgb,var(--icon-warning-base)_13%,transparent)] text-[var(--icon-warning-base)]";
    default:
      return "bg-[var(--surface-base)] text-[var(--text-weak)]";
  }
}

function compactDigest(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 12)}…${value.slice(-4)}`;
}

export function timestamp(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return "Not recorded";
  return new Date(value).toLocaleString();
}

export function OriginStatusBadge(props: { status: OriginStatus }) {
  const copy = () => statusCopy(props.status);
  return (
    <span
      data-reviewed-origin-status={props.status}
      class={cn(
        "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-semibold",
        statusClass(props.status),
      )}
    >
      <Icon name={copy().icon} size={10} />
      {copy().label}
    </span>
  );
}

export function EvidenceLink(props: {
  label: string;
  uri: string;
  mime: "image/png" | "application/json";
  sha256: string;
  bytes: number;
  evidenceUrl: ReviewedDocumentOriginEvidenceUrl;
}) {
  const href = () => props.evidenceUrl(props.uri, props.mime);
  return (
    <a
      href={href()}
      target="_blank"
      rel="noreferrer"
      class="flex min-h-11 min-w-0 touch-manipulation items-center gap-2 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 text-left text-micro text-[var(--text-interactive-base)] outline-none transition-[background-color,border-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.99] motion-reduce:active:scale-100"
      aria-label={`Open immutable ${props.label}`}
    >
      <Icon name={props.mime === "image/png" ? "camera" : "scan"} size={12} />
      <span class="min-w-0 flex-1 truncate font-medium">{props.label}</span>
      <span class="shrink-0 font-mono text-micro text-[var(--text-weak)]" title={props.sha256}>
        {compactDigest(props.sha256)}
      </span>
      <Icon name="external" size={11} class="shrink-0" />
      <span class="sr-only">{props.bytes} bytes</span>
    </a>
  );
}

export function BindingRow(props: { label: string; value: string }) {
  return (
    <div class="grid grid-cols-[minmax(72px,0.45fr)_minmax(0,1fr)] gap-x-2 max-[380px]:grid-cols-1 max-[380px]:gap-y-0.5">
      <dt class="text-micro font-medium text-[var(--text-weak)]">{props.label}</dt>
      <dd
        class="m-0 min-w-0 truncate font-mono text-micro text-[var(--text-base)]"
        title={props.value}
      >
        {props.value}
      </dd>
    </div>
  );
}

export function LineageCard(props: {
  lineage: OriginLineage;
  evidenceUrl: ReviewedDocumentOriginEvidenceUrl;
}) {
  const status = () => originStatus(props.lineage);
  const approval = () => props.lineage.projection.approval;
  const revocation = () => props.lineage.revocationTombstone?.revocation;
  return (
    <article
      data-reviewed-origin-lineage
      data-reviewed-origin-lineage-status={status()}
      class={cn(
        "grid gap-2 rounded-xl border p-2.5",
        status() === "invalid"
          ? "border-[color-mix(in_srgb,var(--icon-warning-base)_55%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--icon-warning-base)_8%,var(--surface-base))]"
          : status() === "revoked"
            ? "border-[color-mix(in_srgb,var(--icon-critical-base)_38%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--icon-critical-base)_5%,var(--surface-base))]"
            : "border-[var(--border-weak-base)] bg-[var(--surface-base)]",
      )}
    >
      <header class="flex min-w-0 items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="m-0 truncate text-micro font-semibold text-[var(--text-strong)]">
            {props.lineage.projection.id}
          </p>
          <p class="m-0 mt-0.5 text-micro/[1.35] text-[var(--text-weak)]">
            {props.lineage.ledgerEvents.length} immutable lifecycle event
            {props.lineage.ledgerEvents.length === 1 ? "" : "s"}
          </p>
        </div>
        <OriginStatusBadge status={status()} />
      </header>

      <Show when={!props.lineage.currentBinding}>
        <p
          class="m-0 flex gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--icon-warning-base)_11%,transparent)] p-2 text-micro/[1.4] text-[var(--icon-warning-base)]"
          role="status"
        >
          <Icon name="alert" size={12} class="mt-0.5 shrink-0" />
          <span>
            This approval no longer matches the current App Map or first viewport. It remains
            visible for audit, but cannot authorize a restore.
          </span>
        </p>
      </Show>

      <dl class="grid gap-1.5">
        <BindingRow label="Profile" value={props.lineage.projection.binding.targetProfileId} />
        <BindingRow label="Capture" value={props.lineage.projection.binding.captureId} />
        <BindingRow label="Surface" value={props.lineage.projection.binding.surfaceId} />
        <BindingRow
          label="Map revision"
          value={String(props.lineage.projection.binding.appMapRevision)}
        />
      </dl>

      <div class="grid gap-1.5 border-t border-[var(--border-weak-base)] pt-2">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-micro font-medium text-[var(--text-base)]">Review record</span>
          <time
            class="shrink-0 text-micro text-[var(--text-weak)]"
            dateTime={new Date(approval().at).toISOString()}
          >
            {timestamp(approval().at)}
          </time>
        </div>
        <p class="m-0 text-micro/[1.4] text-[var(--text-weak)]">
          {approval().actor.actorId} · {approval().reason}
        </p>
        <EvidenceLink
          label="Open signed review record"
          uri={approval().evidence.uri}
          mime="application/json"
          sha256={approval().evidence.sha256}
          bytes={approval().evidence.bytes}
          evidenceUrl={props.evidenceUrl}
        />
      </div>

      <Show when={revocation()}>
        {(decision) => (
          <div class="grid gap-1.5 border-t border-[var(--border-weak-base)] pt-2">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-micro font-medium text-[var(--icon-critical-base)]">
                Revocation record
              </span>
              <time
                class="shrink-0 text-micro text-[var(--text-weak)]"
                dateTime={new Date(decision().at).toISOString()}
              >
                {timestamp(decision().at)}
              </time>
            </div>
            <p class="m-0 text-micro/[1.4] text-[var(--text-weak)]">
              {decision().actor.actorId} · {decision().reason}
            </p>
            <EvidenceLink
              label="Open signed revocation record"
              uri={decision().evidence.uri}
              mime="application/json"
              sha256={decision().evidence.sha256}
              bytes={decision().evidence.bytes}
              evidenceUrl={props.evidenceUrl}
            />
          </div>
        )}
      </Show>
    </article>
  );
}
