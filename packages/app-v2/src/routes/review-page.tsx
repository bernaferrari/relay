/** @jsxImportSource react */
import { TestWorkspaceHeader, WorkspaceToolbar } from "../components/test-workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@relay/ui-react/components/popover";
import { Check, CircleCheck, Flag, Keyboard, SquareDashed } from "lucide-react";
import type {
  CaptureReviewAction,
  CaptureReviewItem,
  ReviewInboxEntry,
  ReviewInboxResult,
} from "@relay/protocol";
import {
  createReviewProductService,
  reviewQueryKeys,
  type ReviewProductService,
} from "../data/review-product-service";
import { catalogQueryKeys } from "../data/catalog-queries";
import { ReviewCompare, type CompareMode } from "./review-compare";

type Card = { entry: ReviewInboxEntry; item: CaptureReviewItem; key: string };
type Filter = "all" | "changed" | "new";

export function cardsOf(result: ReviewInboxResult | undefined, filter: Filter): Card[] {
  return (result?.entries ?? []).flatMap((entry) =>
    entry.items
      .filter((item) =>
        filter === "all"
          ? true
          : filter === "changed"
            ? item.reference?.state === "changed"
            : item.reference?.state !== "changed",
      )
      .map((item) => ({ entry, item, key: `${entry.runId}::${item.captureId}` })),
  );
}

export function screenshotName(item: CaptureReviewItem): string {
  const caption = item.caption.trim();
  if (caption.startsWith("step:")) return caption.split(":").slice(2).join(":") || "Screenshot";
  if (caption.startsWith("app-map:")) return item.lookFor || "Screenshot";
  return caption || item.lookFor || "Screenshot";
}

function StateBadge({ item }: { item: CaptureReviewItem }) {
  const state = item.reference?.state;
  if (state === "changed") {
    const ratio = item.reference?.sizeChanged
      ? "size"
      : `${Math.max(0.1, (item.reference?.changeRatio ?? 0) * 100).toFixed(1)}%`;
    return (
      <span className="shrink-0 rounded-md bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning-foreground">
        Changed {ratio}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md bg-info/10 px-1.5 py-0.5 text-xs font-medium text-info">
      New
    </span>
  );
}

function timeAgo(value: number): string {
  const minutes = Math.round((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Totals({ result }: { result: ReviewInboxResult }) {
  const totals = result.totals;
  const parts = [
    totals.unchanged ? `${totals.unchanged} matched their reference` : undefined,
    totals.issue ? `${totals.issue} with issues` : undefined,
    totals.missing ? `${totals.missing} not captured` : undefined,
  ].filter(Boolean);
  return parts.length ? (
    <p className="text-sm text-muted-foreground tabular-nums">{parts.join(" · ")}</p>
  ) : null;
}

const SHORTCUTS: readonly [string, string][] = [
  ["A", "Looks correct — becomes the reference"],
  ["R", "Report issue"],
  ["I", "Ignore areas on this screen"],
  ["J / ↓", "Next screenshot"],
  ["K / ↑", "Previous screenshot"],
  ["1 2 3", "Side by side · Highlight · Swipe"],
];

export function ReviewPage() {
  const { platform } = useRouteContext({ from: "__root__" });
  const service = useMemo<ReviewProductService>(
    () => createReviewProductService(platform),
    [platform],
  );
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const search = useLocation().search as { app?: unknown };
  const appMapId = typeof search.app === "string" && search.app ? search.app : undefined;
  const inbox = useQuery({
    queryKey: reviewQueryKeys.inbox(14, appMapId),
    queryFn: () => service.inbox(appMapId ? { appMapId } : {}),
    staleTime: 10_000,
  });
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());
  const cards = useMemo(
    () => cardsOf(inbox.data, filter).filter((card) => !done.has(card.key)),
    [inbox.data, filter, done],
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const index = Math.max(
    0,
    cards.findIndex((card) => card.key === selectedKey),
  );
  const selected = cards[index];
  const [mode, setMode] = useState<CompareMode>("side");
  const [editingIgnore, setEditingIgnore] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>();

  const move = useCallback(
    (delta: number) => {
      if (!cards.length) return;
      const next = cards[Math.min(cards.length - 1, Math.max(0, index + delta))];
      if (next) setSelectedKey(next.key);
      setEditingIgnore(false);
      setReporting(false);
    },
    [cards, index],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["review", "inbox"] });
    void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs });
  }, [queryClient]);

  const decide = useMutation({
    mutationFn: (input: { card: Card; action: CaptureReviewAction; note?: string }) =>
      service.review(input.card.entry.runId, input.card.item, input.action, input.note),
    onMutate: ({ card }) => {
      // Move on immediately; the decision saves in the background.
      const nextCard = cards[index + 1] ?? cards[index - 1];
      setDone((current) => new Set([...current, card.key]));
      setSelectedKey(nextCard?.key);
      setReporting(false);
      setNote("");
      setMessage(undefined);
    },
    onError: (error, { card }) => {
      setDone((current) => {
        const next = new Set(current);
        next.delete(card.key);
        return next;
      });
      setSelectedKey(card.key);
      setMessage(error instanceof Error ? error.message : "The decision was not saved.");
    },
    onSettled: refresh,
  });

  const ignore = useMutation({
    mutationFn: (input: {
      card: Card;
      regions: Parameters<ReviewProductService["setIgnoreRegions"]>[2];
    }) => service.setIgnoreRegions(input.card.entry.runId, input.card.item, input.regions),
    onSuccess: (queue, { card }) => {
      setEditingIgnore(false);
      const after = queue.items.find((item) => item.captureId === card.item.captureId);
      setMessage(
        after?.status === "accepted"
          ? "It matches the reference once those areas are ignored — approved."
          : "Saved. It still differs outside the ignored areas.",
      );
      if (after?.status === "accepted") {
        setDone((current) => new Set([...current, card.key]));
      }
    },
    onError: (error) =>
      setMessage(error instanceof Error ? error.message : "The ignore areas were not saved."),
    onSettled: refresh,
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      ) {
        if (event.key === "Escape") setReporting(false);
        return;
      }
      if (!selected || editingIgnore) {
        if (event.key === "Escape") setEditingIgnore(false);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") move(1);
      else if (key === "k" || event.key === "ArrowUp") move(-1);
      else if (key === "a") decide.mutate({ card: selected, action: "accept" });
      else if (key === "r") {
        setReporting(true);
        requestAnimationFrame(() => noteRef.current?.focus());
      } else if (key === "i" && selected.item.reference?.state === "changed")
        setEditingIgnore(true);
      else if (key === "1") setMode("side");
      else if (key === "2") setMode("diff");
      else if (key === "3") setMode("swipe");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, editingIgnore, move, decide]);

  // First screenshots have nothing to compare against. Accepting them all at
  // once makes them the references, so later runs only surface real changes.
  const [baseline, setBaseline] = useState<{ saved: number; total: number; failed: number }>();
  const acceptAllNew = useMutation({
    mutationFn: async () => {
      const fresh = cardsOf(inbox.data, "new").filter((card) => !done.has(card.key));
      setBaseline({ saved: 0, total: fresh.length, failed: 0 });
      let next = 0;
      const worker = async () => {
        while (next < fresh.length) {
          const card = fresh[next++]!;
          try {
            await service.review(card.entry.runId, card.item, "accept");
            setDone((current) => new Set([...current, card.key]));
            setBaseline((value) => value && { ...value, saved: value.saved + 1 });
          } catch {
            setBaseline((value) => value && { ...value, failed: value.failed + 1 });
          }
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
    },
    onSettled: refresh,
  });

  const reviewedCount = done.size;
  const changedCount = cardsOf(inbox.data, "changed").length;
  const newCount = cardsOf(inbox.data, "new").length;

  return (
    <section
      className="@container flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden"
      aria-label="Review screenshots"
    >
      <TestWorkspaceHeader
        title="Review"
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {cards.length ? (
              <span className="text-sm text-muted-foreground tabular-nums">
                {cards.length} left{reviewedCount ? ` · ${reviewedCount} done` : ""}
              </span>
            ) : null}
            {changedCount && newCount ? (
              <div
                role="radiogroup"
                aria-label="Show"
                className="flex flex-wrap gap-1 rounded-lg bg-muted/40 p-0.5"
              >
                {(
                  [
                    ["all", `All ${changedCount + newCount}`],
                    ["changed", `Changed ${changedCount}`],
                    ["new", `New ${newCount}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={filter === value}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                      filter === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setFilter(value);
                      setSelectedKey(undefined);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        }
      >
        <span>Compare changes and choose the screenshots to keep as references.</span>
        {inbox.data ? <Totals result={inbox.data} /> : null}
      </TestWorkspaceHeader>

      {newCount && !acceptAllNew.isSuccess ? (
        <WorkspaceToolbar
          leading={
            <p className="max-w-prose text-sm">
              {acceptAllNew.isPending && baseline ? (
                <>
                  Saving {baseline.saved} of {baseline.total}…
                </>
              ) : (
                <>
                  <strong className="font-semibold">
                    {newCount} {newCount === 1 ? "screenshot is" : "screenshots are"} new.
                  </strong>{" "}
                  Review each screenshot to establish its reference.
                </>
              )}
            </p>
          }
          trailing={
            <Button
              size="sm"
              variant="ghost"
              className="max-w-full whitespace-normal"
              disabled={acceptAllNew.isPending}
              onClick={() => acceptAllNew.mutate()}
            >
              <Check aria-hidden="true" />
              {acceptAllNew.isPending ? "Saving…" : `Use all ${newCount} as references`}
            </Button>
          }
        />
      ) : null}
      {baseline && !acceptAllNew.isPending && baseline.failed ? (
        <p className="border-b border-border/60 px-6 py-2 text-sm text-destructive" role="alert">
          {baseline.failed} could not be saved. They are still in the list.
        </p>
      ) : null}

      {inbox.isPending ? (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          Loading screenshots to review…
        </p>
      ) : inbox.isError ? (
        <div className="grid gap-2 p-6 text-sm">
          <p>Relay couldn’t load the review list.</p>
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => void inbox.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : !cards.length ? (
        <div className="grid flex-1 place-content-center justify-items-center gap-3 p-10 text-center">
          <CircleCheck className="size-10 text-success" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Nothing to review</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {inbox.data?.totals.unchanged
              ? `${inbox.data.totals.unchanged} screenshots matched their references.`
              : "Run your tests; changed or new screenshots show up here."}
          </p>
          <div className="flex gap-2">
            <Button nativeButton={false} variant="outline" size="sm" render={<Link to="/suites" />}>
              Run a test plan
            </Button>
            <Button nativeButton={false} variant="ghost" size="sm" render={<Link to="/runs" />}>
              See all results
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] @3xl:grid-cols-[19rem_minmax(0,1fr)]">
          <nav
            aria-label="Screenshots to review"
            className="min-h-0 min-w-0 max-h-48 overflow-x-hidden overflow-y-auto border-b border-border/60 p-3 @3xl:max-h-none @3xl:border-r @3xl:border-b-0"
          >
            {(inbox.data?.entries ?? []).map((entry) => {
              const entryCards = cards.filter((card) => card.entry.runId === entry.runId);
              if (!entryCards.length) return null;
              return (
                <div
                  key={entry.runId}
                  className="min-w-0 border-b border-border/50 py-4 first:pt-0 last:border-b-0"
                >
                  <div className="px-2 pt-1 pb-2.5">
                    <p
                      className="line-clamp-2 text-xs leading-5 font-semibold text-foreground"
                      title={entry.title}
                    >
                      {entry.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[entry.targetName, timeAgo(entry.finishedAt)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
                    {entryCards.map((card) => (
                      <li key={card.key} className="min-w-0">
                        <button
                          type="button"
                          aria-current={card.key === selected?.key ? "true" : undefined}
                          className={`flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                            card.key === selected?.key
                              ? "bg-accent font-medium text-foreground ring-1 ring-inset ring-border"
                              : "text-foreground hover:bg-accent/40"
                          }`}
                          onClick={() => {
                            setSelectedKey(card.key);
                            setEditingIgnore(false);
                            setReporting(false);
                          }}
                        >
                          <span
                            className="min-w-0 flex-1 line-clamp-2 leading-5 wrap-anywhere"
                            title={screenshotName(card.item)}
                          >
                            {screenshotName(card.item)}
                          </span>
                          <StateBadge item={card.item} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>

          {selected ? (
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 @3xl:p-6">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <span className="truncate">{screenshotName(selected.item)}</span>
                      <StateBadge item={selected.item} />
                    </h2>
                    <p className="text-sm wrap-anywhere text-muted-foreground">
                      {[
                        selected.entry.title,
                        selected.entry.targetName,
                        selected.entry.data
                          ? Object.values(selected.entry.data).join(", ")
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {selected.item.lookFor &&
                    selected.item.lookFor !== screenshotName(selected.item) ? (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Look for: </span>
                        {selected.item.lookFor}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    nativeButton={false}
                    size="sm"
                    variant="ghost"
                    render={<Link to="/runs/$runId" params={{ runId: selected.entry.runId }} />}
                  >
                    Open run
                  </Button>
                </div>
                <ReviewCompare
                  key={selected.key}
                  service={service}
                  runId={selected.entry.runId}
                  item={selected.item}
                  finishedAt={selected.entry.finishedAt}
                  mode={mode}
                  onModeChange={setMode}
                  editingIgnore={editingIgnore}
                  savingIgnore={ignore.isPending}
                  onCancelIgnore={() => setEditingIgnore(false)}
                  onSaveIgnore={(regions) => ignore.mutate({ card: selected, regions })}
                />
              </div>

              <footer className="border-t border-border/60 bg-background/95 px-6 py-3 backdrop-blur">
                {message ? (
                  <p className="mb-2 text-sm text-muted-foreground" role="status">
                    {message}
                  </p>
                ) : null}
                {reporting ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      decide.mutate({ card: selected, action: "report-issue", note });
                    }}
                  >
                    <input
                      ref={noteRef}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="What’s wrong? (optional)"
                      aria-label="Describe the issue"
                      className="h-8 min-w-0 basis-48 flex-1 rounded-md border border-border bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    />
                    <Button size="sm" variant="destructive" type="submit">
                      Report issue
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => setReporting(false)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={editingIgnore}
                      title={
                        selected.item.reference?.state === "changed"
                          ? "Replace the reference with this screenshot"
                          : "Use this screenshot as the reference for future runs"
                      }
                      onClick={() => decide.mutate({ card: selected, action: "accept" })}
                    >
                      <Check aria-hidden="true" />
                      Looks correct
                      <kbd className="ml-1 text-xs opacity-60">A</kbd>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={editingIgnore}
                      onClick={() => {
                        setReporting(true);
                        requestAnimationFrame(() => noteRef.current?.focus());
                      }}
                    >
                      <Flag aria-hidden="true" />
                      Report issue
                      <kbd className="ml-1 text-xs opacity-60">R</kbd>
                    </Button>
                    {selected.item.reference?.state === "changed" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={editingIgnore}
                        onClick={() => setEditingIgnore(true)}
                      >
                        <SquareDashed aria-hidden="true" />
                        Ignore areas
                        <kbd className="ml-1 text-xs opacity-60">I</kbd>
                      </Button>
                    ) : null}
                    <ReviewShortcuts />
                  </div>
                )}
              </footer>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ReviewShortcuts() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto shrink-0"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
          />
        }
      >
        <Keyboard aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 p-4">
        <PopoverTitle>Keyboard shortcuts</PopoverTitle>
        <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-xs">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-foreground">
                  {key}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
