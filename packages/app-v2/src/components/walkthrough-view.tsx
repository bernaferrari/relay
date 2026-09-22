import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import type { CaptureReviewAction } from "@relay/protocol";
import { CaptureReviewDecisions } from "./capture-review-decisions";
import { WorkbenchPage } from "./page-layout";
import { SelectField } from "./filter-select";
import { walkthroughConfigurationLabels } from "./walkthrough-configuration-labels";
import { WalkthroughExport } from "./walkthrough-export";
import { WalkthroughPlayback } from "./walkthrough-playback";
import { EmptyState } from "./product-patterns";
import type { PlayerManifestProjection } from "../data/run-product-service";

type Props = {
  manifest: PlayerManifestProjection;
  runId: string;
  stateId?: string;
  variantId?: string;
  capture?: PlayerManifestProjection["captures"][number];
  missing?: PlayerManifestProjection["missing"][number];
  outgoing: PlayerManifestProjection["connections"];
  findings: PlayerManifestProjection["findings"];
  frame: { url?: string; status: string; failed: () => void; retry: () => void };
  canGoBack: boolean;
  canGoForward?: boolean;
  goBack: () => void;
  goForward?: () => void;
  goTo: (id: string, captureId?: string) => void;
  switchVariant: (id: string) => void;
  reviewActions?: {
    pending: boolean;
    error?: Error | null;
    submit: (action: CaptureReviewAction, note?: string) => Promise<void>;
  };
  exportActions?: {
    pending: boolean;
    error?: Error | null;
    run: () => void;
    file?: { href: string; fileName: string };
  };
};

export function WalkthroughView({
  manifest,
  runId,
  stateId,
  variantId,
  capture,
  missing,
  outgoing,
  findings,
  frame,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  goTo,
  switchVariant,
  reviewActions,
  exportActions,
}: Props) {
  const finding = findings[0];
  const stateTitle =
    manifest.states.find((state) => state.id === stateId)?.title ?? "Unknown state";
  const variants = [
    ...manifest.variants,
    ...manifest.missing
      .filter((entry) => !manifest.variants.some((variant) => variant.id === entry.variantId))
      .filter(
        (entry, index, entries) =>
          entries.findIndex((candidate) => candidate.variantId === entry.variantId) === index,
      )
      .map((entry) => ({ id: entry.variantId, label: entry.variantId })),
  ];


  return (
    <WorkbenchPage>
      <header className="flex items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <Link
            to="/runs/$runId"
            params={{ runId }}
            className="mb-3 inline-flex min-h-9 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Result
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Walkthrough</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the screens captured during this run.
          </p>
        </div>
        {exportActions ? <WalkthroughExport {...exportActions} /> : null}
      </header>
      <div className="mb-5 grid min-w-0 gap-3 sm:grid-cols-2">
        <SelectField
          label="Configuration"
          value={variantId ?? ""}
          options={walkthroughConfigurationLabels(variants)}
          onValueChange={switchVariant}
        />
        <SelectField
          label="Screen"
          value={stateId ?? ""}
          options={manifest.states.map((state) => ({
            value: state.id,
            label: `${state.title}${manifest.captures.some((candidate) => candidate.stateId === state.id && candidate.variantId === variantId) ? "" : " · Not captured"}`,
          }))}
          onValueChange={goTo}
        />
      </div>
      {exportActions?.error ? (
        <p className="pb-3 text-sm text-destructive" role="alert">
          {exportActions?.error instanceof Error
            ? exportActions?.error.message
            : "Could not export the walkthrough."}
        </p>
      ) : null}
      <div className="grid min-w-0 gap-5">
        <section
          className="overflow-hidden rounded-xl border border-border/60 bg-muted/20"
          aria-label="Selected screenshot"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-medium">{stateTitle}</h2>
              <p className="text-xs text-muted-foreground">
                {capture ? "Saved screenshot" : "No screenshot"}
              </p>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back"
                onClick={goBack}
                disabled={!canGoBack}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Forward"
                onClick={goForward}
                disabled={!canGoForward}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="relative">
            {capture && frame.url ? (
              <WalkthroughPlayback
              capture={capture}
              src={frame.url}
              title={`${stateTitle} — captured ${new Date(capture.capturedAt).toLocaleString()}`}
              connections={outgoing}
              entryStateId={manifest.entryStateId}
              onNavigate={goTo}
              onError={frame.failed}
            />
            ) : capture ? (
              frame.status === "loading" ? (
                <div
                  role="status"
                  className="flex min-h-64 items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground"
                >
                  Loading screenshot…
                </div>
              ) : (
                <EmptyState
                  title="Screenshot unavailable"
                  detail="This capture was recorded, but its image could not be loaded. Try again to review it."
                  action={
                    <Button variant="outline" onClick={frame.retry}>
                      Try again
                    </Button>
                  }
                />
              )
            ) : missing ? (
              <EmptyState title="No capture for this configuration" detail={missing.reason} />
            ) : (
              <EmptyState
                title="Not captured in this configuration"
                detail={`${stateTitle} has no screenshot for this configuration, and no recorded reason is attached.`}
              />
            )}
          </div>
          {finding ? (
            <section
              aria-label="Finding on this capture"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm"
            >
              <h3 className="mb-1 font-medium">Review decision on this capture</h3>
              {findings.map((item, index) => (
                <p
                  key={`${item.captureId}:${item.decidedAt}:${item.reviewVersion ?? index}`}
                  className="m-0"
                >
                  {index === 0 ? "Current review" : "Earlier review"} · {item.action}
                  {item.note ? ` · ${item.note}` : ""}
                  {item.decidedBy ? ` · ${item.decidedBy}` : ""}
                </p>
              ))}
            </section>
          ) : null}
          {capture && reviewActions ? (
            <section
              aria-label="Review this capture"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm"
            >
              <CaptureReviewDecisions
                key={`${capture.runId}:${capture.imageSha256}`}
                status={finding ? "Decision saved · choose another action to change it" : "Awaiting your decision"}
                busy={reviewActions.pending}
                unavailable={!frame.url}
                onReview={reviewActions.submit}
              />

            </section>
          ) : null}
        </section>
        <aside className="flex flex-col gap-3 text-sm" aria-label="Connections and findings">
          <section>
            <h3 className="mb-2 text-sm font-medium">Connected screens</h3>
            {outgoing.length === 0 ? (
              <p className="opacity-70">No links recorded or authored from this state.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {outgoing.map((connection, index) => (
                  <li key={`${connection.id}:${connection.provenance?.runId ?? connection.kind}`}>
                    <button
                      type="button"
                      data-hotspot-index={index}
                      onClick={() => goTo(connection.toStateId, connection.kind === "recorded" ? connection.provenance?.captureId : undefined)}
                      className="w-full rounded-lg bg-muted/30 px-4 py-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {connection.label}

                      {connection.kind === "authored" ? (
                        <span className="block text-xs opacity-70">
                          Planned connection
                          {manifest.captures.some(
                            (candidate) =>
                              candidate.stateId === connection.toStateId &&
                              candidate.variantId === variantId,
                          )
                            ? ""
                            : " · Screenshot unavailable"}
                        </span>
                      ) : connection.kind === "recorded" ? (
                        <span className="block text-xs opacity-70">
                          Recorded connection
                          {manifest.captures.some(
                            (candidate) =>
                              candidate.stateId === connection.toStateId &&
                              candidate.variantId === variantId,
                          )
                            ? ""
                            : " · Screenshot unavailable"}
                        </span>
                      ) : (
                        <span className="block text-xs opacity-70">Suggested connection</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {capture ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer py-2">Capture details</summary>
              <dl className="grid gap-2 break-all">
                <div><dt>Configuration</dt><dd>{variants.find((variant) => variant.id === variantId)?.label ?? variantId}</dd></div>
                <div>
                  <dt>Run</dt>
                  <dd>{capture.runId}</dd>
                </div>
                <div>
                  <dt>File</dt>
                  <dd>{capture.framePath}</dd>
                </div>
                <div>
                  <dt>Image identity</dt>
                  <dd>{capture.imageSha256}</dd>
                </div>
                <div>
                  <dt>App revision</dt>
                  <dd>
                    {manifest.pinned.appMapId} · {manifest.pinned.appMapRevision}
                  </dd>
                </div>
              </dl>
            </details>
          ) : null}
        </aside>
      </div>
    </WorkbenchPage>
  );
}
