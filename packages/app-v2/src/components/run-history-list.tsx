/** @jsxImportSource react */
import type { ProductRunSummary } from "@relay/product/catalog";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";

export const RUN_HISTORY_VIRTUAL_THRESHOLD = 80;
export const RUN_HISTORY_ROW_HEIGHT = 79;
export const RUN_HISTORY_COMPACT_ROW_HEIGHT = 108;
const OVERSCAN = 5;

export type RunHistoryRowInteraction = {
  tabIndex: number;
  "data-run-index": number;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
};

export function RunHistoryList({
  runs,
  children,
}: {
  runs: readonly ProductRunSummary[];
  children(
    run: ProductRunSummary,
    index: number,
    interaction?: RunHistoryRowInteraction,
  ): ReactNode;
}) {
  if (runs.length <= RUN_HISTORY_VIRTUAL_THRESHOLD) {
    return (
      <ul className="relay-library-list relay-run-list">
        {runs.map((run, index) => (
          <li key={run.id}>{children(run, index)}</li>
        ))}
      </ul>
    );
  }
  return <WindowedRunHistory runs={runs}>{children}</WindowedRunHistory>;
}

function WindowedRunHistory({
  runs,
  children,
}: {
  runs: readonly ProductRunSummary[];
  children(run: ProductRunSummary, index: number, interaction: RunHistoryRowInteraction): ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(360);
  const [scrollTop, setScrollTop] = useState(0);
  const [compact, setCompact] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rowHeight = compact ? RUN_HISTORY_COMPACT_ROW_HEIGHT : RUN_HISTORY_ROW_HEIGHT;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2;
  const end = Math.min(runs.length, start + visibleCount);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      setScrollTop(viewport.scrollTop);
      setViewportHeight(viewport.clientHeight || 360);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = 0;
  }, [runs]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.contains(document.activeElement)) return;
    if (activeIndex < start || activeIndex >= end) setActiveIndex(start);
  }, [activeIndex, end, start]);

  const renderedIndexes = useMemo(() => {
    const indexes = Array.from({ length: end - start }, (_, offset) => start + offset);
    if (!indexes.includes(activeIndex)) indexes.push(activeIndex);
    return indexes.sort((left, right) => left - right);
  }, [activeIndex, end, start]);

  function focusIndex(index: number) {
    const nextIndex = Math.max(0, Math.min(runs.length - 1, index));
    setActiveIndex(nextIndex);
    const viewport = viewportRef.current;
    if (viewport) {
      const top = nextIndex * rowHeight;
      const bottom = top + rowHeight;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + viewport.clientHeight) {
        viewport.scrollTop = bottom - viewport.clientHeight;
      }
    }
    window.requestAnimationFrame(() => {
      viewportRef.current?.querySelector<HTMLElement>(`[data-run-index="${nextIndex}"]`)?.focus();
    });
  }

  function rowKeyDown(index: number): KeyboardEventHandler<HTMLElement> {
    return (event) => {
      const pageSize = Math.max(1, Math.floor(viewportHeight / rowHeight));
      const next =
        event.key === "ArrowDown"
          ? index + 1
          : event.key === "ArrowUp"
            ? index - 1
            : event.key === "PageDown"
              ? index + pageSize
              : event.key === "PageUp"
                ? index - pageSize
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? runs.length - 1
                    : undefined;
      if (next === undefined) return;
      event.preventDefault();
      focusIndex(next);
    };
  }

  return (
    <div className="relay-windowed-run-history">
      <p className="relay-visually-hidden" id="run-history-keyboard-help">
        This long history is windowed for performance. Use Up and Down to move one Report, Page Up
        and Page Down to move by a screen, and Home or End to jump to the first or last Report.
      </p>
      <div
        ref={viewportRef}
        className="relay-windowed-run-scroll min-w-0 overflow-auto overscroll-contain"
        aria-label={`${runs.length} Runs`}
        aria-describedby="run-history-keyboard-help"
      >
        <ul
          className="relay-library-list relay-run-list relay-windowed-run-list"
          style={
            {
              height: runs.length * rowHeight,
              "--relay-windowed-run-row-height": `${rowHeight}px`,
            } as CSSProperties
          }
        >
          {renderedIndexes.map((index) => {
            const run = runs[index];
            if (!run) return null;
            return (
              <li
                key={run.id}
                aria-posinset={index + 1}
                aria-setsize={runs.length}
                style={{ transform: `translateY(${index * rowHeight}px)` }}
              >
                {children(run, index, {
                  tabIndex: activeIndex === index ? 0 : -1,
                  "data-run-index": index,
                  onKeyDown: rowKeyDown(index),
                })}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
