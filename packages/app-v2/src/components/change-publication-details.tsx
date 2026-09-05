/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import type { ProductChangePublication } from "@relay/product/change-journey";
import type { ProductChangeDetail } from "../data/change-product-service";

const changeQueryKey = (changeId: string) => ["change", changeId] as const;

export function ChangePublicationStatus({ detail }: { detail: ProductChangeDetail }) {
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
  if (!publication) return null;
  const presentation = publicationPresentation(publication.status);
  return (
    <section
      className="relay-change-publication mt-6 max-w-[60ch]"
      aria-labelledby="publication-status-title"
    >
      <h2 id="publication-status-title" className="text-[15px] font-medium">
        {presentation.title}
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{presentation.detail}</p>
      <div className="relay-publication-status mt-2 flex min-h-11 flex-wrap items-center gap-x-3.5 gap-y-2.5">
        {publication.detailsUrl ? (
          <a href={publication.detailsUrl} target="_blank" rel="noreferrer">
            Open GitHub check
          </a>
        ) : null}
        {publication.canRetry ? (
          <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
            {retry.isPending ? "Retrying…" : "Retry publication"}
          </Button>
        ) : null}
        {retry.data?.state.recovery ? <p role="alert">{retry.data.state.recovery.detail}</p> : null}
      </div>
    </section>
  );
}

export function ChangeAuditDetails({ detail }: { detail: ProductChangeDetail }) {
  const details = detail.state.details!;
  const change = details.change;
  return (
    <Collapsible className="mt-3">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Audit details
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t pt-3 text-sm">
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
          <section className="mt-3 space-y-2" aria-labelledby="publication-history-title">
            <h3 id="publication-history-title">Publication history</h3>
            <ul>
              {details.publications.map((publication) => (
                <li key={publication.id}>
                  <dl className="relay-publication-facts grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs sm:grid-cols-3">
                    <div>
                      <dt>Status</dt>
                      <dd>{publicationLabel(publication.status)}</dd>
                    </div>
                    {publication.provider ? (
                      <div>
                        <dt>Provider</dt>
                        <dd>{publication.provider}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Publication ID</dt>
                      <dd>
                        <code>{publication.id}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Attempts</dt>
                      <dd>
                        {publication.attempts === undefined
                          ? "Historical receipt"
                          : `${publication.attempts}${
                              publication.maxAttempts === undefined
                                ? ""
                                : ` of ${publication.maxAttempts}`
                            }`}
                      </dd>
                    </div>
                    {publication.lastFailure ? (
                      <div>
                        <dt>Provider failure</dt>
                        <dd>
                          {publicationFailureLabel(publication.lastFailure.kind)} at{" "}
                          {publicationTime(publication.lastFailure.at)}
                        </dd>
                      </div>
                    ) : null}
                    {publication.nextAttemptAt !== undefined ? (
                      <div>
                        <dt>Next retry</dt>
                        <dd>{publicationTime(publication.nextAttemptAt)}</dd>
                      </div>
                    ) : null}
                    {publication.recovery ? (
                      <>
                        <div>
                          <dt>Recovery request</dt>
                          <dd>
                            <code>{publication.recovery.requestId}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Recovery requested by</dt>
                          <dd>{publication.recovery.requestedBy}</dd>
                        </div>
                        <div>
                          <dt>Recovery requested at</dt>
                          <dd>{publicationTime(publication.recovery.requestedAt)}</dd>
                        </div>
                      </>
                    ) : null}
                    {publication.receipt ? (
                      <>
                        <div>
                          <dt>Check run ID</dt>
                          <dd>
                            <code>{publication.receipt.checkRunId}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Receipt sequence</dt>
                          <dd>{publication.receipt.sequence}</dd>
                        </div>
                        <div>
                          <dt>Receipt status</dt>
                          <dd>{publication.receipt.status ?? "completed"}</dd>
                        </div>
                        {publication.receipt.conclusion ? (
                          <div>
                            <dt>Receipt conclusion</dt>
                            <dd>{publication.receipt.conclusion}</dd>
                          </div>
                        ) : null}
                        {publication.receipt.proofVersion !== undefined ? (
                          <div>
                            <dt>Receipt Proof version</dt>
                            <dd>{publication.receipt.proofVersion}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>Check digest</dt>
                          <dd>
                            <code>{publication.receipt.checkDigest}</code>
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ChangeSectionHeader({
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
    <header className="flex items-start justify-between gap-3">
      <div>
        <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
          {eyebrow}
        </p>
        <h2 id={id}>{title}</h2>
      </div>
      {aside ? <span>{aside}</span> : null}
    </header>
  );
}

function publicationLabel(status: string): string {
  if (status === "published" || status === "completed") return "Published to GitHub";
  if (status === "claimed" || status === "in_progress") return "Publishing to GitHub";
  if (status === "retry") return "GitHub publication needs attention";
  return "Queued for GitHub";
}

function publicationFailureLabel(
  kind: NonNullable<ProductChangePublication["lastFailure"]>["kind"],
): string {
  if (kind === "provider-error") return "Provider rejected delivery";
  if (kind === "reconciliation-error") return "Provider receipt reconciliation failed";
  return "Delivery lease was lost";
}

function publicationTime(value: number): string {
  return new Date(value).toISOString();
}

function publicationPresentation(status: string): { title: string; detail: string } {
  if (status === "published" || status === "completed")
    return { title: "Published", detail: "GitHub received this verification result." };
  if (status === "claimed" || status === "in_progress")
    return {
      title: "Publishing",
      detail: "Relay is delivering this verification result to GitHub.",
    };
  if (status === "retry")
    return {
      title: "Needs attention",
      detail:
        "The verdict is safely stored in Relay, but GitHub has not received the latest result.",
    };
  return {
    title: "Waiting to publish",
    detail: "This verification result is queued for delivery to GitHub.",
  };
}
