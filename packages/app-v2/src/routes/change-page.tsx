/** @jsxImportSource react */
import type {
  ProductAffectedTest,
  ProductChangeDetails,
  ProductChangeState,
  ProductVerificationItem,
} from "@relay/product/change-journey";
import { Button, Menu } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";
import type { ProductChangeDetail } from "../data/change-product-service";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { changeStatus, changesQueryKey } from "./changes-page";

const routeApi = getRouteApi("/changes/$changeId");
const changeQueryKey = (changeId: string) => ["change", changeId] as const;

type ChangeAction = "approve" | "run" | "cancel" | "rerun";

export function ChangePage() {
  const { changeId } = routeApi.useParams();
  const { changeService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate({ from: "/changes/$changeId" });
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
  const status = current ? changeStatus(current) : undefined;
  const action = current && details ? primaryAction(detail.state, details) : undefined;

  return (
    <section className="relay-page relay-change-page">
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
            <Link className="relay-inline-link" to="/changes">
              View Changes
            </Link>
          }
        />
      ) : null}

      {current && details && status ? (
        <>
          <header className="relay-change-detail-header">
            <div className="relay-change-title-block">
              <p className="relay-eyebrow">Change verification</p>
              <h1>{current.title}</h1>
              <p className="relay-change-context">
                {current.repository}
                {current.pullRequest ? ` · Pull request #${current.pullRequest}` : ""}
                {current.targetBranch ? ` · ${current.targetBranch}` : ""}
              </p>
            </div>
            <div className="relay-change-actions">
              {action ? (
                <Button
                  variant="primary"
                  onClick={() => mutation.mutate(action.kind)}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending && mutation.variables === action.kind
                    ? action.pendingLabel
                    : action.label}
                </Button>
              ) : null}
              {canCancel(current.status) ? (
                <Menu.Root>
                  <Menu.Trigger
                    className="relay-button relay-button--secondary relay-button--medium"
                    disabled={mutation.isPending}
                  >
                    More
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner className="relay-menu-positioner" sideOffset={6} align="end">
                      <Menu.Popup className="relay-overlay-popup relay-menu-popup">
                        <Menu.Item
                          className="relay-menu-item relay-menu-item--danger"
                          onClick={() => mutation.mutate("cancel")}
                        >
                          Cancel verification
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              ) : null}
            </div>
          </header>

          <RecordingProblem recovery={detail.state.recovery} error={mutation.error} />

          <section
            className={`relay-change-verdict relay-change-verdict--${status.tone}`}
            aria-labelledby="change-verdict-title"
          >
            <div className="relay-change-verdict-main">
              <span className="relay-change-verdict-mark" aria-hidden="true">
                {verdictMark(status.tone)}
              </span>
              <div>
                <p className="relay-section-label">Verdict</p>
                <h2 id="change-verdict-title">{verdictTitle(current.status)}</h2>
                <p>{verdictDetail(detail.state, details)}</p>
              </div>
            </div>
            {details.execution ? <ExecutionProgress details={details} /> : null}
          </section>

          {details.firstFailure ? (
            <section className="relay-change-causal-failure" aria-labelledby="first-failure-title">
              <p className="relay-section-label">First problem</p>
              <h2 id="first-failure-title">Why verification stopped</h2>
              <p>{details.firstFailure.summary}</p>
              <Link to="/runs/$runId" params={{ runId: details.firstFailure.runId }}>
                Open the failing Report <span aria-hidden="true">→</span>
              </Link>
              {details.nextVerification ? (
                <div className="relay-change-repair-guidance">
                  <strong>Recommended repair</strong>
                  <p>{details.nextVerification.reason}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="relay-change-overview-grid">
            <section className="relay-change-section" aria-labelledby="change-summary-title">
              <SectionHeader eyebrow="Claim" title="What changed" id="change-summary-title" />
              {current.agentClaim ? (
                <>
                  <p className="relay-change-claim">{current.agentClaim.summary}</p>
                  {current.agentClaim.acceptanceCriteria.length ? (
                    <ul className="relay-change-criteria">
                      {current.agentClaim.acceptanceCriteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="relay-change-muted">
                  No agent claim was attached. Relay selected coverage from the reviewed repository
                  change.
                </p>
              )}
            </section>

            <PublicationStatus detail={detail} />
          </div>

          <section
            className="relay-change-section relay-change-wide-section"
            aria-labelledby="affected-tests-title"
          >
            <SectionHeader
              eyebrow="Coverage"
              title="Tests selected for coverage"
              id="affected-tests-title"
              aside={`${details.affectedTests.length} selected`}
            />
            {details.affectedTests.length ? (
              <ul className="relay-change-tests">
                {details.affectedTests.map((test) => (
                  <AffectedTest key={`${test.appId}:${test.testId}`} test={test} detail={detail} />
                ))}
              </ul>
            ) : (
              <p className="relay-change-muted">Relay has not selected any affected Tests yet.</p>
            )}
          </section>

          <section
            className="relay-change-section relay-change-wide-section"
            aria-labelledby="verification-plan-title"
          >
            <SectionHeader
              eyebrow="Verification plan"
              title="Exact execution plan"
              id="verification-plan-title"
              aside={planCount(details)}
            />
            {details.verificationPlan.length ? (
              <ol className="relay-verification-plan">
                {details.verificationPlan.map((item) => (
                  <VerificationItem key={item.id} item={item} detail={detail} />
                ))}
              </ol>
            ) : (
              <p className="relay-change-muted">
                {details.nextVerification?.reason ??
                  "The Verification Plan is still being prepared."}
              </p>
            )}
          </section>

          {current.coverageGaps.length || current.residualRisk.length ? (
            <div className="relay-change-overview-grid">
              {current.coverageGaps.length ? (
                <RiskSection title="Coverage gaps" values={current.coverageGaps} empty="" />
              ) : null}
              {current.residualRisk.length ? (
                <RiskSection title="Remaining risk" values={current.residualRisk} empty="" />
              ) : null}
            </div>
          ) : (
            <p className="relay-change-clear-state">No known coverage gaps or remaining risk.</p>
          )}

          {details.execution?.attention ? (
            <section className="relay-change-attention" aria-labelledby="verification-paused-title">
              <p className="relay-section-label">Verification paused safely</p>
              <h2 id="verification-paused-title">
                {details.execution.attention.kind === "human-evidence"
                  ? "Human evidence is required"
                  : "Relay needs reconciliation"}
              </h2>
              <p>{details.execution.attention.reason}</p>
              <p className="relay-change-muted">
                Relay will not make a merge decision until this step is resolved.
              </p>
            </section>
          ) : null}

          <AuditDetails detail={detail} />
        </>
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
  return (
    <div className="relay-change-progress" role="status" aria-live="polite">
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

function AffectedTest({
  test,
  detail,
}: {
  test: ProductAffectedTest;
  detail: ProductChangeDetail;
}) {
  const name = detail.names.tests[`${test.appId}:${test.testId}`] ?? humanize(test.testId);
  const app = detail.names.apps[test.appId] ?? humanize(test.appId);
  return (
    <li>
      <div>
        <Link to="/tests/$testId" params={{ testId: test.testId }}>
          {name}
        </Link>
        <span>{app}</span>
      </div>
      <p>{test.reason}</p>
      <span className={`relay-change-confidence relay-change-confidence--${test.confidence}`}>
        {confidenceLabel(test.confidence)}
      </span>
    </li>
  );
}

function VerificationItem({
  item,
  detail,
}: {
  item: ProductVerificationItem;
  detail: ProductChangeDetail;
}) {
  const test = detail.names.tests[`${item.appId}:${item.testId}`] ?? humanize(item.testId);
  return (
    <li className="relay-verification-item">
      <div className="relay-verification-item-head">
        <div>
          <strong>{test}</strong>
          <span>
            {item.targetName} · {platformLabel(item.platform)}
          </span>
        </div>
        <div className="relay-verification-tags">
          {item.pilot ? <span>Pilot</span> : null}
          <span>{item.requirement === "required" ? "Required" : "Advisory"}</span>
        </div>
      </div>
      <p>{item.reason}</p>
      <dl>
        <div>
          <dt>Build</dt>
          <dd>{humanize(item.buildName)}</dd>
        </div>
        {item.estimatedDurationMs ? (
          <div>
            <dt>Expected time</dt>
            <dd>{formatDuration(item.estimatedDurationMs)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Cleanup</dt>
          <dd>{item.cleanupRequired ? "Verified after the Test" : "Not required"}</dd>
        </div>
      </dl>
    </li>
  );
}

function RiskSection({
  title,
  values,
  empty,
}: {
  title: string;
  values: readonly string[];
  empty: string;
}) {
  const id = `${title.toLocaleLowerCase().replaceAll(" ", "-")}-title`;
  return (
    <section className="relay-change-section" aria-labelledby={id}>
      <SectionHeader eyebrow="Confidence" title={title} id={id} />
      {values.length ? (
        <ul className="relay-change-risk-list">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="relay-change-clear">
          <span aria-hidden="true">✓</span>
          {empty}
        </p>
      )}
    </section>
  );
}

function PublicationStatus({ detail }: { detail: ProductChangeDetail }) {
  const publication = detail.state.details?.publications[0];
  const { changeService, queryClient } = useRouteContext({ from: "__root__" });
  const retry = useMutation({
    mutationFn: () => {
      const change = detail.state.change!;
      return changeService.retryPublication({
        changeId: change.id,
        publicationId: publication!.id,
        expectedVersion: change.version,
      });
    },
    onSuccess: (next) => {
      if (next.state.change) queryClient.setQueryData(changeQueryKey(next.state.change.id), next);
    },
  });
  if (!publication) {
    return (
      <section className="relay-change-section" aria-labelledby="publication-status-title">
        <SectionHeader
          eyebrow="GitHub delivery"
          title="Not published"
          id="publication-status-title"
        />
        <p className="relay-change-muted">Relay has not sent this verification result to GitHub.</p>
      </section>
    );
  }
  const presentation = publicationPresentation(publication.status);
  return (
    <section className="relay-change-section" aria-labelledby="publication-status-title">
      <SectionHeader
        eyebrow="GitHub delivery"
        title={presentation.title}
        id="publication-status-title"
      />
      <p>{presentation.detail}</p>
      <div className="relay-publication-status">
        {publication.detailsUrl ? (
          <a href={publication.detailsUrl} target="_blank" rel="noreferrer">
            Open GitHub check
          </a>
        ) : null}
        {publication.canRetry ? (
          <Button size="small" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? "Retrying…" : "Retry publication"}
          </Button>
        ) : null}
        {retry.data?.state.recovery ? <p role="alert">{retry.data.state.recovery.detail}</p> : null}
      </div>
    </section>
  );
}

function AuditDetails({ detail }: { detail: ProductChangeDetail }) {
  const details = detail.state.details!;
  const change = details.change;
  return (
    <details className="relay-change-audit">
      <summary>Audit details</summary>
      <p>Exact identities and receipts for operators and agents.</p>
      <dl>
        <div>
          <dt>Proof ID</dt>
          <dd>{change.id}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{details.audit.proofVersion}</dd>
        </div>
        <div>
          <dt>Base revision</dt>
          <dd>{change.baseRevision}</dd>
        </div>
        <div>
          <dt>Tested revision</dt>
          <dd>{change.requestedRevision}</dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>{details.audit.policy}</dd>
        </div>
        <div>
          <dt>Plan digest</dt>
          <dd>{details.audit.planDigest ?? "Not available"}</dd>
        </div>
        <div>
          <dt>Decision digest</dt>
          <dd>{details.audit.decisionDigest ?? "Not available"}</dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{details.audit.requestedBy}</dd>
        </div>
        <div>
          <dt>Builds</dt>
          <dd>{details.audit.buildIds.length ? details.audit.buildIds.join(", ") : "None"}</dd>
        </div>
      </dl>
      {details.publications.length ? (
        <section
          className="relay-change-publication-history"
          aria-labelledby="publication-history-title"
        >
          <h3 id="publication-history-title">Publication history</h3>
          <ul>
            {details.publications.map((publication) => (
              <li key={publication.id}>
                <span>{publicationLabel(publication.status)}</span>
                <code>{publication.id}</code>
                <span>
                  {publication.attempts === undefined
                    ? "Historical receipt"
                    : `${publication.attempts} attempt${publication.attempts === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </details>
  );
}

function SectionHeader({
  eyebrow,
  title,
  id,
  aside,
}: {
  eyebrow: string;
  title: string;
  id: string;
  aside?: string;
}) {
  return (
    <header className="relay-change-section-header">
      <div>
        <p className="relay-section-label">{eyebrow}</p>
        <h2 id={id}>{title}</h2>
      </div>
      {aside ? <span>{aside}</span> : null}
    </header>
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

function verdictMark(tone: ReturnType<typeof changeStatus>["tone"]): string {
  if (tone === "success") return "✓";
  if (tone === "danger" || tone === "notice") return "!";
  if (tone === "active") return "•";
  return "·";
}

function verdictDetail(state: ProductChangeState, details: ProductChangeDetails): string {
  if (state.status === "running" && details.execution)
    return `${details.execution.completed} of ${details.execution.total} planned checks are complete.`;
  if (details.firstFailure) return details.firstFailure.summary;
  if (details.nextVerification?.reason) return details.nextVerification.reason;
  if (details.change.decision === "proved")
    return `${details.change.evidenceCount} evidence ${details.change.evidenceCount === 1 ? "item supports" : "items support"} this decision.`;
  return (
    state.report?.summary ??
    "Relay is preserving the exact plan, execution, and evidence for this Change."
  );
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

function planCount(details: ProductChangeDetails): string {
  const required = details.change.requiredVerificationCount;
  const advisory = details.change.advisoryVerificationCount;
  return `${required} required${advisory ? ` · ${advisory} advisory` : ""}`;
}

function humanize(value: string): string {
  const spaced = value
    .replaceAll(/[-_.]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : "Unnamed";
}

function confidenceLabel(value: ProductAffectedTest["confidence"]): string {
  if (value === "definite") return "Directly affected";
  if (value === "probable") return "Likely affected";
  return "Coverage gap";
}

function platformLabel(platform: ProductVerificationItem["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Browser";
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 100) / 10} s`;
  return `${Math.round(durationMs / 60_000)} min`;
}

function publicationLabel(status: string): string {
  if (status === "published" || status === "completed") return "Published to GitHub";
  if (status === "claimed" || status === "in_progress") return "Publishing to GitHub";
  if (status === "retry") return "GitHub publication needs attention";
  return "Queued for GitHub";
}

function publicationPresentation(status: string): { title: string; detail: string } {
  if (status === "published" || status === "completed") {
    return {
      title: "Published",
      detail: "GitHub received this verification result.",
    };
  }
  if (status === "claimed" || status === "in_progress") {
    return {
      title: "Publishing",
      detail: "Relay is delivering this verification result to GitHub.",
    };
  }
  if (status === "retry") {
    return {
      title: "Needs attention",
      detail:
        "The verdict is safely stored in Relay, but GitHub has not received the latest result.",
    };
  }
  return {
    title: "Waiting to publish",
    detail: "This verification result is queued for delivery to GitHub.",
  };
}
