import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import { Button } from "@relay/ui/button";
import type { ChangeVerification, ChangeVerificationState } from "@relay/protocol";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { eyebrow, mono, productIconButton, productPage } from "../lib/ui";
import { Icon } from "./icon";
import { StatusChip, type StatusChipTone } from "./status-chip";

const statePresentation: Record<
  ChangeVerificationState,
  { label: string; tone: StatusChipTone }
> = {
  planning: { label: "Planning", tone: "idle" },
  "awaiting-build": { label: "Awaiting build", tone: "attention" },
  ready: { label: "Ready", tone: "idle" },
  "running-pilot": { label: "Running pilot", tone: "run" },
  "awaiting-expansion": { label: "Pilot passed", tone: "run" },
  running: { label: "Running coverage", tone: "run" },
  proved: { label: "Proved", tone: "pass" },
  rejected: { label: "Rejected", tone: "fail" },
  "needs-review": { label: "Needs review", tone: "attention" },
  "insufficient-evidence": { label: "Insufficient evidence", tone: "attention" },
  cancelled: { label: "Cancelled", tone: "idle" },
  superseded: { label: "Superseded", tone: "idle" },
};

function shortSha(value: string): string {
  return value.slice(0, 12);
}

function changeTitle(proof: ChangeVerification): string {
  return (
    proof.change.agentClaim?.summary ||
    (proof.change.pullRequest ? `Pull request #${proof.change.pullRequest}` : shortSha(proof.change.headSha))
  );
}

function targetLabel(targetCase: ChangeVerification["selection"]["targetCases"][number]): string {
  const profile = targetCase.targetProfile;
  const browser = profile.browserCaseProfile;
  if (browser) {
    return `${browser.engine} · ${browser.viewport.width} × ${browser.viewport.height} · ${browser.locale}`;
  }
  return [profile.platform, profile.model, profile.osVersion].filter(Boolean).join(" · ");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function ChangesWorkspace(props: {
  onOpenRun: (runId: string) => void;
  onOpenMap: (appMapId: string) => void;
}) {
  const server = useServer();
  const [proofs, setProofs] = createSignal<readonly ChangeVerification[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(
    new URLSearchParams(window.location.search).get("proof"),
  );
  const [selected, setSelected] = createSignal<ChangeVerification | null>(null);
  const [history, setHistory] = createSignal<readonly ChangeVerification[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await server.runAction("proof.list", { limit: 100 });
      setProofs(result.proofs);
      setSelectedId((current) =>
        current && result.proofs.some(({ id }) => id === current)
          ? current
          : (result.proofs[0]?.id ?? null),
      );
    } catch (cause) {
      setError(humanError(cause, "Could not load Proofs"));
    } finally {
      setLoading(false);
    }
  }

  let inspectedId: string | null = null;
  createEffect(() => {
    const proofId = selectedId();
    if (!proofId) {
      inspectedId = null;
      setSelected(null);
      setHistory([]);
      return;
    }
    const immediate = proofs().find(({ id }) => id === proofId) ?? null;
    setSelected(immediate);
    if (inspectedId === proofId) return;
    inspectedId = proofId;
    void server
      .runAction("proof.inspect", { proofId, includeHistory: true })
      .then((result) => {
        if (selectedId() !== proofId) return;
        setSelected(result.proof);
        setHistory(result.history ?? []);
      })
      .catch((cause) => {
        if (selectedId() === proofId) setError(humanError(cause, "Could not inspect this Proof"));
      });
  });

  onMount(() => void refresh());

  const selectedStatus = createMemo(() => {
    const proof = selected();
    return proof ? statePresentation[proof.state] : statePresentation.planning;
  });
  const requiredTargets = createMemo(
    () => selected()?.selection.targetCases.filter(({ required }) => required) ?? [],
  );
  const evidenceCount = createMemo(() => selected()?.evidenceDigests.length ?? 0);

  return (
    <section class={cn(productPage, "flex flex-col gap-6")} aria-label="Changes and Proofs">
      <header class="mx-auto flex w-full max-w-[1180px] items-start justify-between gap-6">
        <div class="grid max-w-[760px] gap-2">
          <span class={eyebrow}>Merge trust</span>
          <h1 class="m-0 text-display font-semibold tracking-[-0.035em] text-text-strong">
            Prove a change
          </h1>
          <p class="m-0 text-body/[1.5] text-text-base">
            Inspect why Relay selected each journey, which exact builds and targets ran, what
            evidence is complete, and whether this head earned permission to merge.
          </p>
        </div>
        <button
          type="button"
          class={productIconButton}
          aria-label="Refresh Proofs"
          disabled={loading()}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" size={16} />
        </button>
      </header>

      <Show when={error()}>
        {(message) => (
          <div
            class="mx-auto w-full max-w-[1180px] rounded-xl bg-surface-critical-weak px-4 py-3 text-body text-text-critical-base ring-1 ring-inset ring-border-critical-base/40"
            role="alert"
          >
            {message()}
          </div>
        )}
      </Show>

      <Show
        when={proofs().length > 0}
        fallback={
          <div class="mx-auto grid w-full max-w-[760px] justify-items-center gap-3 rounded-2xl bg-surface-raised-stronger-non-alpha px-8 py-14 text-center ring-1 ring-inset ring-border-weak-base">
            <span class="grid size-12 place-items-center rounded-2xl bg-[var(--product-accent-soft)] text-text-interactive-base">
              <Icon name="check" size={21} />
            </span>
            <h2 class="m-0 text-title font-semibold text-text-strong">No Proofs yet</h2>
            <p class="m-0 max-w-[50ch] text-body/[1.5] text-text-base">
              Start with <span class={mono}>relay proof start</span>. Relay will keep unknown impact,
              missing builds, and incomplete evidence visible instead of inventing a pass.
            </p>
          </div>
        }
      >
        <div class="mx-auto grid min-h-[520px] w-full max-w-[1180px] grid-cols-[minmax(240px,320px)_minmax(0,1fr)] overflow-hidden rounded-2xl bg-surface-raised-stronger-non-alpha ring-1 ring-inset ring-border-weak-base max-[820px]:grid-cols-1">
          <nav
            class="min-h-0 border-r border-border-weak-base p-2 max-[820px]:max-h-[260px] max-[820px]:overflow-y-auto max-[820px]:border-r-0 max-[820px]:border-b"
            aria-label="Proofs"
          >
            <For each={proofs()}>
              {(proof) => {
                const status = statePresentation[proof.state];
                const active = () => selectedId() === proof.id;
                return (
                  <button
                    type="button"
                    class={cn(
                      "grid min-h-[68px] w-full gap-1 rounded-xl px-3 py-2.5 text-left transition-colors",
                      active() ? "bg-surface-base-active" : "hover:bg-surface-raised-base-hover",
                    )}
                    aria-current={active() ? "page" : undefined}
                    onClick={() => setSelectedId(proof.id)}
                  >
                    <span class="flex min-w-0 items-center justify-between gap-2">
                      <strong class="truncate text-body font-semibold text-text-strong">
                        {changeTitle(proof)}
                      </strong>
                      <span
                        class={cn(
                          "size-2 shrink-0 rounded-full",
                          status.tone === "pass"
                            ? "bg-icon-success-base"
                            : status.tone === "fail"
                              ? "bg-icon-critical-base"
                              : status.tone === "run"
                                ? "bg-text-interactive-base"
                                : "bg-icon-warning-base",
                        )}
                        aria-hidden="true"
                      />
                    </span>
                    <small class="truncate text-caption text-text-weak">
                      {proof.change.repository} · {shortSha(proof.change.headSha)}
                    </small>
                    <small class="text-micro font-medium text-text-weaker">{status.label}</small>
                  </button>
                );
              }}
            </For>
          </nav>

          <Show
            when={selected()}
            fallback={<div class="grid place-items-center p-8 text-body text-text-weak">Select a Proof.</div>}
          >
            {(proof) => (
              <article class="min-w-0 overflow-y-auto p-[clamp(1.25rem,3vw,2.5rem)]">
                <div class="grid gap-8">
                  <header class="grid gap-3 border-b border-border-weak-base pb-6">
                    <div class="flex flex-wrap items-center gap-2">
                      <StatusChip tone={selectedStatus().tone} label={selectedStatus().label} />
                      <span class={cn("text-caption text-text-weak", mono)}>
                        {shortSha(proof().change.baseSha)} → {shortSha(proof().change.headSha)}
                      </span>
                    </div>
                    <h2 class="m-0 text-title font-semibold tracking-[-0.02em] text-text-strong">
                      {changeTitle(proof())}
                    </h2>
                    <p class="m-0 text-body text-text-base">
                      {proof().change.repository}
                      {proof().change.pullRequest ? ` · PR #${proof().change.pullRequest}` : ""}
                    </p>
                    <Show when={proof().change.agentClaim?.acceptanceCriteria.length}>
                      <ul class="m-0 grid gap-1.5 pl-5 text-body/[1.45] text-text-base">
                        <For each={proof().change.agentClaim!.acceptanceCriteria}>
                          {(criterion) => <li>{criterion}</li>}
                        </For>
                      </ul>
                    </Show>
                  </header>

                  <ProofSection title="Why these journeys">
                    <For
                      each={proof().selection.affectedJourneys}
                      fallback={<EmptyFact>No affected journey has been proved yet.</EmptyFact>}
                    >
                      {(journey) => (
                        <button
                          type="button"
                          class="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-left hover:bg-surface-raised-base-hover"
                          onClick={() => props.onOpenMap(journey.appMapId)}
                        >
                          <strong class="text-body font-semibold text-text-strong">
                            {journey.testId}
                          </strong>
                          <span class="text-caption font-medium text-text-weak">
                            {journey.confidence}
                          </span>
                          <span class="col-span-2 text-caption/[1.45] text-text-base">
                            {journey.reason}
                          </span>
                        </button>
                      )}
                    </For>
                  </ProofSection>

                  <div class="grid grid-cols-2 gap-6 max-[1020px]:grid-cols-1">
                    <ProofSection title="Exact builds">
                      <For each={proof().builds} fallback={<EmptyFact>Exact build required.</EmptyFact>}>
                        {(build) => (
                          <FactRow
                            title={`${build.platform} · ${build.configuration}`}
                            detail={`${build.artifactDigest.slice(0, 23)}… · ${build.environmentRevision}`}
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
                          <FactRow title={targetCase.id} detail={targetLabel(targetCase)} />
                        )}
                      </For>
                    </ProofSection>
                  </div>

                  <ProofSection title="Runs and evidence">
                    <div class="grid grid-cols-3 gap-3 max-[760px]:grid-cols-1">
                      <Metric label="Runs" value={proof().runIds.length} />
                      <Metric label="Evidence objects" value={evidenceCount()} />
                      <Metric label="Plan versions" value={history().length || 1} />
                    </div>
                    <Show when={proof().runIds.length > 0}>
                      <div class="mt-2 flex flex-wrap gap-2">
                        <For each={proof().runIds}>
                          {(runId) => (
                            <Button variant="secondary" size="sm" onClick={() => props.onOpenRun(runId)}>
                              Open {runId}
                            </Button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </ProofSection>

                  <Show when={proof().firstCausalFailure}>
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

                  <Show when={proof().coverageGaps.length || proof().residualRisk.length}>
                    <div class="grid grid-cols-2 gap-6 max-[1020px]:grid-cols-1">
                      <ProofSection title="Coverage gaps">
                        <For each={proof().coverageGaps} fallback={<EmptyFact>None.</EmptyFact>}>
                          {(gap) => <ListFact>{gap}</ListFact>}
                        </For>
                      </ProofSection>
                      <ProofSection title="Residual risk">
                        <For each={proof().residualRisk} fallback={<EmptyFact>None.</EmptyFact>}>
                          {(risk) => <ListFact>{risk}</ListFact>}
                        </For>
                      </ProofSection>
                    </div>
                  </Show>

                  <section class="grid gap-2 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
                    <span class={eyebrow}>Next required action</span>
                    <strong class="text-body font-semibold text-text-strong">
                      {proof().smallestNextVerification?.reason ??
                        "No further action is recorded for this Proof."}
                    </strong>
                  </section>
                </div>
              </article>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}

function ProofSection(props: { title: string; children: unknown }) {
  return (
    <section class="grid content-start gap-2">
      <h3 class={cn(eyebrow, "m-0")}>{props.title}</h3>
      {props.children as never}
    </section>
  );
}

function FactRow(props: { title: string; detail: string }) {
  return (
    <div class="grid gap-1 rounded-xl bg-surface-base px-3 py-2.5 ring-1 ring-inset ring-border-weak-base">
      <strong class="truncate text-body font-semibold text-text-strong">{props.title}</strong>
      <span class={cn("truncate text-caption text-text-weak", mono)}>{props.detail}</span>
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

function EmptyFact(props: { children: unknown }) {
  return <p class="m-0 text-body/[1.45] text-text-weak">{props.children as never}</p>;
}

function ListFact(props: { children: unknown }) {
  return (
    <p class="m-0 rounded-lg bg-surface-base px-3 py-2 text-caption/[1.45] text-text-base">
      {props.children as never}
    </p>
  );
}
