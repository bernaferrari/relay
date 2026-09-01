import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  VERIFY_CHANGE_POLICY,
  changeTestedSha,
  type ChangeProofPublicationReceipt,
  type ChangeProofPublicationOutboxRecord,
  type ChangeVerification,
  type ChangeProofExecutionSummary,
  type ChangeProofExecutionPreview,
  type WorkspaceChangeContext,
} from "@relay/protocol";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { proofCanCancel, proofPrimaryAction } from "../lib/proof-actions";
import { productPage } from "../lib/ui";
import { ChangesProofCreateForm } from "./changes-proof-create-form";
import { ChangesProofSetup } from "./changes-proof-setup";
import {
  emptyProofDraft,
  normalizedProofDraft,
  validateProofDraft,
  type ProofDraft,
  type ProofDraftErrors,
  type ProofDraftField,
} from "./changes-proof-draft";
import { confirmAction } from "./confirm-dialog";
import { Icon } from "./icon";
import { ProofDetail } from "./proof-detail";
import { proofPlanSummary } from "./proof-plan-review";
import { ChangesWorkspaceHeader } from "./changes-workspace-header";
import { ChangesWorkspaceListFallback } from "./changes-workspace-list-fallback";
import { ChangesWorkspaceProofList, proofStatePresentation } from "./changes-workspace-proof-list";
import { watchActiveProofExecution } from "../lib/proof-execution-watch";

export function ChangesWorkspace(props: {
  onOpenRun: (runId: string) => void;
  onOpenMap: (appMapId: string) => void;
  liveRefreshMs?: number;
}) {
  const server = useServer();
  const initialProofId = new URLSearchParams(window.location.search).get("proof");
  const [proofs, setProofs] = createSignal<readonly ChangeVerification[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(initialProofId);
  const [mobileDetailOpen, setMobileDetailOpen] = createSignal(Boolean(initialProofId));
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
  const [settingUp, setSettingUp] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [draft, setDraft] = createSignal<ProofDraft>({ ...emptyProofDraft });
  const [draftErrors, setDraftErrors] = createSignal<ProofDraftErrors>({});
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [workspaceChange, setWorkspaceChange] = createSignal<WorkspaceChangeContext | null>(null);
  const [proofBaseRef, setProofBaseRef] = createSignal<string | null>(null);
  const [resolvingWorkspace, setResolvingWorkspace] = createSignal(false);
  const [proofActionBusy, setProofActionBusy] = createSignal<string | null>(null);
  const [proofActionError, setProofActionError] = createSignal<string | null>(null);
  const [execution, setExecution] = createSignal<ChangeProofExecutionSummary | null>(null);
  const [inspecting, setInspecting] = createSignal(false);
  let page: HTMLElement | undefined;
  let inspectionRequest = 0;
  let previousHealth = server.health();

  function resetMobileScroll(): void {
    queueMicrotask(() => {
      if (page) page.scrollTop = 0;
    });
  }

  function adoptProof(proof: ChangeVerification): void {
    setProofs((current) => {
      const found = current.some(({ id }) => id === proof.id);
      return found
        ? current.map((candidate) => (candidate.id === proof.id ? proof : candidate))
        : [proof, ...current];
    });
    setSelected(proof);
  }

  function clearSelectedProof(): void {
    inspectionRequest += 1;
    setSelectedId(null);
    setSelected(null);
    setHistory([]);
    setPublications([]);
    setPublicationOutbox([]);
    setExecution(null);
    setProofActionError(null);
    setInspecting(false);
  }

  function primeSelectedProof(proofId: string): void {
    const changed = selectedId() !== proofId;
    setSelectedId(proofId);
    if (!changed && selected()) return;
    setSelected(proofs().find(({ id }) => id === proofId) ?? null);
    setHistory([]);
    setPublications([]);
    setPublicationOutbox([]);
    setExecution(null);
    setProofActionError(null);
  }

  async function inspectProof(proofId: string): Promise<void> {
    const request = ++inspectionRequest;
    setInspecting(true);
    try {
      const result = await server.runAction("proof.inspect", { proofId, includeHistory: true });
      if (selectedId() !== proofId || request !== inspectionRequest) return;
      adoptProof(result.proof);
      setHistory(result.history ?? []);
      setPublications(result.publications);
      setPublicationOutbox(result.publicationOutbox);
      setExecution(result.execution ?? null);
      setProofActionError(null);
    } catch (cause) {
      if (selectedId() === proofId && request === inspectionRequest) {
        setError(humanError(cause, "Could not inspect this Proof"));
      }
    } finally {
      if (request === inspectionRequest) setInspecting(false);
    }
  }

  async function runProof(proof: ChangeVerification): Promise<void> {
    let reviewed = proof;
    let preview: ChangeProofExecutionPreview | undefined;
    try {
      const inspected = await server.runAction("proof.inspect", {
        proofId: proof.id,
        includeHistory: false,
      });
      reviewed = inspected.proof;
      preview = inspected.executionPreview;
      adoptProof(reviewed);
      setExecution(inspected.execution ?? null);
    } catch (cause) {
      setProofActionError(humanError(cause, "Could not load the exact Proof preview"));
      return;
    }
    const gated = preview?.cells.filter(
      ({ executionRisk }) =>
        executionRisk.level !== "safe" && executionRisk.confirmation !== "human-only",
    );
    if (gated?.length) {
      confirmAction({
        title: "Confirm guarded Proof cells?",
        body: gated
          .map(
            ({ cellId, executionRisk }) =>
              `${cellId}: ${executionRisk.level} (${executionRisk.externalEffects.join(", ") || "reviewed effect"})`,
          )
          .join("; "),
        confirmLabel: "Issue receipts and run",
        tone: "default",
        onConfirm: () => void runReviewedProof(reviewed, preview!),
      });
      return;
    }
    await runReviewedProof(reviewed, preview);
  }

  async function runReviewedProof(
    proof: ChangeVerification,
    preview: ChangeProofExecutionPreview | undefined,
  ): Promise<void> {
    setProofActionBusy("run");
    setProofActionError(null);
    try {
      const gated =
        preview?.cells.filter(
          ({ executionRisk }) =>
            executionRisk.level !== "safe" && executionRisk.confirmation !== "human-only",
        ) ?? [];
      const confirmationReceipts = [];
      for (const cell of gated) {
        const targetCase = proof.selection.targetCases.find(
          (candidate) => candidate.id === cell.targetCaseId,
        );
        const fixtureScope =
          cell.executionRisk.level === "destructive"
            ? {
                targetCaseId: cell.targetCaseId,
                targetProfileId: targetCase?.targetProfile.id ?? cell.targetCaseId,
                cleanupCheckIds: cell.executionRisk.reasons.length
                  ? cell.executionRisk.reasons.map(({ code }) => code)
                  : [cell.cellId],
              }
            : undefined;
        const confirmation = await server.runAction("proof.run.confirm", {
          proofId: proof.id,
          expectedVersion: proof.version,
          cellId: cell.cellId,
          previewDigest: preview!.previewDigest,
          ...(fixtureScope ? { fixtureScope } : {}),
          confirm: true,
        });
        confirmationReceipts.push(confirmation.receipt);
      }
      const result = await server.runAction("proof.run", {
        proofId: proof.id,
        expectedVersion: proof.version,
        wait: false,
        ...(confirmationReceipts.length ? { confirmationReceipts } : {}),
      });
      adoptProof(result.proof);
      setExecution(result.execution);
    } catch (cause) {
      setProofActionError(humanError(cause, "Could not run this Proof"));
    } finally {
      setProofActionBusy(null);
    }
  }

  async function resumeHumanEvidence(
    proof: ChangeVerification,
    paused: ChangeProofExecutionSummary,
    evidenceDigest: string,
  ): Promise<void> {
    if (!paused.humanIntervention || !evidenceDigest.trim()) return;
    setProofActionBusy("human-evidence");
    setProofActionError(null);
    try {
      const result = await server.runAction("proof.run.human-evidence", {
        proofId: proof.id,
        executionId: paused.id,
        cellId: paused.humanIntervention.cellId,
        stepId: paused.humanIntervention.stepId,
        evidenceDigest: evidenceDigest.trim() as `sha256:${string}`,
        wait: false,
        confirm: true,
      });
      adoptProof(result.proof);
      setExecution(result.execution);
    } catch (cause) {
      setProofActionError(humanError(cause, "Could not record human-step evidence"));
    } finally {
      setProofActionBusy(null);
    }
  }

  function approvePlan(proof: ChangeVerification): void {
    const plan = proofPlanSummary(proof);
    confirmAction({
      title: "Approve this Verification Plan?",
      body: `Relay will freeze ${plan.total} verification ${plan.total === 1 ? "cell" : "cells"} (${plan.required} required, ${plan.advisory} advisory), including the explicit pilot, before any target is controlled.`,
      confirmLabel: "Approve plan",
      tone: "default",
      onConfirm: async () => {
        setProofActionBusy("approve-plan");
        setProofActionError(null);
        try {
          const result = await server.runAction("proof.plan.approve", {
            proofId: proof.id,
            expectedVersion: proof.version,
            decisionId: `ui-${proof.id}-${proof.planDigest ?? proof.version}`.slice(0, 256),
            reason: "Reviewed and approved in the Relay Proof workspace.",
            confirm: true,
          });
          adoptProof(result.proof);
        } catch (cause) {
          setProofActionError(humanError(cause, "Could not approve this Verification Plan"));
        } finally {
          setProofActionBusy(null);
        }
      },
    });
  }

  async function rerunAffected(proof: ChangeVerification): Promise<void> {
    setProofActionBusy("rerun-affected");
    setProofActionError(null);
    try {
      const { change } = await server.runAction("workspace.change.inspect", {});
      if (!change.readyForProof || !change.repository || !change.base || !change.head) {
        throw new Error(
          change.blockers[0] ?? "The active workspace is not ready for an exact replacement Proof.",
        );
      }
      if (
        change.repository !== proof.change.repository ||
        change.head.sha === changeTestedSha(proof.change) ||
        !change.changeRef
      ) {
        throw new Error(
          "The active workspace must continue this project from the exact revision this Proof tested.",
        );
      }
      const result = await server.runAction("proof.rerun-affected", {
        proofId: proof.id,
        expectedVersion: proof.version,
        change: {
          repository: change.repository,
          baseSha: change.base.sha,
          headSha: change.head.sha,
          ...change.changeRef,
          previousHeadSha: changeTestedSha(proof.change),
          ...(proof.change.pullRequest ? { pullRequest: proof.change.pullRequest } : {}),
          ...(proof.change.agentClaim ? { agentClaim: proof.change.agentClaim } : {}),
        },
        policy: proof.policy,
        coverageGaps: ["Exact replacement builds and affected journeys must be frozen."],
        residualRisk: proof.residualRisk,
        smallestNextVerification: {
          kind: "provide-build",
          reason: "Bind exact replacement builds before rerunning affected cases.",
        },
      });
      adoptProof(result.replacement);
      primeSelectedProof(result.replacement.id);
      void inspectProof(result.replacement.id);
      setMobileDetailOpen(true);
      resetMobileScroll();
    } catch (cause) {
      setProofActionError(humanError(cause, "Could not prepare the affected rerun"));
    } finally {
      setProofActionBusy(null);
    }
  }

  function cancelProof(proof: ChangeVerification): void {
    confirmAction({
      title: "Cancel this Proof?",
      body: "Relay will stop unfinished verification work. Existing Runs and evidence remain available for audit.",
      confirmLabel: "Cancel Proof",
      tone: "destructive",
      onConfirm: async () => {
        setProofActionBusy("cancel");
        setProofActionError(null);
        try {
          const result = await server.runAction("proof.cancel", {
            proofId: proof.id,
            expectedVersion: proof.version,
            reason: "Cancelled by the operator from the Relay Proof workspace.",
            confirm: true,
          });
          adoptProof(result.proof);
        } catch (cause) {
          setProofActionError(humanError(cause, "Could not cancel this Proof"));
        } finally {
          setProofActionBusy(null);
        }
      },
    });
  }

  function retryPublication(
    proof: ChangeVerification,
    publication: ChangeProofPublicationOutboxRecord,
  ): void {
    confirmAction({
      title: "Retry this merge check?",
      body: "Relay will preserve the exact commit, Proof revision, and GitHub check identity, then reconcile an existing receipt or grant one additional delivery attempt.",
      confirmLabel: "Retry merge check",
      tone: "default",
      onConfirm: async () => {
        setProofActionBusy("retry-publication");
        setProofActionError(null);
        try {
          await server.runAction("proof.publication.retry", {
            proofId: proof.id,
            publicationId: publication.id,
            expectedProofVersion: publication.proofVersion,
            reason: "The operator explicitly retried the exhausted merge check from Relay.",
            confirm: true,
          });
          await inspectProof(proof.id);
        } catch (cause) {
          setProofActionError(humanError(cause, "Could not retry this merge check"));
        } finally {
          setProofActionBusy(null);
        }
      },
    });
  }

  function invokePrimaryProofAction(proof: ChangeVerification): void {
    const action = proofPrimaryAction(proof, execution());
    if (!action || proofActionBusy()) return;
    if (action.kind === "approve-plan") approvePlan(proof);
    else if (action.kind === "run") void runProof(proof);
    else void rerunAffected(proof);
  }

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
      const selectedBaseRef = baseRef ?? proofBaseRef();
      const result = await server.runAction(
        "workspace.change.inspect",
        selectedBaseRef ? { baseRef: selectedBaseRef } : {},
      );
      if (baseRef) setProofBaseRef(baseRef);
      setWorkspaceChange(result.change);
    } catch (cause) {
      setWorkspaceChange(null);
      setCreateError(humanError(cause, "Could not inspect the active workspace"));
    } finally {
      setResolvingWorkspace(false);
    }
  }

  function openCreation(): void {
    setSettingUp(false);
    setCreating(true);
    setCreateError(null);
    setProofBaseRef(null);
    void resolveWorkspaceChange();
  }

  function openSetup(): void {
    setCreating(false);
    setSettingUp(true);
    setCreateError(null);
  }

  async function submitProof(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting()) return;
    const normalized = normalizedProofDraft(draft());
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
      const result = await server.runAction("proof.prepare", {
        ...(proofBaseRef() ? { baseRef: proofBaseRef()! } : {}),
        ...(normalized.pullRequest ? { pullRequest: Number(normalized.pullRequest) } : {}),
        ...(normalized.summary
          ? {
              agentClaim: {
                summary: normalized.summary,
                acceptanceCriteria: criteria,
              },
            }
          : {}),
        policy: VERIFY_CHANGE_POLICY,
      });
      setDraft({ ...emptyProofDraft });
      setCreating(false);
      await refresh(result.proof.id);
      setMobileDetailOpen(true);
      resetMobileScroll();
    } catch (cause) {
      setCreateError(humanError(cause, "Could not prepare this Proof"));
    } finally {
      setSubmitting(false);
    }
  }

  async function refresh(preferredProofId?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await server.runAction("proof.list", { limit: 100 });
      setProofs(result.proofs);
      const requestedId = preferredProofId ?? selectedId();
      const nextId =
        requestedId && result.proofs.some(({ id }) => id === requestedId)
          ? requestedId
          : (result.proofs[0]?.id ?? null);
      if (!nextId) clearSelectedProof();
      else {
        primeSelectedProof(nextId);
        await inspectProof(nextId);
      }
    } catch (cause) {
      setError(humanError(cause, "Could not load Proofs"));
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    const health = server.health();
    if (health === "online" && previousHealth !== "online") void refresh();
    previousHealth = health;
  });

  createEffect(() => {
    const proofId = selectedId();
    const executionStatus = execution()?.status;
    if (!proofId || (executionStatus !== "queued" && executionStatus !== "running")) return;
    const dispose = watchActiveProofExecution({
      proofId,
      sseConnected: server.sseConnected,
      subscribe: server.watchProofExecution,
      refresh: () => {
        if (!inspecting()) void inspectProof(proofId);
      },
      fallbackMs: props.liveRefreshMs ?? 15_000,
    });
    onCleanup(dispose);
  });

  onMount(() => void refresh());

  const selectedStatus = createMemo(() => {
    const proof = selected();
    return proof ? proofStatePresentation[proof.state] : proofStatePresentation.planning;
  });
  return (
    <section
      ref={(element) => (page = element)}
      class={cn(productPage, "flex flex-col gap-6")}
      aria-label="Changes and Proofs"
    >
      <ChangesWorkspaceHeader
        mobileDetailOpen={mobileDetailOpen}
        canCreate={() => !creating() && !settingUp() && proofs().length > 0}
        loading={loading}
        inspecting={inspecting}
        onCreate={openCreation}
        onRefresh={() => void refresh()}
      />

      <Show when={creating()}>
        <ChangesProofCreateForm
          workspaceChange={workspaceChange()}
          resolvingWorkspace={resolvingWorkspace()}
          submitting={submitting()}
          draft={draft()}
          draftErrors={draftErrors()}
          createError={createError()}
          onResolveWorkspace={(baseRef) => void resolveWorkspaceChange(baseRef)}
          onDraftInput={setDraftField}
          onDraftBlur={validateDraftField}
          onClose={closeCreation}
          onSetup={openSetup}
          onSubmit={(event) => void submitProof(event)}
        />
      </Show>

      <Show when={settingUp()}>
        <ChangesProofSetup
          baseRef={proofBaseRef() ?? undefined}
          onCancel={() => {
            setSettingUp(false);
            setCreating(true);
          }}
          onPrepared={(proof) => {
            setSettingUp(false);
            void refresh(proof.id).then(() => {
              setMobileDetailOpen(true);
              resetMobileScroll();
            });
          }}
        />
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
          <ChangesWorkspaceListFallback
            loading={loading}
            creating={creating}
            settingUp={settingUp}
            onCreate={openCreation}
          />
        }
      >
        <div class="mx-auto grid min-h-[520px] w-full max-w-[1180px] grid-cols-[minmax(240px,320px)_minmax(0,1fr)] overflow-hidden rounded-2xl bg-surface-raised-stronger-non-alpha ring-1 ring-inset ring-border-weak-base max-[820px]:grid-cols-1">
          <ChangesWorkspaceProofList
            proofs={proofs}
            selectedId={selectedId}
            mobileDetailOpen={mobileDetailOpen}
            onSelect={(proofId) => {
              primeSelectedProof(proofId);
              void inspectProof(proofId);
              setMobileDetailOpen(true);
              resetMobileScroll();
            }}
          />

          <Show
            when={selected()}
            fallback={
              <div class="grid place-items-center p-8 text-body text-text-weak">
                Select a Proof.
              </div>
            }
          >
            {(proof) => (
              <div
                class={cn(
                  "min-h-0 min-w-0 overflow-hidden max-[820px]:flex max-[820px]:flex-col",
                  !mobileDetailOpen() && "max-[820px]:hidden",
                )}
              >
                <button
                  type="button"
                  class="hidden min-h-11 items-center gap-2 border-b border-border-weak-base px-4 text-left text-body font-medium text-text-base max-[820px]:flex"
                  onClick={() => {
                    setMobileDetailOpen(false);
                    resetMobileScroll();
                  }}
                >
                  <Icon name="chevron-left" size={14} /> Back to Proofs
                </button>
                <ProofDetail
                  proof={proof()}
                  status={selectedStatus()}
                  history={history()}
                  publications={publications()}
                  publicationOutbox={publicationOutbox()}
                  execution={execution()}
                  primaryAction={proofPrimaryAction(proof(), execution())}
                  actionBusy={proofActionBusy()}
                  actionError={proofActionError()}
                  canCancel={proofCanCancel(proof())}
                  onPrimaryAction={() => invokePrimaryProofAction(proof())}
                  onCancel={() => cancelProof(proof())}
                  onResumeHumanEvidence={(paused, evidenceDigest) =>
                    void resumeHumanEvidence(proof(), paused, evidenceDigest)
                  }
                  onRetryPublication={(publication) => retryPublication(proof(), publication)}
                  onOpenRun={props.onOpenRun}
                  onOpenMap={props.onOpenMap}
                />
              </div>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
}
