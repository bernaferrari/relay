import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { CombineCellAnalysis, CombineCellVerdict } from "../lib/combine-verdict";
import type { CombineCapture, CombineRow } from "../lib/combine-review";
import type { JobInfo, PersistedRun } from "../context/server";
import type { TracePackExportResponse } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import {
  findPreviousApprovedRepeatCapture,
  projectRepeatResultEvidence,
  repeatTupleLabel,
} from "../lib/repeat-result-review";
import { cn } from "../lib/cn";
import { modalPanel, modalScrim } from "../lib/ui";
import { trapFocus } from "../lib/modal";
import { toast } from "../context/toast";
import { Icon } from "./icon";

export function RepeatResultDialog(props: {
  row: CombineRow;
  capture: CombineCapture;
  source: string;
  verdict: CombineCellVerdict;
  analysis?: CombineCellAnalysis;
  history: readonly JobInfo[];
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onOpenRun: () => void;
  onClose: () => void;
}) {
  const server = useServer();
  const [review, setReview] = createSignal(props.row.job.review);
  const [reviewNote, setReviewNote] = createSignal("");
  const [reviewing, setReviewing] = createSignal(false);
  let reviewRunId = props.row.job.id;
  createEffect(() => {
    const runId = props.row.job.id;
    if (runId === reviewRunId) return;
    reviewRunId = runId;
    setReview(props.row.job.review);
    setReviewNote("");
  });
  let dialog: HTMLDivElement | undefined;
  onMount(() => {
    if (dialog) onCleanup(trapFocus(dialog));
  });
  const summary = createMemo(() =>
    projectRepeatResultEvidence({
      job: props.row.job,
      verdict: props.verdict,
      ...(props.analysis ? { analysis: props.analysis } : {}),
    }),
  );
  const baseline = createMemo(() =>
    findPreviousApprovedRepeatCapture(props.history, props.row.job, props.capture.caption),
  );
  const baselineSource = () => {
    const previous = baseline();
    if (!previous) return "";
    if (previous.capture.base64) {
      return `data:${previous.capture.mime || "image/png"};base64,${previous.capture.base64}`;
    }
    return previous.job.persisted || previous.job.runDir
      ? server.frameUrlForPersisted(previous.job as unknown as PersistedRun, previous.capture)
      : "";
  };
  const [tracePack] = createResource(
    () => (props.row.job.persisted ? props.row.job.id : null),
    (runId: string): Promise<TracePackExportResponse> =>
      server.runAction("run.trace-pack.get", { runId }),
  );
  const decisionTone = () => {
    const tone = summary().decision.tone;
    if (tone === "pass") return "border-border-success-base/40 bg-surface-success-weak";
    if (tone === "review") return "border-border-warning-base/50 bg-surface-warning-weak";
    if (tone === "blocked") return "border-border-critical-base/40 bg-surface-critical-weak";
    return "border-border-weak-base bg-surface-base";
  };
  async function decideReview(action: "approve" | "reject" | "defer"): Promise<void> {
    if (review()?.status !== "pending" || !props.row.job.persisted || reviewing()) return;
    setReviewing(true);
    try {
      const decided = await server.reviewRun(props.row.job.id, action, reviewNote());
      if (!decided) return;
      setReview(decided);
      setReviewNote("");
      toast(
        action === "approve"
          ? "Checkpoint result approved"
          : action === "reject"
            ? "Checkpoint result rejected"
            : "Another review requested",
        action === "approve" ? "success" : "info",
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div
      class={cn(modalScrim, "z-[var(--z-modal-nested)] flex items-center justify-center p-4")}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        } else if (event.key === "ArrowLeft" && props.onPrevious) {
          event.preventDefault();
          props.onPrevious();
        } else if (event.key === "ArrowRight" && props.onNext) {
          event.preventDefault();
          props.onNext();
        }
      }}
    >
      <div
        ref={(element) => {
          dialog = element;
        }}
        class={`${modalPanel} grid h-[min(94dvh,1040px)] w-[min(1380px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeat-result-title"
        tabIndex={-1}
      >
        <header class="flex items-start justify-between gap-4 border-b border-border-weak-base px-4 py-3">
          <div class="min-w-0">
            <span class="text-micro font-medium tracking-[0.06em] text-text-weaker uppercase">
              Checkpoint {props.position} of {props.total}
            </span>
            <h2
              id="repeat-result-title"
              class="m-0 truncate text-body font-semibold text-text-strong"
            >
              {props.capture.caption}
            </h2>
            <p class="m-0 mt-0.5 truncate text-caption text-text-weak">
              {repeatTupleLabel(props.row)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close result review"
            onClick={props.onClose}
          >
            <Icon name="x" size={14} />
          </Button>
        </header>

        <div class="grid min-h-0 grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)] max-[900px]:grid-cols-1 max-[900px]:overflow-y-auto">
          <section class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-border-weak-base max-[900px]:border-r-0 max-[900px]:border-b">
            <div class="flex flex-wrap items-center gap-2 border-b border-border-weak-base px-4 py-2.5">
              <strong class="text-caption font-semibold text-text-strong">Current evidence</strong>
              <Show
                when={baseline()}
                fallback={<span class="text-micro text-text-weaker">No prior approved match</span>}
              >
                <span class="text-micro text-text-weak">
                  Compared with the previous approved matching result
                </span>
              </Show>
            </div>
            <div
              class={cn(
                "grid min-h-[320px] bg-background-deep p-4",
                baseline() ? "grid-cols-2 gap-4" : "place-items-center",
              )}
            >
              <EvidenceImage source={props.source} label={`Current ${props.capture.caption}`} />
              <Show when={baseline()}>
                <EvidenceImage
                  source={baselineSource()}
                  label={`Previous approved ${props.capture.caption}`}
                />
              </Show>
            </div>
          </section>

          <aside class="min-h-0 overflow-y-auto p-4" aria-label="Selected Repeat result">
            <section class={cn("grid gap-1 rounded-xl border px-3 py-3", decisionTone())}>
              <span class="text-micro font-medium tracking-[0.06em] text-text-weaker uppercase">
                Deterministic decision
              </span>
              <strong class="text-body font-semibold text-text-strong">
                {summary().decision.label}
              </strong>
              <p class="m-0 text-caption/[1.45] text-text-weak">{summary().decision.detail}</p>
            </section>

            <EvidenceSection
              title="Structural findings"
              empty="No structural finding was reported."
              hasContent={summary().structuralFindings.length > 0}
            >
              <FindingList findings={summary().structuralFindings} />
            </EvidenceSection>
            <EvidenceSection
              title="Localization findings"
              empty="No localization finding was reported."
              hasContent={summary().localizationFindings.length > 0}
            >
              <FindingList findings={summary().localizationFindings} />
            </EvidenceSection>
            <EvidenceSection
              title="Semantic findings"
              empty="No semantic finding was captured."
              hasContent={summary().semanticFindings.length > 0}
            >
              <For each={summary().semanticFindings}>
                {(finding) => <EvidenceLine>{finding}</EvidenceLine>}
              </For>
            </EvidenceSection>
            <EvidenceSection
              title="First causal failure"
              empty="No causal failure was identified."
              hasContent={Boolean(summary().firstCausalFailure || summary().crash)}
            >
              <Show when={summary().firstCausalFailure}>
                {(failure) => <EvidenceLine>{failure()}</EvidenceLine>}
              </Show>
              <Show when={summary().crash}>
                {(crash) => <EvidenceLine tone="critical">Crash · {crash()}</EvidenceLine>}
              </Show>
            </EvidenceSection>
            <EvidenceSection
              title="Selector reasoning"
              empty="No selector reasoning was captured for this result."
              hasContent={Boolean(summary().selectorReasoning)}
            >
              <Show when={summary().selectorReasoning}>
                {(reason) => <EvidenceLine>{reason()}</EvidenceLine>}
              </Show>
            </EvidenceSection>
            <EvidenceSection
              title="Recent logs"
              empty="No logs were captured."
              hasContent={summary().recentLogs.length > 0}
            >
              <For each={summary().recentLogs}>
                {(line) => <EvidenceLine mono>{line}</EvidenceLine>}
              </For>
            </EvidenceSection>

            <section class="mt-3 grid gap-2 border-t border-border-weak-base pt-3">
              <div class="flex items-baseline justify-between gap-3">
                <strong class="text-caption font-semibold text-text-strong">
                  Evidence completeness
                </strong>
                <span class="text-micro font-medium text-text-weak">
                  {summary().evidence.status}
                </span>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={summary().evidence.channels}>
                  {(channel) => (
                    <span class="rounded-full border border-border-weak-base px-2 py-1 text-micro text-text-weak">
                      {channel.channel} · {channel.status}
                    </span>
                  )}
                </For>
              </div>
              <Show when={summary().evidence.missing.length > 0}>
                <p class="m-0 text-micro/[1.45] text-text-warning-base">
                  {summary().evidence.missing.join(" · ")}
                </p>
              </Show>
              <dl class="m-0 grid gap-1 text-micro text-text-weak">
                <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                  <dt>Run</dt>
                  <dd class="m-0 truncate font-mono">{props.row.job.id}</dd>
                </div>
                <Show
                  when={tracePack.latest}
                  fallback={
                    <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                      <dt>TracePack</dt>
                      <dd class="m-0">
                        {tracePack.loading
                          ? "Preparing reference…"
                          : "Available after this Run is saved"}
                      </dd>
                    </div>
                  }
                >
                  {(pack) => (
                    <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                      <dt>TracePack</dt>
                      <dd class="m-0 truncate font-mono" title={pack().tracePack.digest}>
                        {pack().tracePack.digest}
                      </dd>
                    </div>
                  )}
                </Show>
              </dl>
            </section>
            <Show when={review()}>
              {(currentReview) => (
                <section
                  class="mt-3 grid gap-2 border-t border-border-weak-base pt-3"
                  aria-label="Checkpoint result decision"
                  data-repeat-result-decision
                >
                  <div class="flex items-baseline justify-between gap-3">
                    <strong class="text-caption font-semibold text-text-strong">
                      Result decision
                    </strong>
                    <span class="text-micro font-medium text-text-weak">
                      {currentReview().status === "pending"
                        ? "Needs review"
                        : currentReview().status === "approved"
                          ? "Approved"
                          : "Rejected"}
                    </span>
                  </div>
                  <p class="m-0 text-micro/[1.45] text-text-weak">{currentReview().reason}</p>
                  <Show when={currentReview().status === "pending"}>
                    <label class="grid gap-1 text-micro font-medium text-text-weak">
                      Review note
                      <textarea
                        class="min-h-20 resize-y rounded-md border border-border-weak-base bg-background-base px-2.5 py-2 text-caption font-normal text-text-strong focus-visible:border-border-focus focus-visible:outline-none"
                        value={reviewNote()}
                        maxLength={2_000}
                        placeholder="Optional context for this checkpoint result"
                        disabled={reviewing()}
                        onInput={(event) => setReviewNote(event.currentTarget.value)}
                      />
                    </label>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={reviewing() || !props.row.job.persisted}
                        onClick={() => void decideReview("approve")}
                      >
                        Approve result
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={reviewing() || !props.row.job.persisted}
                        onClick={() => void decideReview("reject")}
                      >
                        Reject result
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reviewing() || !props.row.job.persisted}
                        onClick={() => void decideReview("defer")}
                      >
                        Request review
                      </Button>
                    </div>
                    <Show when={!props.row.job.persisted}>
                      <p class="m-0 text-micro/[1.45] text-text-warning-base">
                        Decisions become available after this Run is saved.
                      </p>
                    </Show>
                  </Show>
                  <Show when={currentReview().note}>
                    {(note) => <p class="m-0 text-micro/[1.45] text-text-weak">{note()}</p>}
                  </Show>
                  <p class="m-0 text-micro/[1.45] text-text-weaker">
                    This decision applies only to this Run and checkpoint. It does not replace the
                    approved screenshot or change any visual baseline.
                  </p>
                </section>
              )}
            </Show>
          </aside>
        </div>

        <footer class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-border-weak-base px-4 py-3">
          <span class="text-micro tabular-nums text-text-weak">
            {props.position} / {props.total}
          </span>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.onPrevious}
              aria-label="Previous Repeat result"
              onClick={() => props.onPrevious?.()}
            >
              <Icon name="chevron-left" size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.onNext}
              aria-label="Next Repeat result"
              onClick={() => props.onNext?.()}
            >
              <Icon name="chevron-right" size={14} />
            </Button>
          </div>
          <Button variant="secondary" size="sm" class="justify-self-end" onClick={props.onOpenRun}>
            Open full Run report
          </Button>
        </footer>
      </div>
    </div>
  );
}

function EvidenceImage(props: { source: string; label: string }) {
  return props.source ? (
    <figure class="m-0 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
      <img src={props.source} alt={props.label} class="size-full min-h-0 object-contain" />
      <figcaption class="text-center text-micro text-text-weak">{props.label}</figcaption>
    </figure>
  ) : (
    <div class="grid min-h-48 place-items-center text-caption text-text-weaker">
      Screenshot unavailable
    </div>
  );
}

function EvidenceSection(props: {
  title: string;
  empty: string;
  hasContent: boolean;
  children: JSX.Element;
}) {
  return (
    <section class="mt-3 grid gap-1.5 border-t border-border-weak-base pt-3">
      <strong class="text-caption font-semibold text-text-strong">{props.title}</strong>
      <Show
        when={props.hasContent}
        fallback={<p class="m-0 text-micro/[1.45] text-text-weaker">{props.empty}</p>}
      >
        {props.children}
      </Show>
    </section>
  );
}

function FindingList(props: {
  findings: readonly import("@relay/protocol").CombineEvidenceFinding[];
}) {
  return (
    <For each={props.findings}>
      {(finding) => (
        <EvidenceLine tone={finding.severity === "critical" ? "critical" : undefined}>
          {finding.observed?.trim() || finding.detail}
        </EvidenceLine>
      )}
    </For>
  );
}

function EvidenceLine(props: { children: JSX.Element; tone?: "critical"; mono?: boolean }) {
  return (
    <p
      class={cn(
        "m-0 overflow-wrap-anywhere text-micro/[1.45] text-text-weak",
        props.tone === "critical" && "text-text-critical-base",
        props.mono && "font-mono",
      )}
    >
      {props.children}
    </p>
  );
}
