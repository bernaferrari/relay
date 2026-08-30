import { For, Show, type JSX } from "solid-js";
import type {
  ChangeProofPublicationOutboxRecord,
  ChangeProofPublicationReceipt,
  ChangeProofExecutionSummary,
  ChangeVerification,
} from "@relay/protocol";
import { cn } from "../lib/cn";
import { mono, eyebrow, productIconButton } from "../lib/ui";
import { Button } from "@relay/ui/button";
import { StatusChip, type StatusChipTone } from "./status-chip";
import type { ProofPrimaryAction } from "../lib/proof-actions";
import { toast } from "../context/toast";
import { Icon } from "./icon";

type ProofStatus = { label: string; tone: StatusChipTone };

export function ProofDetail(props: {
  proof: ChangeVerification;
  status: ProofStatus;
  history: readonly ChangeVerification[];
  publications: readonly ChangeProofPublicationReceipt[];
  publicationOutbox: readonly ChangeProofPublicationOutboxRecord[];
  execution: ChangeProofExecutionSummary | null;
  primaryAction?: ProofPrimaryAction;
  actionBusy: string | null;
  actionError: string | null;
  canCancel: boolean;
  onPrimaryAction: () => void;
  onCancel: () => void;
  onOpenRun: (runId: string) => void;
  onOpenMap: (appMapId: string) => void;
}) {
  const requiredTargets = () =>
    props.proof.selection.targetCases.filter(({ required }) => required);
  const latestPublication = () => props.publications.at(-1);
  const latestPublicationAttempt = () => props.publicationOutbox.at(-1);

  return (
    <article class="min-h-0 min-w-0 flex-1 overflow-y-auto p-[clamp(1.25rem,3vw,2.5rem)]">
      <div class="grid gap-8">
        <header class="grid gap-3 border-b border-border-weak-base pb-6">
          <div class="flex flex-wrap items-center gap-2">
            <StatusChip tone={props.status.tone} label={props.status.label} />
          </div>
          <h2 class="m-0 text-title font-semibold tracking-[-0.02em] text-text-strong">
            {changeTitle(props.proof)}
          </h2>
          <p class="m-0 text-body text-text-base">
            {projectName(props.proof)}
            {props.proof.change.pullRequest
              ? ` · Pull request #${props.proof.change.pullRequest}`
              : ""}
          </p>
          <details class="w-fit text-caption text-text-weak">
            <summary class="cursor-pointer select-none font-medium text-text-base">
              Technical identity
            </summary>
            <div
              class={cn(
                "mt-2 grid max-w-[min(76ch,calc(100vw-3rem))] gap-1 rounded-lg bg-surface-base px-3 py-2",
                mono,
              )}
            >
              <span class="break-all">{props.proof.change.repository}</span>
              <span class="break-all">base {props.proof.change.baseSha}</span>
              <span class="break-all">head {props.proof.change.headSha}</span>
            </div>
          </details>
          <Show when={props.proof.change.agentClaim?.acceptanceCriteria.length}>
            <ul class="m-0 grid gap-1.5 pl-5 text-body/[1.45] text-text-base">
              <For each={props.proof.change.agentClaim!.acceptanceCriteria}>
                {(criterion) => <li>{criterion}</li>}
              </For>
            </ul>
          </Show>
          <Show when={props.primaryAction || props.canCancel || props.actionError}>
            <div class="mt-1 grid gap-2 border-t border-border-weak-base pt-4">
              <div class="flex flex-wrap items-center gap-2">
                <Show when={props.primaryAction}>
                  {(action) => (
                    <Button
                      variant="primary"
                      disabled={Boolean(props.actionBusy)}
                      onClick={props.onPrimaryAction}
                    >
                      {props.actionBusy === action().kind ? action().pendingLabel : action().label}
                    </Button>
                  )}
                </Show>
                <Show when={props.canCancel}>
                  <Button
                    variant="secondary"
                    disabled={Boolean(props.actionBusy)}
                    onClick={props.onCancel}
                  >
                    {props.actionBusy === "cancel" ? "Cancelling…" : "Cancel Proof"}
                  </Button>
                </Show>
              </div>
              <Show when={props.actionError}>
                {(message) => (
                  <p class="m-0 text-caption/[1.45] text-text-critical-base" role="alert">
                    {message()}
                  </p>
                )}
              </Show>
            </div>
          </Show>
          <Show when={props.execution}>
            {(execution) => (
              <div
                class="grid gap-1 rounded-xl bg-surface-base px-3 py-2.5 ring-1 ring-inset ring-border-weak-base"
                aria-live="polite"
              >
                <strong class="text-body font-semibold text-text-strong">
                  {executionHeadline(execution())}
                </strong>
                <span class="text-caption text-text-weak">{executionProgress(execution())}</span>
              </div>
            )}
          </Show>
        </header>

        <ProofSection title="Why these journeys">
          <For
            each={props.proof.selection.affectedJourneys}
            fallback={<EmptyFact>No affected journey has been proved yet.</EmptyFact>}
          >
            {(journey) => (
              <button
                type="button"
                class="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-left hover:bg-surface-raised-base-hover"
                onClick={() => props.onOpenMap(journey.appMapId)}
              >
                <strong class="text-body font-semibold text-text-strong">{journey.testId}</strong>
                <span class="text-caption font-medium text-text-weak">{journey.confidence}</span>
                <span class="col-span-2 text-caption/[1.45] text-text-base">{journey.reason}</span>
              </button>
            )}
          </For>
        </ProofSection>

        <div class="grid grid-cols-2 gap-6 max-[1020px]:grid-cols-1">
          <ProofSection title="Exact builds">
            <For each={props.proof.builds} fallback={<EmptyFact>Exact build required.</EmptyFact>}>
              {(build) => (
                <FactRow
                  title={`${build.platform} · ${build.configuration}`}
                  detail={`${build.artifactDigest.slice(0, 23)}… · ${build.environmentRevision}`}
                  copyValue={[
                    `artifact ${build.artifactDigest}`,
                    `source ${build.sourceSha}`,
                    `environment ${build.environmentRevision}`,
                  ].join("\n")}
                />
              )}
            </For>
          </ProofSection>
          <ProofSection title="Required targets">
            <For
              each={requiredTargets()}
              fallback={<EmptyFact>Required target coverage is not frozen.</EmptyFact>}
            >
              {(targetCase) => (
                <FactRow
                  title={targetCase.id}
                  detail={targetLabel(targetCase)}
                  copyValue={JSON.stringify(
                    {
                      executionTarget: targetCase.executionTarget,
                      targetProfile: targetCase.targetProfile,
                    },
                    null,
                    2,
                  )}
                />
              )}
            </For>
          </ProofSection>
        </div>

        <ProofSection title="Runs and evidence">
          <div class="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
            <Metric label="Runs" value={props.proof.runIds.length} />
            <Metric label="Evidence objects" value={props.proof.evidenceDigests.length} />
            <Metric label="Plan versions" value={props.history.length || 1} />
          </div>
          <Show when={props.proof.runIds.length > 0}>
            <div class="mt-2 flex flex-wrap gap-2">
              <For each={props.proof.runIds}>
                {(runId) => (
                  <Button variant="secondary" size="sm" onClick={() => props.onOpenRun(runId)}>
                    Open {runId}
                  </Button>
                )}
              </For>
            </div>
          </Show>
        </ProofSection>

        <ProofSection title="Merge check">
          <Show
            when={latestPublication()}
            fallback={
              <Show
                when={latestPublicationAttempt()}
                fallback={
                  <EmptyFact>
                    No merge provider has acknowledged this exact Proof revision yet.
                  </EmptyFact>
                }
              >
                {(attempt) => (
                  <div class="grid gap-1 rounded-xl bg-surface-base px-3 py-2.5 ring-1 ring-inset ring-border-weak-base">
                    <strong class="text-body font-semibold text-text-strong">
                      {attempt().status === "retry" && attempt().attempts >= attempt().maxAttempts
                        ? "Merge check needs attention"
                        : "Merge check publication pending"}
                    </strong>
                    <span class="text-caption text-text-weak">
                      {attempt().attempts} of {attempt().maxAttempts} publication attempts
                    </span>
                  </div>
                )}
              </Show>
            }
          >
            {(publication) => (
              <div class="grid gap-1 rounded-xl bg-surface-base px-3 py-2.5 ring-1 ring-inset ring-border-weak-base">
                <strong class="text-body font-semibold text-text-strong">
                  GitHub · {publication().conclusion}
                </strong>
                <span class={cn("text-caption text-text-weak", mono)}>
                  Check #{publication().checkRunId} · {shortSha(publication().headSha)}
                </span>
                <Show when={publication().htmlUrl}>
                  {(url) => (
                    <a
                      class="w-fit text-caption font-semibold text-text-interactive-base hover:underline"
                      href={url()}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open merge check
                    </a>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </ProofSection>

        <Show when={props.proof.firstCausalFailure}>
          {(failure) => (
            <section class="grid gap-2 rounded-xl bg-surface-critical-weak p-4 ring-1 ring-inset ring-border-critical-base/35">
              <span class={eyebrow}>First causal failure</span>
              <strong class="text-body font-semibold text-text-critical-base">
                {failure().summary}
              </strong>
              <button
                type="button"
                class="w-fit text-caption font-semibold text-text-interactive-base hover:underline"
                onClick={() => props.onOpenRun(failure().runId)}
              >
                Open {failure().runId}
              </button>
            </section>
          )}
        </Show>

        <Show when={props.proof.coverageGaps.length || props.proof.residualRisk.length}>
          <div class="grid grid-cols-2 gap-6 max-[1020px]:grid-cols-1">
            <ProofSection title="Coverage gaps">
              <For each={props.proof.coverageGaps} fallback={<EmptyFact>None.</EmptyFact>}>
                {(gap) => <ListFact>{gap}</ListFact>}
              </For>
            </ProofSection>
            <ProofSection title="Residual risk">
              <For each={props.proof.residualRisk} fallback={<EmptyFact>None.</EmptyFact>}>
                {(risk) => <ListFact>{risk}</ListFact>}
              </For>
            </ProofSection>
          </div>
        </Show>

        <section class="grid gap-2 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
          <span class={eyebrow}>Next required action</span>
          <strong class="text-body font-semibold text-text-strong">
            {nextRequiredAction(props.proof)}
          </strong>
        </section>
      </div>
    </article>
  );
}

function nextRequiredAction(proof: ChangeVerification): string {
  if (proof.state === "proved") {
    return "No further verification is required for this exact change.";
  }
  if (proof.state === "superseded") {
    return "Open the newer Proof for the current change.";
  }
  if (proof.state === "cancelled") {
    return "This Proof was cancelled. Start a new Proof to verify the change.";
  }
  return proof.smallestNextVerification?.reason ?? "No further action is recorded for this Proof.";
}

function executionHeadline(execution: ChangeProofExecutionSummary): string {
  if (execution.status === "completed") return "Required verification complete";
  if (execution.status === "cancelled") return "Verification cancelled";
  if (execution.status === "uncertain") return "Verification needs review";
  if (execution.status === "queued") return "Preparing required verification";
  return "Running required verification";
}

function executionProgress(execution: ChangeProofExecutionSummary): string {
  if (execution.status === "uncertain") {
    return execution.terminalUncertainty?.reason ?? "Relay cannot safely infer the target outcome.";
  }
  const completed = execution.status === "completed" ? execution.total : execution.cursor;
  return `${completed} of ${execution.total} required ${execution.total === 1 ? "case" : "cases"} complete`;
}

function shortSha(value: string): string {
  return value.slice(0, 12);
}

function changeTitle(proof: ChangeVerification): string {
  return (
    proof.change.agentClaim?.summary ||
    (proof.change.pullRequest
      ? `Pull request #${proof.change.pullRequest}`
      : shortSha(proof.change.headSha))
  );
}

function projectName(proof: ChangeVerification): string {
  return proof.change.repository.split("/").at(-1) ?? proof.change.repository;
}

function targetLabel(targetCase: ChangeVerification["selection"]["targetCases"][number]): string {
  const profile = targetCase.targetProfile;
  const browser = profile.browserCaseProfile;
  if (browser) {
    return `${browser.engine} · ${browser.viewport.width} × ${browser.viewport.height} · ${browser.locale}`;
  }
  return [profile.platform, profile.model, profile.osVersion].filter(Boolean).join(" · ");
}

function ProofSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="grid content-start gap-2">
      <h3 class={cn(eyebrow, "m-0")}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function FactRow(props: { title: string; detail: string; copyValue?: string }) {
  const copy = () => {
    if (!props.copyValue) return;
    void navigator.clipboard
      .writeText(props.copyValue)
      .then(() => toast("Exact identity copied", "success"))
      .catch(() => toast("Could not copy the exact identity", "error"));
  };
  return (
    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-surface-base px-3 py-2.5 ring-1 ring-inset ring-border-weak-base">
      <span class="grid min-w-0 gap-1">
        <strong class="truncate text-body font-semibold text-text-strong" title={props.title}>
          {props.title}
        </strong>
        <span class={cn("truncate text-caption text-text-weak", mono)} title={props.detail}>
          {props.detail}
        </span>
      </span>
      <Show when={props.copyValue}>
        <button
          type="button"
          class={cn(productIconButton, "size-9 max-[820px]:size-11")}
          aria-label={`Copy exact identity for ${props.title}`}
          data-tip="Copy exact identity"
          onClick={copy}
        >
          <Icon name="copy" size={14} />
        </button>
      </Show>
    </div>
  );
}

function Metric(props: { label: string; value: number }) {
  return (
    <div class="grid gap-1 rounded-xl bg-surface-base px-3 py-3 ring-1 ring-inset ring-border-weak-base">
      <strong class={cn("text-title font-semibold text-text-strong", mono)}>{props.value}</strong>
      <span class="text-caption text-text-weak">{props.label}</span>
    </div>
  );
}

function EmptyFact(props: { children: JSX.Element }) {
  return <p class="m-0 text-body/[1.45] text-text-weak">{props.children}</p>;
}

function ListFact(props: { children: JSX.Element }) {
  return (
    <p class="m-0 rounded-lg bg-surface-base px-3 py-2 text-caption/[1.45] text-text-base">
      {props.children}
    </p>
  );
}
