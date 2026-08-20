import { For, Show, createMemo, createSignal } from "solid-js";
import type {
  AppMap,
  LogicalScrollSurface,
  ReviewedDocumentOriginInspection,
  ScreenVariant,
} from "@relay/protocol";
import {
  REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
} from "@relay/protocol";
import type { ReviewedDocumentOriginActionState } from "../lib/use-reviewed-document-origin";
import type {
  ReviewedDocumentOriginReviewDecision,
  ReviewedDocumentOriginRevocationDecision,
} from "../lib/reviewed-document-origin-controller";
import { humanError } from "../lib/human-error";
import { Icon } from "./icon";
import {
  BindingRow,
  EvidenceLink,
  LineageCard,
  OriginStatusBadge,
  originLifecycleStatus,
  originStatus,
  timestamp,
  type OriginStatus,
  type ReviewedDocumentOriginEvidenceUrl,
} from "./reviewed-document-origin-primitives";

export type ReviewedDocumentOriginPanelProps = {
  appMap: AppMap;
  screenId: string;
  variant: ScreenVariant;
  surface: LogicalScrollSurface;
  inspection?: ReviewedDocumentOriginInspection;
  inspectionBusy?: boolean;
  actionState?: ReviewedDocumentOriginActionState;
  error?: string;
  evidenceUrl: ReviewedDocumentOriginEvidenceUrl;
  onInspect: () => void | Promise<void>;
  onReview: (decision: ReviewedDocumentOriginReviewDecision) => void | Promise<void>;
  onRevoke: (
    projectionId: string,
    decision: ReviewedDocumentOriginRevocationDecision,
  ) => void | Promise<void>;
};

function surfaceEligibility(props: ReviewedDocumentOriginPanelProps): string | undefined {
  const first = props.surface.viewports[0];
  if (props.variant.targetProfile.platform !== "android") {
    return "Reviewed document origins are available for Android scroll surfaces only.";
  }
  if (props.surface.targetProfileId !== props.variant.targetProfile.id) {
    return "This surface is not bound to the selected Android target profile.";
  }
  if (props.surface.documentOriginProof) {
    return "This surface already has a native capture-origin proof; a manual reviewed origin is not needed.";
  }
  if (props.surface.status !== "completed" || props.surface.reason !== "end-of-content") {
    return "A reviewed origin requires a completed surface that reached the end of content.";
  }
  if (!props.surface.restoredStartViewport) {
    return "This surface was not restored to its first viewport after capture.";
  }
  if (
    !first ||
    first.index !== 0 ||
    first.offsetY !== 0 ||
    first.appendedHeight !== 0 ||
    first.width <= 0 ||
    first.height <= 0
  ) {
    return "The immutable zero-offset first viewport is incomplete.";
  }
  return undefined;
}

/**
 * Deliberate offline authority UI. This component only renders immutable
 * evidence and calls its three supplied reviewed-origin operations; it never
 * receives a target, lease, capture, or generic request capability.
 */
export function ReviewedDocumentOriginPanel(props: ReviewedDocumentOriginPanelProps) {
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [revokeOpen, setRevokeOpen] = createSignal(false);
  const [reviewReason, setReviewReason] = createSignal("");
  const [revokeReason, setRevokeReason] = createSignal("");
  const [reviewConfirmed, setReviewConfirmed] = createSignal(false);
  const [revokeConfirmed, setRevokeConfirmed] = createSignal(false);
  const [reviewError, setReviewError] = createSignal("");
  const [revokeError, setRevokeError] = createSignal("");
  const lineage = () => props.inspection?.lineage ?? [];
  const status = createMemo<OriginStatus>(() => {
    const statuses = lineage().map(originStatus);
    if (statuses.includes("active")) return "active";
    if (statuses.includes("pending")) return "pending";
    if (statuses.includes("revoked")) return "revoked";
    if (statuses.includes("invalid")) return "invalid";
    return "not-reviewed";
  });
  // Binding validity controls restore authority; the durable lifecycle controls
  // whether a reviewer can still revoke a prior active decision.
  const activeLineage = createMemo(() =>
    lineage().find((entry) => originLifecycleStatus(entry) === "active"),
  );
  const hasPendingLineage = createMemo(() =>
    lineage().some((entry) => originLifecycleStatus(entry) === "pending"),
  );
  const eligibility = createMemo(() => surfaceEligibility(props));
  const busy = () => props.actionState && props.actionState !== "idle";
  const firstViewport = () => props.surface.viewports[0];
  const canStartReview = () =>
    !eligibility() && !activeLineage() && !hasPendingLineage() && !busy();
  const canStartRevoke = () => Boolean(activeLineage()) && !busy();

  function cancelReview() {
    setReviewOpen(false);
    setReviewReason("");
    setReviewConfirmed(false);
    setReviewError("");
  }

  function cancelRevoke() {
    setRevokeOpen(false);
    setRevokeReason("");
    setRevokeConfirmed(false);
    setRevokeError("");
  }

  async function submitReview(event: SubmitEvent) {
    event.preventDefault();
    const reason = reviewReason().trim();
    if (!reason) {
      setReviewError("Give the evidence review a short, durable reason before activating it.");
      return;
    }
    if (!reviewConfirmed()) {
      setReviewError("Confirm the exact document-top assertion before activating this origin.");
      return;
    }
    setReviewError("");
    try {
      await props.onReview({
        reason,
        assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
        confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
      });
      cancelReview();
    } catch (cause) {
      setReviewError(humanError(cause, "Could not activate this origin."));
    }
  }

  async function submitRevoke(event: SubmitEvent) {
    event.preventDefault();
    const active = activeLineage();
    const reason = revokeReason().trim();
    if (!active) {
      setRevokeError("There is no active reviewed origin to revoke.");
      return;
    }
    if (!reason) {
      setRevokeError("Give this revocation a short, durable reason before continuing.");
      return;
    }
    if (!revokeConfirmed()) {
      setRevokeError("Confirm the exact revocation assertion before removing this authority.");
      return;
    }
    setRevokeError("");
    try {
      await props.onRevoke(active.projection.id, {
        reason,
        assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
        confirmation: REVIEWED_DOCUMENT_ORIGIN_CONFIRMATION,
      });
      cancelRevoke();
    } catch (cause) {
      setRevokeError(humanError(cause, "Could not revoke this origin."));
    }
  }

  return (
    <section
      class="grid gap-3 border-t border-[var(--border-weak-base)] px-3 py-3"
      aria-label="Reviewed document origin"
      data-reviewed-origin-panel
      data-narrow-layout="stack"
      aria-busy={props.inspectionBusy || busy()}
    >
      <header class="flex min-w-0 items-start justify-between gap-2.5">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
              <Icon name="check" size={12} />
            </span>
            <h3 class="m-0 truncate text-caption font-semibold text-[var(--text-strong)]">
              Reviewed origin
            </h3>
          </div>
          <p class="m-0 mt-1 max-w-[34ch] text-micro/[1.4] text-[var(--text-weak)]">
            Inspect immutable evidence before granting a local document-top authority. This never
            connects to or controls a device.
          </p>
        </div>
        <OriginStatusBadge status={status()} />
      </header>

      <Show when={props.error}>
        {(error) => (
          <p
            class="m-0 flex gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--icon-critical-base)_45%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--icon-critical-base)_8%,var(--surface-base))] p-2 text-micro/[1.4] text-[var(--icon-critical-base)]"
            role="alert"
          >
            <Icon name="alert" size={12} class="mt-0.5 shrink-0" />
            <span>{error()}</span>
          </p>
        )}
      </Show>

      <Show when={firstViewport()}>
        {(first) => (
          <section
            class="grid gap-2 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-2"
            aria-label="Immutable first viewport evidence"
            data-reviewed-origin-evidence
          >
            <div class="flex items-baseline justify-between gap-2 px-0.5">
              <strong class="text-micro font-semibold text-[var(--text-strong)]">
                Immutable first viewport
              </strong>
              <span class="shrink-0 font-mono text-micro tabular-nums text-[var(--text-weak)]">
                0 px
              </span>
            </div>
            <img
              src={props.evidenceUrl(first().screenshot.uri, "image/png")}
              alt={`Immutable first viewport PNG for ${props.variant.targetProfile.name}`}
              class="block max-h-56 w-full rounded-lg border border-[var(--border-weak-base)] bg-[var(--background-deep)] object-contain object-top"
              width={first().width}
              height={first().height}
            />
            <div class="grid grid-cols-2 gap-2 max-[380px]:grid-cols-1">
              <EvidenceLink
                label="Open first PNG"
                uri={first().screenshot.uri}
                mime="image/png"
                sha256={first().screenshot.sha256}
                bytes={first().screenshot.bytes}
                evidenceUrl={props.evidenceUrl}
              />
              <EvidenceLink
                label="Open first accessibility tree"
                uri={first().accessibilityTree.uri}
                mime="application/json"
                sha256={first().accessibilityTree.sha256}
                bytes={first().accessibilityTree.bytes}
                evidenceUrl={props.evidenceUrl}
              />
            </div>
            <p class="m-0 px-0.5 text-micro/[1.35] text-[var(--text-weak)]">
              Captured {timestamp(first().capturedAt)} · {first().width} × {first().height}
            </p>
          </section>
        )}
      </Show>

      <section
        class="grid gap-1.5 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-2.5"
        aria-label="Current App Map binding"
        data-reviewed-origin-binding
      >
        <strong class="text-micro font-semibold text-[var(--text-strong)]">Current binding</strong>
        <dl class="grid gap-1.5">
          <BindingRow label="Map" value={props.appMap.id} />
          <BindingRow label="Screen" value={props.screenId} />
          <BindingRow label="Variant" value={props.variant.id} />
          <BindingRow label="Profile" value={props.variant.targetProfile.id} />
          <BindingRow label="Capture" value={props.surface.captureId} />
          <BindingRow label="Surface" value={props.surface.id} />
        </dl>
      </section>

      <section class="grid gap-2" aria-label="Reviewed-origin lineage">
        <div class="flex min-h-11 items-center justify-between gap-2">
          <div>
            <h4 class="m-0 text-micro font-semibold text-[var(--text-strong)]">Lineage</h4>
            <p class="m-0 mt-0.5 text-micro text-[var(--text-weak)]">
              {props.inspectionBusy
                ? "Reading persisted evidence…"
                : `${lineage().length} saved decision${lineage().length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-lg px-2 text-micro font-medium text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.96] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
            disabled={props.inspectionBusy || busy()}
            aria-busy={props.inspectionBusy}
            onClick={() => void props.onInspect()}
          >
            <Icon
              name="refresh"
              size={11}
              class={props.inspectionBusy ? "animate-spin motion-reduce:animate-none" : undefined}
            />
            Refresh
          </button>
        </div>
        <Show
          when={lineage().length}
          fallback={
            <p class="m-0 rounded-xl border border-dashed border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3 text-micro/[1.4] text-[var(--text-weak)]">
              No reviewed-origin decision exists for this exact capture. The immutable PNG and
              accessibility tree above remain available to inspect.
            </p>
          }
        >
          <div class="grid gap-2">
            <For each={lineage()}>
              {(entry) => <LineageCard lineage={entry} evidenceUrl={props.evidenceUrl} />}
            </For>
          </div>
        </Show>
      </section>

      <Show when={eligibility()}>
        {(reason) => (
          <p
            class="m-0 flex gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--icon-warning-base)_10%,transparent)] p-2 text-micro/[1.4] text-[var(--icon-warning-base)]"
            role="status"
          >
            <Icon name="alert" size={12} class="mt-0.5 shrink-0" />
            <span>{reason()}</span>
          </p>
        )}
      </Show>
      <Show when={hasPendingLineage()}>
        <p
          class="m-0 flex gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--icon-warning-base)_10%,transparent)] p-2 text-micro/[1.4] text-[var(--icon-warning-base)]"
          role="status"
        >
          <Icon name="clock" size={12} class="mt-0.5 shrink-0" />
          <span>
            A pending lifecycle is retained for audit. Resolve it through review evidence before
            starting another authority decision.
          </span>
        </p>
      </Show>

      <Show when={!reviewOpen() && !activeLineage()}>
        <button
          type="button"
          data-reviewed-origin-start-review
          class="flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-[var(--border-focus)] bg-[var(--product-accent-soft)] px-3 text-micro font-semibold text-[var(--text-interactive-base)] outline-none transition-[background-color,border-color,color,transform] duration-hover hover:bg-[color-mix(in_srgb,var(--product-accent-soft)_72%,var(--surface-base))] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[var(--border-weak-base)] disabled:bg-[var(--surface-base)] disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
          disabled={!canStartReview()}
          onClick={() => setReviewOpen(true)}
        >
          <Icon name="check" size={12} />
          Review first viewport
        </button>
      </Show>

      <Show when={reviewOpen()}>
        <form
          class="grid gap-2 rounded-xl border border-[var(--border-focus)] bg-[color-mix(in_srgb,var(--product-accent-soft)_10%,var(--surface-base))] p-2.5"
          data-reviewed-origin-review-form
          onSubmit={(event) => void submitReview(event)}
        >
          <div>
            <h4 class="m-0 text-micro font-semibold text-[var(--text-strong)]">
              Activate reviewed origin
            </h4>
            <p class="m-0 mt-0.5 text-micro/[1.4] text-[var(--text-weak)]">
              This records a signed local authorization for this exact first PNG/tree pair. It does
              not recapture or contact the target.
            </p>
          </div>
          <label
            for="reviewed-origin-review-reason"
            class="grid gap-1 text-micro font-medium text-[var(--text-base)]"
          >
            Why does this first viewport represent the document top?
            <textarea
              id="reviewed-origin-review-reason"
              class="min-h-22 w-full touch-manipulation resize-y rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-title leading-6 text-[var(--text-strong)] outline-none transition-[border-color,box-shadow] duration-hover placeholder:text-[var(--text-weaker)] focus-visible:border-[var(--border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)]"
              value={reviewReason()}
              maxLength={1000}
              rows={3}
              required
              disabled={busy()}
              spellcheck={false}
              autocomplete="off"
              aria-invalid={Boolean(reviewError())}
              aria-describedby={reviewError() ? "reviewed-origin-review-error" : undefined}
              placeholder="For example: the capture began at the visible document top and the first raw PNG/tree pair matches the map."
              onInput={(event) => {
                setReviewReason(event.currentTarget.value);
                if (reviewError()) setReviewError("");
              }}
            />
          </label>
          <label class="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 py-2 text-micro/[1.4] text-[var(--text-base)]">
            <input
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 touch-manipulation rounded-sm accent-[var(--text-interactive-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
              checked={reviewConfirmed()}
              disabled={busy()}
              onChange={(event) => {
                setReviewConfirmed(event.currentTarget.checked);
                if (reviewError()) setReviewError("");
              }}
            />
            <span>
              I confirm the exact assertion <code>{REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION}</code>
              : I reviewed the immutable first PNG and accessibility tree as the document top.
            </span>
          </label>
          <Show when={reviewError()}>
            <p
              id="reviewed-origin-review-error"
              class="m-0 text-micro/[1.4] text-[var(--icon-critical-base)]"
              role="alert"
            >
              {reviewError()}
            </p>
          </Show>
          <div class="grid grid-cols-2 gap-2 max-[380px]:grid-cols-1">
            <button
              type="submit"
              class="min-h-11 touch-manipulation rounded-lg bg-[var(--text-interactive-base)] px-3 text-micro font-semibold text-[var(--background-base)] outline-none transition-[background-color,color,transform] duration-hover hover:bg-[color-mix(in_srgb,var(--text-interactive-base)_85%,black)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[var(--surface-base-active)] disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
              disabled={busy() || !reviewReason().trim() || !reviewConfirmed()}
              aria-busy={props.actionState === "reviewing"}
            >
              {props.actionState === "reviewing" ? "Activating…" : "Activate origin"}
            </button>
            <button
              type="button"
              class="min-h-11 touch-manipulation rounded-lg px-3 text-micro font-medium text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.98] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
              disabled={busy()}
              onClick={cancelReview}
            >
              Cancel
            </button>
          </div>
        </form>
      </Show>

      <Show when={activeLineage() && !revokeOpen()}>
        <button
          type="button"
          data-reviewed-origin-start-revoke
          class="flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--icon-critical-base)_50%,var(--border-weak-base))] px-3 text-micro font-semibold text-[var(--icon-critical-base)] outline-none transition-[background-color,border-color,color,transform] duration-hover hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_9%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--icon-critical-base)] active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[var(--border-weak-base)] disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
          disabled={!canStartRevoke()}
          onClick={() => setRevokeOpen(true)}
        >
          <Icon name="slash" size={12} />
          Revoke reviewed origin
        </button>
      </Show>

      <Show when={revokeOpen()}>
        <form
          class="grid gap-2 rounded-xl border border-[color-mix(in_srgb,var(--icon-critical-base)_45%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--icon-critical-base)_6%,var(--surface-base))] p-2.5"
          data-reviewed-origin-revoke-form
          onSubmit={(event) => void submitRevoke(event)}
        >
          <div>
            <h4 class="m-0 text-micro font-semibold text-[var(--icon-critical-base)]">
              Revoke authority
            </h4>
            <p class="m-0 mt-0.5 text-micro/[1.4] text-[var(--text-weak)]">
              Revocation is durable. Existing recipes must reopen the local ledger and will no
              longer use this reviewed origin.
            </p>
          </div>
          <label
            for="reviewed-origin-revoke-reason"
            class="grid gap-1 text-micro font-medium text-[var(--text-base)]"
          >
            Why should this origin no longer authorize a restore?
            <textarea
              id="reviewed-origin-revoke-reason"
              class="min-h-22 w-full touch-manipulation resize-y rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] px-2.5 py-2 text-title leading-6 text-[var(--text-strong)] outline-none transition-[border-color,box-shadow] duration-hover placeholder:text-[var(--text-weaker)] focus-visible:border-[var(--icon-critical-base)] focus-visible:ring-2 focus-visible:ring-[var(--icon-critical-base)] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)]"
              value={revokeReason()}
              maxLength={1000}
              rows={3}
              required
              disabled={busy()}
              spellcheck={false}
              autocomplete="off"
              aria-invalid={Boolean(revokeError())}
              aria-describedby={revokeError() ? "reviewed-origin-revoke-error" : undefined}
              placeholder="For example: a later map change makes this viewport no longer suitable as a trusted origin."
              onInput={(event) => {
                setRevokeReason(event.currentTarget.value);
                if (revokeError()) setRevokeError("");
              }}
            />
          </label>
          <label class="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-2.5 py-2 text-micro/[1.4] text-[var(--text-base)]">
            <input
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 touch-manipulation rounded-sm accent-[var(--icon-critical-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--icon-critical-base)]"
              checked={revokeConfirmed()}
              disabled={busy()}
              onChange={(event) => {
                setRevokeConfirmed(event.currentTarget.checked);
                if (revokeError()) setRevokeError("");
              }}
            />
            <span>
              I confirm the exact assertion <code>{REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION}</code>
              : revoke this reviewed document origin now.
            </span>
          </label>
          <Show when={revokeError()}>
            <p
              id="reviewed-origin-revoke-error"
              class="m-0 text-micro/[1.4] text-[var(--icon-critical-base)]"
              role="alert"
            >
              {revokeError()}
            </p>
          </Show>
          <div class="grid grid-cols-2 gap-2 max-[380px]:grid-cols-1">
            <button
              type="submit"
              class="min-h-11 touch-manipulation rounded-lg bg-[var(--icon-critical-base)] px-3 text-micro font-semibold text-[var(--background-base)] outline-none transition-[background-color,color,transform] duration-hover hover:bg-[color-mix(in_srgb,var(--icon-critical-base)_84%,black)] focus-visible:ring-2 focus-visible:ring-[var(--icon-critical-base)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[var(--surface-base-active)] disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
              disabled={busy() || !revokeReason().trim() || !revokeConfirmed()}
              aria-busy={props.actionState === "revoking"}
            >
              {props.actionState === "revoking" ? "Revoking…" : "Revoke origin"}
            </button>
            <button
              type="button"
              class="min-h-11 touch-manipulation rounded-lg px-3 text-micro font-medium text-[var(--text-base)] outline-none transition-[background-color,color,transform] duration-hover hover:bg-[var(--surface-base-hover)] hover:text-[var(--text-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.98] disabled:cursor-not-allowed disabled:text-[var(--text-weaker)] motion-reduce:active:scale-100"
              disabled={busy()}
              onClick={cancelRevoke}
            >
              Cancel
            </button>
          </div>
        </form>
      </Show>
    </section>
  );
}
