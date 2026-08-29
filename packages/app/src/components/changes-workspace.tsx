import { For, Show, type JSX, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import {
  VERIFY_CHANGE_POLICY,
  type ChangeProofPublicationReceipt,
  type ChangeProofPublicationOutboxRecord,
  type ChangeVerification,
  type ChangeVerificationState,
  type WorkspaceChangeContext,
} from "@relay/protocol";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { eyebrow, mono, productIconButton, productPage } from "../lib/ui";
import { Icon } from "./icon";
import type { StatusChipTone } from "./status-chip";
import { ProofDetail } from "./proof-detail";

const statePresentation: Record<ChangeVerificationState, { label: string; tone: StatusChipTone }> =
  {
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

type ProofDraft = {
  pullRequest: string;
  summary: string;
  acceptanceCriteria: string;
};

type ProofDraftField = keyof ProofDraft;
type ProofDraftErrors = Partial<Record<ProofDraftField, string>>;

const emptyProofDraft: ProofDraft = {
  pullRequest: "",
  summary: "",
  acceptanceCriteria: "",
};

const proofInput =
  "min-h-11 w-full rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-title/[1.4] text-text-strong outline-none transition-[border-color,box-shadow] placeholder:text-text-weaker focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-strong-focus disabled:cursor-not-allowed disabled:text-text-weaker aria-[invalid=true]:border-border-critical-base";

function normalizedDraft(draft: ProofDraft): ProofDraft {
  return {
    pullRequest: draft.pullRequest.trim(),
    summary: draft.summary.trim(),
    acceptanceCriteria: draft.acceptanceCriteria.trim(),
  };
}

function validateProofDraft(draftInput: ProofDraft): ProofDraftErrors {
  const draft = normalizedDraft(draftInput);
  const errors: ProofDraftErrors = {};
  if (draft.pullRequest) {
    const value = Number(draft.pullRequest);
    if (!Number.isSafeInteger(value) || value <= 0) {
      errors.pullRequest = "Pull request must be a positive whole number.";
    }
  }
  if (draft.acceptanceCriteria && !draft.summary) {
    errors.summary = "Summarize the change before adding acceptance criteria.";
  }
  const criteria = draft.acceptanceCriteria
    .split("\n")
    .map((criterion) => criterion.trim())
    .filter(Boolean);
  if (criteria.length > 64) {
    errors.acceptanceCriteria = "Keep the claim to 64 acceptance criteria or fewer.";
  } else if (criteria.some((criterion) => criterion.length > 4096)) {
    errors.acceptanceCriteria = "Each acceptance criterion must be 4,096 characters or fewer.";
  }
  return errors;
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
  const [publications, setPublications] = createSignal<readonly ChangeProofPublicationReceipt[]>(
    [],
  );
  const [publicationOutbox, setPublicationOutbox] = createSignal<
    readonly ChangeProofPublicationOutboxRecord[]
  >([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [draft, setDraft] = createSignal<ProofDraft>({ ...emptyProofDraft });
  const [draftErrors, setDraftErrors] = createSignal<ProofDraftErrors>({});
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [workspaceChange, setWorkspaceChange] = createSignal<WorkspaceChangeContext | null>(null);
  const [resolvingWorkspace, setResolvingWorkspace] = createSignal(false);

  function setDraftField(field: ProofDraftField, value: string): void {
    const nextDraft = { ...draft(), [field]: value };
    setDraft(nextDraft);
    const visibleErrors = draftErrors();
    if (!Object.keys(visibleErrors).length) return;
    const nextErrors = validateProofDraft(nextDraft);
    const remainingErrors: ProofDraftErrors = {};
    for (const visibleField of Object.keys(visibleErrors) as ProofDraftField[]) {
      const nextError = nextErrors[visibleField];
      if (nextError) remainingErrors[visibleField] = nextError;
    }
    setDraftErrors(remainingErrors);
  }

  function validateDraftField(field: ProofDraftField): void {
    setDraftErrors((current) => ({ ...current, [field]: validateProofDraft(draft())[field] }));
  }

  function closeCreation(): void {
    if (submitting()) return;
    setCreating(false);
    setCreateError(null);
    setDraftErrors({});
  }

  async function resolveWorkspaceChange(baseRef?: string): Promise<void> {
    setResolvingWorkspace(true);
    setCreateError(null);
    try {
      const result = await server.runAction("workspace.change.inspect", baseRef ? { baseRef } : {});
      setWorkspaceChange(result.change);
    } catch (cause) {
      setWorkspaceChange(null);
      setCreateError(humanError(cause, "Could not inspect the active workspace"));
    } finally {
      setResolvingWorkspace(false);
    }
  }

  function openCreation(): void {
    setCreating(true);
    setCreateError(null);
    void resolveWorkspaceChange();
  }

  async function submitProof(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting()) return;
    const normalized = normalizedDraft(draft());
    const change = workspaceChange();
    if (!change?.readyForProof || !change.repository || !change.base || !change.head) {
      setCreateError("Relay could not bind this Proof to one exact workspace change.");
      return;
    }
    const validation = validateProofDraft(normalized);
    setDraftErrors(validation);
    const firstInvalid = Object.keys(validation)[0] as ProofDraftField | undefined;
    if (firstInvalid) {
      document.getElementById(`proof-${firstInvalid}`)?.focus();
      return;
    }

    setSubmitting(true);
    setCreateError(null);
    try {
      const criteria = normalized.acceptanceCriteria
        .split("\n")
        .map((criterion) => criterion.trim())
        .filter(Boolean);
      const result = await server.runAction("proof.start", {
        change: {
          repository: change.repository,
          baseSha: change.base.sha,
          headSha: change.head.sha,
          ...(normalized.pullRequest ? { pullRequest: Number(normalized.pullRequest) } : {}),
          ...(normalized.summary
            ? {
                agentClaim: {
                  summary: normalized.summary,
                  acceptanceCriteria: criteria,
                },
              }
            : {}),
        },
        policy: VERIFY_CHANGE_POLICY,
      });
      setDraft({ ...emptyProofDraft });
      setCreating(false);
      await refresh();
      setSelectedId(result.proof.id);
    } catch (cause) {
      setCreateError(humanError(cause, "Could not start this Proof"));
    } finally {
      setSubmitting(false);
    }
  }

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
      setPublications([]);
      setPublicationOutbox([]);
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
        setPublications(result.publications);
        setPublicationOutbox(result.publicationOutbox);
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
  return (
    <section class={cn(productPage, "flex flex-col gap-6")} aria-label="Changes and Proofs">
      <header class="mx-auto flex w-full max-w-[1180px] items-start justify-between gap-6 max-[620px]:flex-col">
        <div class="grid max-w-[760px] gap-2">
          <span class={eyebrow}>Merge trust</span>
          <h1 class="m-0 text-display font-semibold tracking-[-0.035em] text-text-strong">
            Prove a change
          </h1>
          <p class="m-0 text-body/[1.5] text-text-base">
            Inspect why Relay selected each journey, which exact builds and targets ran, what
            evidence is complete, and whether this change earned permission to merge.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2 max-[620px]:self-stretch">
          <Show when={!creating()}>
            <Button variant="primary" onClick={openCreation}>
              Start a Proof
            </Button>
          </Show>
          <button
            type="button"
            class={productIconButton}
            aria-label="Refresh Proofs"
            disabled={loading()}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </header>

      <Show when={creating()}>
        <form
          class="mx-auto grid w-full max-w-[760px] gap-5 rounded-2xl bg-surface-raised-stronger-non-alpha p-[clamp(1rem,3vw,1.75rem)] ring-1 ring-inset ring-border-weak-base"
          aria-label="Start a Proof"
          onSubmit={(event) => void submitProof(event)}
        >
          <div class="grid gap-1">
            <h2 class="m-0 text-title font-semibold text-text-strong">Review the current change</h2>
            <p class="m-0 text-body/[1.5] text-text-base">
              This starts an awaiting-build Proof. It cannot clear a merge until exact builds,
              affected journeys, required targets, and complete evidence are attached.
            </p>
          </div>

          <div class="grid gap-4 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
            <div class="flex min-w-0 items-start justify-between gap-4 max-[620px]:flex-col">
              <div class="grid min-w-0 gap-1">
                <span class={eyebrow}>Active workspace</span>
                <Show
                  when={!resolvingWorkspace() && workspaceChange()}
                  fallback={
                    <strong class="text-body font-semibold text-text-strong" aria-live="polite">
                      Inspecting the current change…
                    </strong>
                  }
                >
                  {(change) => (
                    <>
                      <strong class="truncate text-title font-semibold text-text-strong">
                        {change().workspace.name}
                      </strong>
                      <span class="text-body text-text-base">
                        {change().head?.label ?? "Current revision unavailable"}
                      </span>
                      <span class="text-caption text-text-weak">
                        {change().branch ? `${change().branch} · ` : ""}
                        {change().changedFileCount} changed{" "}
                        {change().changedFileCount === 1 ? "file" : "files"}
                      </span>
                    </>
                  )}
                </Show>
              </div>
              <button
                type="button"
                class={cn(productIconButton, "shrink-0")}
                aria-label="Inspect the active workspace again"
                disabled={resolvingWorkspace() || submitting()}
                onClick={() => void resolveWorkspaceChange()}
              >
                <Icon name="refresh" size={16} />
              </button>
            </div>

            <Show when={workspaceChange()?.status === "needs-selection"}>
              <label
                class="grid gap-1.5 text-caption font-medium text-text-strong"
                for="proof-base"
              >
                <span>Compare this change with</span>
                <select
                  id="proof-base"
                  class={proofInput}
                  disabled={resolvingWorkspace() || submitting()}
                  value=""
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value) void resolveWorkspaceChange(value);
                  }}
                >
                  <option value="">Choose a reviewed branch…</option>
                  <For each={workspaceChange()?.baseCandidates ?? []}>
                    {(candidate) => <option value={candidate.ref}>{candidate.label}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={workspaceChange()?.blockers.length}>
              <ul
                class="m-0 grid gap-1 pl-5 text-caption/[1.45] text-text-critical-base"
                role="alert"
              >
                <For each={workspaceChange()?.blockers ?? []}>
                  {(blocker) => <li>{blocker}</li>}
                </For>
              </ul>
            </Show>

            <p class="m-0 text-caption/[1.45] text-text-weak">
              Relay reads this from the active workspace. Restored tabs and previous-session views
              never choose the change.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
            <ProofField
              label="Pull request (optional)"
              field="pullRequest"
              error={draftErrors().pullRequest}
            >
              <input
                id="proof-pullRequest"
                class={proofInput}
                type="number"
                inputmode="numeric"
                value={draft().pullRequest}
                min="1"
                step="1"
                disabled={submitting()}
                autocomplete="off"
                data-1p-ignore
                aria-invalid={Boolean(draftErrors().pullRequest)}
                aria-describedby={draftErrors().pullRequest ? "proof-pullRequest-error" : undefined}
                placeholder="184"
                onInput={(event) => setDraftField("pullRequest", event.currentTarget.value)}
                onBlur={() => validateDraftField("pullRequest")}
              />
            </ProofField>
          </div>

          <ProofField
            label="Agent completion claim (optional)"
            field="summary"
            error={draftErrors().summary}
          >
            <textarea
              id="proof-summary"
              class={cn(proofInput, "min-h-24 resize-y")}
              value={draft().summary}
              maxLength={4096}
              rows={3}
              disabled={submitting()}
              spellcheck
              autocomplete="off"
              aria-invalid={Boolean(draftErrors().summary)}
              aria-describedby={draftErrors().summary ? "proof-summary-error" : undefined}
              placeholder="What did the coding agent say it finished?"
              onInput={(event) => setDraftField("summary", event.currentTarget.value)}
              onBlur={() => validateDraftField("summary")}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </ProofField>

          <ProofField
            label="Acceptance criteria (optional, one per line)"
            field="acceptanceCriteria"
            error={draftErrors().acceptanceCriteria}
          >
            <textarea
              id="proof-acceptanceCriteria"
              class={cn(proofInput, "min-h-24 resize-y")}
              value={draft().acceptanceCriteria}
              maxLength={16384}
              rows={3}
              disabled={submitting()}
              spellcheck
              autocomplete="off"
              aria-invalid={Boolean(draftErrors().acceptanceCriteria)}
              aria-describedby={
                draftErrors().acceptanceCriteria ? "proof-acceptanceCriteria-error" : undefined
              }
              placeholder={"Settings render in Arabic\nCompact layouts have no overlap"}
              onInput={(event) => setDraftField("acceptanceCriteria", event.currentTarget.value)}
              onBlur={() => validateDraftField("acceptanceCriteria")}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </ProofField>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-weak-base pt-4">
            <span class="text-caption text-text-weak">
              Policy:{" "}
              <span class={mono}>
                {VERIFY_CHANGE_POLICY.id}@{VERIFY_CHANGE_POLICY.version}
              </span>
            </span>
            <div class="flex gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={submitting()}
                onClick={closeCreation}
              >
                Cancel
              </Button>
              <Button
                class="min-w-28"
                variant="primary"
                type="submit"
                disabled={submitting() || resolvingWorkspace() || !workspaceChange()?.readyForProof}
              >
                {submitting() ? "Starting…" : "Start Proof"}
              </Button>
            </div>
          </div>
          <Show when={createError()}>
            {(message) => (
              <p class="m-0 text-body text-text-critical-base" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </form>
      </Show>

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
          <Show when={!creating()}>
            <div class="mx-auto grid w-full max-w-[760px] justify-items-center gap-3 rounded-2xl bg-surface-raised-stronger-non-alpha px-8 py-14 text-center ring-1 ring-inset ring-border-weak-base">
              <span class="grid size-12 place-items-center rounded-2xl bg-[var(--product-accent-soft)] text-text-interactive-base">
                <Icon name="check" size={21} />
              </span>
              <h2 class="m-0 text-title font-semibold text-text-strong">No Proofs yet</h2>
              <p class="m-0 max-w-[50ch] text-body/[1.5] text-text-base">
                Relay binds the active workspace to one exact change. Unknown impact, missing
                builds, and incomplete evidence stay visible instead of becoming an invented pass.
              </p>
              <Button variant="primary" onClick={openCreation}>
                Start a Proof
              </Button>
            </div>
          </Show>
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
                      {proof.change.repository.split("/").at(-1) ?? proof.change.repository}
                      {proof.change.pullRequest ? ` · #${proof.change.pullRequest}` : ""}
                    </small>
                    <small class="text-micro font-medium text-text-weaker">{status.label}</small>
                  </button>
                );
              }}
            </For>
          </nav>

          <Show
            when={selected()}
            fallback={
              <div class="grid place-items-center p-8 text-body text-text-weak">
                Select a Proof.
              </div>
            }
          >
            {(proof) => (
              <ProofDetail
                proof={proof()}
                status={selectedStatus()}
                history={history()}
                publications={publications()}
                publicationOutbox={publicationOutbox()}
                onOpenRun={props.onOpenRun}
                onOpenMap={props.onOpenMap}
              />
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}

function ProofField(props: {
  label: string;
  field: ProofDraftField;
  error?: string;
  children: JSX.Element;
}) {
  return (
    <label
      for={`proof-${props.field}`}
      class="grid content-start gap-1.5 text-caption font-medium text-text-strong"
    >
      <span>{props.label}</span>
      {props.children}
      <Show when={props.error}>
        {(message) => (
          <span
            id={`proof-${props.field}-error`}
            class="text-caption/[1.4] text-text-critical-base"
            role="alert"
          >
            {message()}
          </span>
        )}
      </Show>
    </label>
  );
}
