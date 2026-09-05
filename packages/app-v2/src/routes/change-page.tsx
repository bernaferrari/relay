/** @jsxImportSource react */
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import type {
  ProductChangeDetails,
  ProductChangeRepairPacket,
  ProductChangeState,
} from "@relay/product/change-journey";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { Textarea } from "@relay/ui-react/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  ChangeAuditDetails,
  ChangePublicationStatus,
} from "../components/change-publication-details";
import { FormPage, PageHeader } from "../components/page-layout";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { IssueDraftButton } from "../components/issue-draft-button";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { VerificationItem } from "./change-plan-items";
import { changesQueryKey } from "./changes-page";

const routeApi = getRouteApi("/changes/$changeId");
const changeQueryKey = (changeId: string) => ["change", changeId] as const;

type ChangeAction = "approve" | "run" | "cancel" | "rerun";

export function ChangePage() {
  const { changeId } = routeApi.useParams();
  const { changeService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate({ from: "/changes/$changeId" });
  const [evidenceObservation, setEvidenceObservation] = useState("");
  const change = useQuery({
    queryKey: changeQueryKey(changeId),
    queryFn: () => changeService.open(changeId),
    staleTime: 2_000,
  });
  const mutation = useMutation({
    mutationFn: async (action: ChangeAction) => {
      const current = change.data?.state.change;
      if (!current) throw new TypeError("This Change is not available.");
      if (action === "approve") return changeService.approve(current.id, current.version);
      if (action === "run") return changeService.run(current.id, current.version);
      if (action === "cancel") return changeService.cancel(current.id, current.version);
      return changeService.rerunAffected(current.id, current.version);
    },
    onSuccess: async (detail) => {
      const nextId = detail.state.change?.id ?? changeId;
      queryClient.setQueryData(changeQueryKey(nextId), detail);
      await queryClient.invalidateQueries({ queryKey: changesQueryKey });
      if (nextId !== changeId) {
        void navigate({ to: "/changes/$changeId", params: { changeId: nextId }, replace: true });
      }
    },
  });
  const humanEvidence = useMutation({
    mutationFn: async () => {
      const attention = change.data?.state.details?.execution?.attention;
      const current = change.data?.state.change;
      if (
        !current ||
        attention?.kind !== "human-evidence" ||
        !attention.executionId ||
        !attention.cellId ||
        !attention.stepId ||
        !evidenceObservation.trim()
      ) {
        throw new TypeError("Add what you verified before continuing.");
      }
      return changeService.resumeHumanEvidence({
        changeId: current.id,
        executionId: attention.executionId,
        cellId: attention.cellId,
        stepId: attention.stepId,
        observation: evidenceObservation.trim(),
      });
    },
    onSuccess: (next) => {
      const nextId = next.state.change?.id ?? changeId;
      queryClient.setQueryData(changeQueryKey(nextId), next);
      if (!next.state.recovery) setEvidenceObservation("");
    },
  });

  useEffect(() => {
    if (change.data?.state.status !== "running") return;
    const controller = new AbortController();
    void changeService.watch({
      signal: controller.signal,
      onState: (detail) => queryClient.setQueryData(changeQueryKey(changeId), detail),
    });
    return () => controller.abort();
  }, [change.data?.state.status, changeId, changeService, queryClient]);

  const detail = change.data;
  const current = detail?.state.change;
  const details = detail?.state.details;
  const action = current && details ? primaryAction(detail.state, details) : undefined;

  return (
    <FormPage>
      <Breadcrumbs
        items={[{ label: "Changes", to: "/changes" }, { label: current?.title ?? "Change" }]}
      />

      {change.isPending ? <PageLoading label="Loading Change verification…" /> : null}
      {change.isError ? (
        <EmptyState
          title="Relay could not load this Change"
          detail="Check the local service, then try again. The saved verification is unchanged."
          tone="notice"
          action={<Button onClick={() => void change.refetch()}>Try again</Button>}
        />
      ) : null}
      {!change.isPending && !change.isError && !current ? (
        <EmptyState
          title="This Change is not available"
          detail="It may have been replaced or removed. Return to Changes to see the current history."
          action={
            <Link
              className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
              to="/changes"
            >
              View Changes
            </Link>
          }
        />
      ) : null}

      {current && details ? (
        <>
          <PageHeader
            title={current.title}
            description={[
              current.repository,
              current.pullRequest ? `PR #${current.pullRequest}` : undefined,
              current.targetBranch,
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <div className="flex flex-none items-center gap-2">
                {details.firstFailure ? (
                  <IssueDraftButton source={{ kind: "change", details }} />
                ) : null}
                {action ? (
                  <Button
                    variant="default"
                    onClick={() => mutation.mutate(action.kind)}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending && mutation.variables === action.kind
                      ? action.pendingLabel
                      : action.label}
                  </Button>
                ) : null}
                {canCancel(current.status) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="ghost" disabled={mutation.isPending}>
                          More
                        </Button>
                      }
                    />

                    <DropdownMenuContent sideOffset={6} align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => mutation.mutate("cancel")}
                      >
                        Cancel verification
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            }
          />

          <RecordingProblem recovery={detail.state.recovery} error={mutation.error} />

          <section
            className="relay-change-verdict max-w-[60ch]"
            aria-labelledby="change-verdict-title"
          >
            <h2 id="change-verdict-title" className="text-[13px] font-medium leading-5">
              {verdictTitle(current.status)}
            </h2>
            {verdictDetail(detail.state, details) ? (
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                {verdictDetail(detail.state, details)}
              </p>
            ) : null}
            {details.execution ? <ExecutionProgress details={details} /> : null}
          </section>

          {details.firstFailure ? (
            <section
              className="relay-change-first-failure mt-5 max-w-[60ch]"
              aria-labelledby="first-failure-title"
            >
              <p className="text-[11px] text-muted-foreground">First problem</p>
              <h2 id="first-failure-title" className="mt-1 text-[15px] font-medium">
                {details.firstFailure.summary}
              </h2>
              <Link
                className="mt-2 inline-flex text-[13px] text-muted-foreground hover:text-foreground"
                to="/runs/$runId"
                params={{ runId: details.firstFailure.runId }}
              >
                Open report
              </Link>
            </section>
          ) : null}

          {details.repairPacket ? <RepairContext packet={details.repairPacket} /> : null}

          {details.execution?.attention ? (
            <section
              className="relay-change-attention mt-5 rounded-lg border border-red-500/40 bg-red-500/5 p-5"
              aria-labelledby="verification-paused-title"
            >
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Verification paused safely
              </p>
              <h2 id="verification-paused-title">
                {details.execution.attention.kind === "human-evidence"
                  ? "Human evidence is required"
                  : "Relay needs reconciliation"}
              </h2>
              <p>{details.execution.attention.reason}</p>
              {details.execution.attention.kind === "human-evidence" ? (
                <form
                  className="relay-human-evidence-form grid gap-3 rounded-lg border border-border bg-card p-4"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    if (!humanEvidence.isPending && evidenceObservation.trim())
                      humanEvidence.mutate();
                  }}
                >
                  <Field>
                    <FieldLabel htmlFor="change-human-observation">What did you verify?</FieldLabel>
                    <Textarea
                      id="change-human-observation"
                      value={evidenceObservation}
                      onChange={(event) => setEvidenceObservation(event.currentTarget.value)}
                      placeholder="Describe the visible result you confirmed"
                      maxLength={8_000}
                      rows={4}
                      disabled={humanEvidence.isPending}
                    />
                    <FieldDescription>
                      Relay saves this observation on the exact paused step, then continues the
                      server-owned verification.
                    </FieldDescription>
                  </Field>
                  <Button
                    type="submit"
                    variant="default"
                    disabled={!evidenceObservation.trim() || humanEvidence.isPending}
                  >
                    {humanEvidence.isPending ? "Saving evidence…" : "Save evidence and continue"}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Relay will not make a merge decision until this step is resolved.
                </p>
              )}
              <RecordingProblem
                recovery={humanEvidence.data?.state.recovery}
                error={humanEvidence.error}
                onRetry={evidenceObservation.trim() ? () => humanEvidence.mutate() : undefined}
                retrying={humanEvidence.isPending}
              />
            </section>
          ) : null}

          {details.verificationPlan.length ? (
            <ol className="relay-verification-plan mt-6 max-w-[60ch] list-none p-0">
              {details.verificationPlan.map((item) => (
                <VerificationItem key={item.id} item={item} detail={detail} />
              ))}
            </ol>
          ) : details.nextVerification?.reason && current.status === "planning" ? null : details
              .nextVerification?.reason ? (
            <p className="mt-6 max-w-[60ch] text-[13px] text-muted-foreground">
              {details.nextVerification.reason}
            </p>
          ) : null}

          <ChangePublicationStatus detail={detail} />

          {current.coverageGaps.length ? (
            <RiskSection title="Coverage gaps" values={current.coverageGaps} empty="" />
          ) : null}
          {current.residualRisk.length ? (
            <RiskSection title="Remaining risk" values={current.residualRisk} empty="" />
          ) : null}

          <ChangeAuditDetails detail={detail} />
        </>
      ) : null}
    </FormPage>
  );
}

function RepairContext({ packet }: { packet: ProductChangeRepairPacket }) {
  return (
    <section
      className="relay-change-repair-context mt-5 grid max-w-[820px] gap-[18px] rounded-xl border border-border bg-card p-5 shadow-sm"
      aria-labelledby="repair-context-title"
    >
      <header>
        <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
          Repair context
        </p>
        <h2 id="repair-context-title">Smallest useful fix</h2>
        <p>{packet.firstCausalFailure}</p>
      </header>
      {packet.expected || packet.observed ? (
        <dl>
          {packet.expected ? (
            <div>
              <dt>Expected</dt>
              <dd>{packet.expected}</dd>
            </div>
          ) : null}
          {packet.observed ? (
            <div>
              <dt>Observed</dt>
              <dd>{packet.observed}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {packet.suggestedScope.length ? (
        <div className="text-sm">
          <strong>Suggested scope</strong>
          <ul>
            {packet.suggestedScope.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {packet.relevantLogs.length ? (
        <Collapsible className="mt-3">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Relevant logs ({packet.relevantLogs.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 border-t pt-3 text-sm">
            <ul>
              {packet.relevantLogs.map((line, index) => (
                <li key={`${index}:${line}`}>
                  <code>{line}</code>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}

function primaryAction(
  state: ProductChangeState,
  details: ProductChangeDetails,
): { kind: ChangeAction; label: string; pendingLabel: string } | undefined {
  const change = details.change;
  if (
    change.status === "planning" &&
    !details.planApproved &&
    details.nextVerification?.kind === "approve-plan"
  ) {
    return { kind: "approve", label: "Approve plan", pendingLabel: "Approving plan…" };
  }
  if (
    ["ready", "running-pilot", "awaiting-expansion", "running"].includes(change.status) &&
    state.status !== "running" &&
    state.status !== "needs-attention" &&
    !details.execution?.attention
  ) {
    return {
      kind: "run",
      label: change.status === "ready" ? "Verify Change" : "Continue verification",
      pendingLabel: "Starting verification…",
    };
  }
  if (["rejected", "needs-review", "insufficient-evidence"].includes(change.status)) {
    return { kind: "rerun", label: "Prepare selective rerun", pendingLabel: "Preparing rerun…" };
  }
  return undefined;
}

function ExecutionProgress({ details }: { details: ProductChangeDetails }) {
  const execution = details.execution!;
  const total = Math.max(execution.total, 1);
  const percent = Math.round((execution.completed / total) * 100);
  const complete = execution.total > 0 && execution.completed >= execution.total;
  if (complete) {
    return (
      <p className="grid gap-2" role="status">
        {execution.completed} of {execution.total} checks complete
      </p>
    );
  }
  return (
    <div className="grid gap-2" role="status" aria-live="polite">
      <div>
        <span>Verification progress</span>
        <strong>
          {execution.completed} of {execution.total}
        </strong>
      </div>
      <progress
        max={total}
        value={Math.min(execution.completed, total)}
        aria-label={`${percent}% complete`}
      />
    </div>
  );
}

function RiskSection({
  title,
  values,
}: {
  title: string;
  values: readonly string[];
  empty: string;
}) {
  return (
    <section className="mt-6 max-w-[60ch]" aria-label={title}>
      <h2 className="text-[15px] font-medium">{title}</h2>
      <ul className="mt-2 list-none space-y-1 p-0 text-[13px] text-muted-foreground">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
  );
}

function verdictTitle(status: string): string {
  if (status === "proved") return "Ready to merge";
  if (status === "rejected") return "This Change should not merge yet";
  if (status === "needs-review") return "A person needs to review the evidence";
  if (status === "insufficient-evidence") return "Relay needs more evidence";
  if (["running", "running-pilot", "awaiting-expansion"].includes(status))
    return "Relay is verifying this Change";
  if (status === "ready") return "The reviewed plan is ready";
  if (status === "planning") return "Review the plan before Relay controls a device or browser";
  if (status === "awaiting-build") return "Exact builds are still being prepared";
  if (status === "cancelled") return "Verification was cancelled";
  return "A newer verification replaced this one";
}

function verdictDetail(state: ProductChangeState, details: ProductChangeDetails): string {
  if (state.status === "running" && details.execution)
    return `${details.execution.completed} of ${details.execution.total} planned checks are complete.`;
  if (details.firstFailure) return "";
  if (details.change.decision === "proved")
    return `${details.change.evidenceCount} evidence ${details.change.evidenceCount === 1 ? "item supports" : "items support"} this decision.`;
  if (details.change.status === "planning" || details.change.status === "ready") return "";
  return state.report?.summary ?? "";
}

function canCancel(status: string): boolean {
  return ![
    "proved",
    "rejected",
    "needs-review",
    "insufficient-evidence",
    "cancelled",
    "superseded",
  ].includes(status);
}
