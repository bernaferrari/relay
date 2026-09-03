import { For, Show, createSignal, type JSX } from "solid-js";
import {
  type ChangeProofPublicationOutboxRecord,
  type ChangeProofPublicationReceipt,
  type ChangeProofExecutionSummary,
  type ChangeVerification,
} from "@relay/protocol";
import { cn } from "../lib/cn";
import { mono, eyebrow } from "../lib/ui";
import { Button } from "@relay/ui/button";
import { StatusChip, type StatusChipTone } from "./status-chip";
import type { ProofPrimaryAction } from "../lib/proof-actions";
import { ProofPlanReview } from "./proof-plan-review";
import { ProofIdentityLedger } from "./proof-identity-ledger";
import { proofDisplayTitle } from "../lib/proof-presentation";
import { ScrollArea } from "./scroll-area";

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
  onResumeHumanEvidence: (execution: ChangeProofExecutionSummary, evidenceDigest: string) => void;
  onRetryPublication: (publication: ChangeProofPublicationOutboxRecord) => void;
  onOpenRun: (runId: string) => void;
  onOpenMap: (appMapId: string) => void;
}) {
  const [humanEvidenceDigest, setHumanEvidenceDigest] = createSignal("");
  const latestPublication = () =>
    props.publications.reduce<ChangeProofPublicationReceipt | undefined>((latest, candidate) => {
      if (!latest) return candidate;
      const latestVersion = latest.proofVersion ?? 0;
      const candidateVersion = candidate.proofVersion ?? 0;
      return candidateVersion > latestVersion ||
        (candidateVersion === latestVersion && candidate.publishedAt > latest.publishedAt)
        ? candidate
        : latest;
    }, undefined);
  const latestPublicationAttempt = () =>
    props.publicationOutbox.reduce<ChangeProofPublicationOutboxRecord | undefined>(
      (latest, candidate) =>
        !latest ||
        candidate.proofVersion > latest.proofVersion ||
        (candidate.proofVersion === latest.proofVersion && candidate.updatedAt > latest.updatedAt)
          ? candidate
          : latest,
      undefined,
    );
  const acknowledgedPublication = () => {
    const receipt = latestPublication();
    const attempt = latestPublicationAttempt();
    if (attempt?.status === "published" && attempt.receipt) return attempt.receipt;
    if (!receipt || (attempt && (receipt.proofVersion ?? 0) < attempt.proofVersion))
      return undefined;
    return receipt;
  };

  return (
    <ScrollArea as="article" class="flex-1 p-[clamp(1.25rem,3vw,2.5rem)]">
      <div class="grid gap-8">
        <header class="grid gap-3 border-b border-border-weak-base pb-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="m-0 min-w-0 text-title font-semibold tracking-[-0.02em] text-text-strong">
              {proofDisplayTitle(props.proof)}
            </h2>
            <StatusChip tone={props.status.tone} label={props.status.label} />
          </div>
          <Show when={props.proof.change.pullRequest && props.proof.change.agentClaim?.summary}>
            <p class="m-0 text-body text-text-base">
              Pull request #{props.proof.change.pullRequest}
            </p>
          </Show>
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
          <Show when={props.execution?.status !== "completed" ? props.execution : undefined}>
            {(execution) => (
              <div class="grid gap-1 border-t border-border-weak-base pt-3" aria-live="polite">
                <Show when={execution().status !== "completed"}>
                  <strong class="text-body font-semibold text-text-strong">
                    {executionHeadline(execution())}
                  </strong>
                </Show>
                <span class="text-caption tabular-nums text-text-weak">
                  {executionProgress(execution())}
                </span>
                <Show when={execution().status === "paused-human" && execution().humanIntervention}>
                  {(intervention) => (
                    <div class="mt-2 grid gap-2 border-t border-border-weak-base pt-2">
                      <strong class="text-caption font-semibold text-text-strong">
                        Human step required: {intervention().stepId}
                      </strong>
                      <span class="text-caption/[1.45] text-text-weak">
                        {intervention().reason} Record the evidence digest after completing this
                        exact step to resume the Proof.
                      </span>
                      <label class="grid gap-1 text-caption font-medium text-text-base">
                        Evidence digest
                        <input
                          class="min-h-10 rounded-lg border border-border-base bg-surface-raised px-2.5 text-body text-text-strong outline-none focus:border-border-interactive-base focus:ring-2 focus:ring-border-interactive-base/30"
                          inputMode="text"
                          placeholder="sha256:…"
                          value={humanEvidenceDigest()}
                          aria-describedby="proof-human-evidence-help"
                          onInput={(event) => setHumanEvidenceDigest(event.currentTarget.value)}
                        />
                      </label>
                      <span id="proof-human-evidence-help" class="text-micro text-text-weak">
                        Use the SHA-256 digest of the reviewed human-step evidence.
                      </span>
                      <div>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={Boolean(props.actionBusy) || !humanEvidenceDigest().trim()}
                          onClick={() =>
                            props.onResumeHumanEvidence(execution(), humanEvidenceDigest())
                          }
                        >
                          {props.actionBusy === "human-evidence"
                            ? "Recording evidence…"
                            : "Record evidence and resume"}
                        </Button>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </header>

        <ProofPlanReview proof={props.proof} onOpenMap={props.onOpenMap} />

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

        <ProofIdentityLedger proof={props.proof} publication={acknowledgedPublication()} />

        <ProofSection title="Merge check">
          <Show
            when={acknowledgedPublication()}
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
                    <Show
                      when={
                        attempt().status === "retry" && attempt().attempts >= attempt().maxAttempts
                      }
                    >
                      <div class="mt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={Boolean(props.actionBusy)}
                          onClick={() => props.onRetryPublication(attempt())}
                        >
                          {props.actionBusy === "retry-publication"
                            ? "Retrying merge check…"
                            : "Retry merge check"}
                        </Button>
                      </div>
                    </Show>
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

        <Show when={props.proof.state !== "proved"}>
          <section class="grid gap-2 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
            <span class={eyebrow}>Next required action</span>
            <strong class="text-body font-semibold text-text-strong">
              {nextRequiredAction(props.proof)}
            </strong>
          </section>
        </Show>
      </div>
    </ScrollArea>
  );
}

function nextRequiredAction(proof: ChangeVerification): string {
  if (proof.state === "superseded") {
    return "Open the newer Proof for the current change.";
  }
  if (proof.state === "cancelled") {
    return "This Proof was cancelled. Start a new Proof to verify the change.";
  }
  return proof.smallestNextVerification?.reason ?? "No further action is recorded for this Proof.";
}

function executionHeadline(execution: ChangeProofExecutionSummary): string {
  if (execution.status === "completed") return "Verification complete";
  if (execution.status === "cancelled") return "Verification cancelled";
  if (execution.status === "uncertain") return "Verification needs review";
  if (execution.status === "queued") return "Preparing verification";
  return "Running verification";
}

function executionProgress(execution: ChangeProofExecutionSummary): string {
  if (execution.status === "uncertain") {
    return execution.terminalUncertainty?.reason ?? "Relay cannot safely infer the target outcome.";
  }
  const completed = execution.status === "completed" ? execution.total : execution.cursor;
  return `${completed} of ${execution.total} verification ${execution.total === 1 ? "cell" : "cells"} complete`;
}

function shortSha(value: string): string {
  return value.slice(0, 12);
}

function ProofSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="grid content-start gap-2">
      <h3 class={cn(eyebrow, "m-0")}>{props.title}</h3>
      {props.children}
    </section>
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
