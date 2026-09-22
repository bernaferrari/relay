/** Walk through — the thin captured-app player on recorded evidence
 * (delivery plan §6.6). Read-only navigation over the run's player
 * manifest: states from the identity chain, exact per-configuration
 * captures, recorded and authored links, findings on exact captures.
 *
 * The player never dispatches app input and never needs report data —
 * reports may add review controls to this surface later, but the
 * navigation works with reports removed (plan §6.1). */
import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi, useNavigate, useRouteContext, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { WalkthroughView } from "../components/walkthrough-view";
import { useFrameUrl } from "../hooks/use-walkthrough-frame";
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

  const frame = useFrameUrl(runService, capture?.runId ?? runId, capture?.framePath);

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
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [role="combobox"], [role="listbox"], [role="option"], [role="dialog"], [contenteditable="true"]',
        )
      )
        return;
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

  return (
    <WalkthroughView
      manifest={manifest}
      runId={runId}
      stateId={stateId}
      variantId={variantId}
      capture={capture}
      missing={missing}
      outgoing={outgoing}
      findings={finding ? [finding] : []}
      frame={frame}
      canGoBack={historyRef.current.length > 0}
      goBack={goBack}
      goTo={goTo}
      switchVariant={switchVariant}
      reviewActions={
        runService.reviewCapture && capture
          ? {
              pending: reviewMutation.isPending,
              error: reviewMutation.error,
              accept: () => reviewMutation.mutate({ capture, action: "accept" }),
              report: () =>
                reviewMutation.mutate({
                  capture,
                  action: "report-issue",
                  note: "Reported from the walkthrough player",
                }),
            }
          : undefined
      }
    />
  );
}
