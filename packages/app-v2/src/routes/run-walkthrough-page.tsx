/** Walk through — the thin captured-app player on recorded evidence
 * (delivery plan §6.6). Read-only navigation over the run's player
 * manifest: states from the identity chain, exact per-configuration
 * captures, recorded and authored links, findings on exact captures.
 *
 * The player never dispatches app input and never needs report data —
 * reports may add review controls to this surface later, but the
 * navigation works with reports removed (plan §6.1). */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getRouteApi, useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { PageHeader, WorkbenchPage } from "../components/page-layout";
import { EmptyState } from "../components/product-patterns";
import type { PlayerManifestProjection, RunProductService } from "../data/run-product-service";

/** Newest exact capture for (state, variant). Substitution is structurally
 * impossible: a miss returns undefined and renders an explicit missing state. */
function resolveCapture(manifest: PlayerManifestProjection, stateId: string, variantId: string) {
  let newest: PlayerManifestProjection["captures"][number] | undefined;
  for (const capture of manifest.captures) {
    if (capture.stateId !== stateId || capture.variantId !== variantId) continue;
    if (!newest || capture.capturedAt > newest.capturedAt) newest = capture;
  }
  return newest;
}

const routeApi = getRouteApi("/runs/$runId/walkthrough");

type WalkthroughSearch = { state?: string; variant?: string; capture?: string };

function useFrameUrl(
  runService: RunProductService,
  runId: string,
  framePath: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let revoke: string | undefined;
    let active = true;
    if (!framePath || !runService.loadFrame) {
      setUrl(undefined);
      return;
    }
    runService
      .loadFrame(runId, framePath)
      .then((blob) => {
        if (!active) return;
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => setUrl(undefined));
    return () => {
      active = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [runService, runId, framePath]);
  return url;
}

export function RunWalkthroughPage() {
  const { runId } = routeApi.useParams();
  const navigate = useNavigate({ from: "/runs/$runId/walkthrough" });
  const search = useSearch({ from: "/runs/$runId/walkthrough" }) as WalkthroughSearch;
  const { runService } = useRouteContext({ from: "__root__" }) as {
    runService: RunProductService;
  };
  const queryClient = useQueryClient();
  const manifestQuery = useQuery({
    queryKey: ["run", "player-manifest", runId],
    queryFn: () => runService.getPlayerManifest!(runId),
    enabled: typeof runService.getPlayerManifest === "function",
    staleTime: Infinity,
    retry: false,
  });
  const manifest = manifestQuery.data;
  const reviewMutation = useMutation({
    mutationFn: async (input: {
      capture: { runId: string; framePath: string; imageSha256: string };
      action: string;
      note?: string;
    }) => {
      if (!runService.reviewCapture) throw new Error("Review is not available on this surface.");
      return runService.reviewCapture({
        runId: input.capture.runId,
        captureId: `${input.capture.framePath}::${input.capture.imageSha256}`,
        action: input.action,
        ...(input.note !== undefined ? { note: input.note } : {}),
      } as Parameters<NonNullable<RunProductService["reviewCapture"]>>[0]);
    },
    onSuccess: async () => {
      // Refresh the pinned manifest so the decision appears on the exact
      // capture without leaving the player.
      await queryClient.invalidateQueries({ queryKey: ["run", "player-manifest", runId] });
    },
  });

  const historyRef = useRef<string[]>([]);
  const [focusedHotspot, setFocusedHotspot] = useState(0);

  const variantId = search.variant ?? manifest?.variants[0]?.id;
  const stateId = search.state ?? manifest?.entryStateId;

  const capture = useMemo(() => {
    if (!manifest || !stateId || !variantId) return undefined;
    if (search.capture) {
      return manifest.captures.find((candidate) => candidate.id === search.capture);
    }
    return resolveCapture(manifest, stateId, variantId);
  }, [manifest, stateId, variantId, search.capture]);

  const frameUrl = useFrameUrl(runService, capture?.runId ?? runId, capture?.framePath);

  const outgoing = useMemo(() => {
    if (!manifest || !stateId) return [];
    return manifest.connections.filter((connection) => connection.fromStateId === stateId);
  }, [manifest, stateId]);

  const missing = useMemo(() => {
    if (!manifest || !stateId || !variantId) return undefined;
    return manifest.missing.find(
      (entry) => entry.stateId === stateId && entry.variantId === variantId,
    );
  }, [manifest, stateId, variantId]);

  const finding = useMemo(() => {
    if (!manifest || !capture) return undefined;
    return manifest.findings.find((candidate) =>
      capture.id.endsWith(`:${candidate.captureId.split("::")[1] ?? ""}`),
    );
  }, [manifest, capture]);

  function goTo(nextStateId: string) {
    if (stateId) historyRef.current = [...historyRef.current, stateId];
    setFocusedHotspot(0);
    void navigate({
      search: (previous) => ({ ...previous, state: nextStateId, capture: undefined }),
    });
  }

  function goBack() {
    const previous = historyRef.current.pop();
    if (previous !== undefined) {
      void navigate({
        search: (current) => ({ ...current, state: previous, capture: undefined }),
      });
    }
  }

  function switchVariant(nextVariantId: string) {
    void navigate({
      search: (previous) => ({ ...previous, variant: nextVariantId, capture: undefined }),
    });
  }

  // Keyboard: Escape backs one internal step; ArrowDown/Up move focus
  // across the state's hotspots; Enter follows the focused link.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        goBack();
        return;
      }
      if (outgoing.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedHotspot((index) =>
          event.key === "ArrowDown"
            ? (index + 1) % outgoing.length
            : (index - 1 + outgoing.length) % outgoing.length,
        );
        const button = document.querySelector<HTMLButtonElement>(
          `[data-hotspot-index="${event.key === "ArrowDown" ? (focusedHotspot + 1) % outgoing.length : (focusedHotspot - 1 + outgoing.length) % outgoing.length}"]`,
        );
        button?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (manifestQuery.isError) {
    return (
      <WorkbenchPage>
        <PageHeader
          title="Walk through"
          context="Run"
          description={String((manifestQuery.error as Error).message)}
        />
        <EmptyState
          title="No player manifest"
          detail="This run has no player manifest. The run needs an App Map plan identity and capture evidence."
          action={
            <Link to="/runs/$runId" params={{ runId }}>
              Open the run result
            </Link>
          }
        />
      </WorkbenchPage>
    );
  }

  if (!manifest) {
    return (
      <WorkbenchPage>
        <PageHeader title="Walk through" context="Run" description="Loading recorded evidence…" />
      </WorkbenchPage>
    );
  }

  const stateTitle =
    manifest.states.find((state) => state.id === stateId)?.title ?? "Unknown state";

  return (
    <WorkbenchPage>
      <PageHeader
        title={stateTitle}
        context="Walk through"
        description={`Recorded evidence · App Map ${manifest.pinned.appMapId} r${manifest.pinned.appMapRevision} · ${manifest.pinned.runIds.length} run${manifest.pinned.runIds.length === 1 ? "" : "s"} · read-only`}
      />
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {manifest.variants.map((variant) => (
          <Button
            key={variant.id}
            variant={variant.id === variantId ? "default" : "outline"}
            size="sm"
            onClick={() => switchVariant(variant.id)}
            aria-pressed={variant.id === variantId}
          >
            {variant.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goBack}
            disabled={historyRef.current.length === 0}
          >
            Back
          </Button>
          <Link
            to="/runs/$runId"
            params={{ runId }}
            className="text-sm underline underline-offset-4"
          >
            Result
          </Link>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr_240px]">
        <nav aria-label="Recorded states" className="flex flex-col gap-1">
          {manifest.states.map((state) => {
            const hasCapture = manifest.captures.some(
              (candidate) => candidate.stateId === state.id && candidate.variantId === variantId,
            );
            const stateMissing = manifest.missing.some(
              (entry) => entry.stateId === state.id && entry.variantId === variantId,
            );
            return (
              <button
                key={state.id}
                type="button"
                onClick={() => goTo(state.id)}
                aria-current={state.id === stateId}
                className={`rounded px-2 py-1.5 text-left text-sm ${state.id === stateId ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
              >
                {state.title}
                {stateMissing ? (
                  <span className="block text-xs opacity-70">missing in this configuration</span>
                ) : hasCapture ? (
                  <span className="block text-xs opacity-70">captured</span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="relative">
          {capture && frameUrl ? (
            <figure className="relative m-0">
              <img
                src={frameUrl}
                alt={`${stateTitle} — captured ${new Date(capture.capturedAt).toLocaleString()}`}
                className="max-h-[70vh] w-auto rounded border"
              />
              {outgoing
                .filter((connection) => connection.hotspot?.point || connection.hotspot?.rect)
                .map((connection, index) => {
                  const point = connection.hotspot?.point;
                  const rect = connection.hotspot?.rect;
                  const left = point ? point.x : rect ? rect.x : 0;
                  const top = point ? point.y : rect ? rect.y : 0;
                  return (
                    <button
                      key={connection.id}
                      type="button"
                      data-hotspot-index={index}
                      data-recorded={connection.kind === "recorded"}
                      title={`${connection.label} (${connection.kind})`}
                      aria-label={`${connection.label} — ${connection.kind} link to ${manifest.states.find((state) => state.id === connection.toStateId)?.title ?? "next state"}`}
                      onClick={() => goTo(connection.toStateId)}
                      className={
                        rect
                          ? "absolute rounded-sm border-2 border-primary bg-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring left-(--hotspot-left) top-(--hotspot-top) w-(--hotspot-width) h-(--hotspot-height)"
                          : "absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring left-(--hotspot-left) top-(--hotspot-top)"
                      }
                      style={
                        {
                          "--hotspot-left": `${left * 100}%`,
                          "--hotspot-top": `${top * 100}%`,
                          "--hotspot-width": `${rect ? rect.width * 100 : 0}%`,
                          "--hotspot-height": `${rect ? rect.height * 100 : 0}%`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
            </figure>
          ) : missing ? (
            <EmptyState title="No capture for this configuration" detail={missing.reason} />
          ) : (
            <EmptyState
              title="No capture selected"
              detail="Choose a state, or capture this state in a run first."
            />
          )}
        </div>
        <aside className="flex flex-col gap-3 text-sm" aria-label="Connections and findings">
          <section>
            <h3 className="mb-1 font-medium">Links from this state</h3>
            {outgoing.length === 0 ? (
              <p className="opacity-70">No links recorded or authored from this state.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {outgoing.map((connection, index) => (
                  <li key={connection.id}>
                    <button
                      type="button"
                      data-hotspot-index={index}
                      onClick={() => goTo(connection.toStateId)}
                      className="text-left underline underline-offset-4"
                    >
                      {connection.label}
                      <span className="ml-1 rounded bg-muted px-1 text-xs">{connection.kind}</span>
                      {connection.kind === "authored" ? (
                        <span className="block text-xs opacity-70">
                          authored link — navigation only, not an executed transition
                        </span>
                      ) : (
                        <span className="block text-xs opacity-70">
                          recorded in run {connection.provenance?.runId.slice(0, 8)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {finding ? (
            <section aria-label="Finding on this capture" className="rounded border p-2">
              <h3 className="mb-1 font-medium">Review decision on this capture</h3>
              <p className="m-0">{finding.action}</p>
              {finding.note ? <p className="m-0 opacity-80">{finding.note}</p> : null}
              <p className="m-0 text-xs opacity-70">
                by {finding.decidedBy ?? "unknown"} · {new Date(finding.decidedAt).toLocaleString()}
              </p>
            </section>
          ) : capture && runService.reviewCapture ? (
            <section aria-label="Review this capture" className="rounded border p-2">
              <h3 className="mb-1 font-medium">Review this capture</h3>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate({ capture, action: "accept" })}
                >
                  Looks correct
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reviewMutation.isPending}
                  onClick={() =>
                    reviewMutation.mutate({
                      capture,
                      action: "report-issue",
                      note: "Reported from the walkthrough player",
                    })
                  }
                >
                  Report issue
                </Button>
              </div>
              {reviewMutation.isError ? (
                <p className="m-0 mt-1 text-xs text-destructive">
                  {(reviewMutation.error as Error).message}
                </p>
              ) : null}
              <p className="m-0 mt-1 text-xs opacity-70">
                Decisions bind to this exact capture ({capture.imageSha256.slice(0, 8)}).
              </p>
            </section>
          ) : null}
          {capture ? (
            <p className="m-0 text-xs opacity-70">
              {capture.caption || "captured frame"} · {capture.framePath} ·{" "}
              {capture.imageSha256.slice(0, 8)}
            </p>
          ) : null}
        </aside>
      </div>
    </WorkbenchPage>
  );
}
