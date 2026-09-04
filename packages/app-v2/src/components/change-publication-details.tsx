/** @jsxImportSource react */
import { Button, Disclosure } from "@relay/ui-react";
import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
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
  if (!publication) {
    return (
      <section className="relay-change-section" aria-labelledby="publication-status-title">
        <ChangeSectionHeader
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
      <ChangeSectionHeader
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

export function ChangeAuditDetails({ detail }: { detail: ProductChangeDetail }) {
  const details = detail.state.details!;
  const change = details.change;
  return (
    <Disclosure.Root className="relay-change-audit">
      <Disclosure.Trigger>Audit details</Disclosure.Trigger>
      <Disclosure.Panel>
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
      </Disclosure.Panel>
    </Disclosure.Root>
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
    <header className="relay-change-section-header">
      <div>
        <p className="relay-section-label">{eyebrow}</p>
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
