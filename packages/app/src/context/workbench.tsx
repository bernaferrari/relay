import { createSignal, createEffect, createMemo, on } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import { useServer, type JobInfo, type PersistedRun, type TraceStep } from "./server";
import { useAppMapExecution } from "./app-map-execution";
import { appMapIdForJob } from "../lib/run-presentation";

/**
 * Internal execution/evidence state shared by the App Map stage and Runs.
 * Execution rows are a read projection of canonical App Map Connections.
 * Their annotation source is, in priority order:
 *   1. step-through results (the debugger: row ▶ / Auto-continue),
 *   2. an explicitly selected run chip (past job or disk run),
 *   3. the live job currently executing this recipe.
 * Any canonical Connection projection change clears annotations back to idle.
 */

export type RowAnno = {
  status: "idle" | "running" | "pass" | "fail" | "review";
  durationMs?: number;
  /** Failure message shown as one compact line under the sentence. */
  error?: string;
  /** Log lines for the expanded row's detail. */
  log?: string;
};

export type RunChip =
  | { kind: "live"; id: string; ts: number; job: JobInfo }
  | { kind: "disk"; id: string; ts: number; run: PersistedRun };

/** A non-destructive request to replay a step over its recorded screen. */
export type StepPreviewRequest = { index: number; token: number };

const AUTO_KEY = "stage:auto-continue";

function loadAutoContinue(): boolean {
  try {
    const v = localStorage.getItem(AUTO_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

/** Map a job/persisted trace step onto the row annotation vocabulary. */
function traceAnno(t: TraceStep | undefined, runError?: string): RowAnno {
  if (!t) return { status: "idle" };
  const status =
    t.status === "ok" || t.status === "healed"
      ? "pass"
      : t.status === "error"
        ? "fail"
        : t.status === "running"
          ? "running"
          : "idle";
  return {
    status,
    ...(t.durationMs ? { durationMs: t.durationMs } : {}),
    ...(t.log ? { log: t.log } : {}),
    ...(status === "fail" ? { error: runError || t.heal || "Step failed" } : {}),
  };
}

export const { use: useWorkbench, provider: WorkbenchProvider } = createSimpleContext({
  name: "Workbench",
  gate: false,
  init: () => {
    const server = useServer();
    const execution = useAppMapExecution();

    // ── Auto-continue (persisted) ────────────────────────────────────────
    const [autoContinue, setAutoContinueState] = createSignal(loadAutoContinue());
    function setAutoContinue(v: boolean): void {
      setAutoContinueState(v);
      try {
        localStorage.setItem(AUTO_KEY, v ? "1" : "0");
      } catch {
        /* ignore */
      }
    }

    // ── Step-through executor ────────────────────────────────────────────
    const [results, setResults] = createSignal<Map<number, RowAnno>>(new Map());
    const [running, setRunning] = createSignal(false);
    // Token invalidates in-flight runs on stop / restart; a superseded run
    // must not write results or flip `running` back.
    let runSeq = 0;

    function putResult(i: number, anno: RowAnno): void {
      setResults((m) => {
        const next = new Map(m);
        next.set(i, anno);
        return next;
      });
    }

    /**
     * Debugger semantics: run the step at `index`; with Auto-continue ON keep
     * flowing down the list, annotating each row, stopping on first failure,
     * on a pause step (human's turn), or on stop().
     */
    async function runFrom(index: number, options?: { continue?: boolean }): Promise<void> {
      if (running()) return;
      const steps = execution.steps();
      if (index < 0 || index >= steps.length) return;
      const cont = options?.continue ?? autoContinue();
      const token = ++runSeq;
      setSelectedChipId(null);
      setRunning(true);
      try {
        for (let i = index; i < steps.length; i++) {
          const step = steps[i]!;
          // A pause step ends the chain — it needs a human, not /step/run.
          if (step.kind === "pause") break;
          putResult(i, { status: "running" });
          const res = await server.runStep(step);
          if (token !== runSeq) return;
          const reviewNeeded = !res.ok && "terminal" in res && res.terminal === "review-needed";
          putResult(
            i,
            res.ok
              ? {
                  status: "pass",
                  ...(res.durationMs ? { durationMs: res.durationMs } : {}),
                  ...(res.logs?.length ? { log: res.logs.join("\n") } : {}),
                }
              : {
                  // An ambiguous iOS command is terminal, but not a normal
                  // failure: it needs fresh pixels and a deliberate human or
                  // agent decision before this debugger can continue.
                  status: reviewNeeded ? "review" : "fail",
                  ...(res.durationMs ? { durationMs: res.durationMs } : {}),
                  error: res.error ?? "Step failed",
                  ...(res.logs?.length ? { log: res.logs.join("\n") } : {}),
                },
          );
          if (!res.ok || !cont) break;
        }
      } finally {
        if (token === runSeq) setRunning(false);
      }
    }

    function stop(): void {
      runSeq++;
      setRunning(false);
      // Drop any row stuck mid-flight so nothing spins forever.
      setResults((m) => {
        const next = new Map(m);
        for (const [k, v] of next) if (v.status === "running") next.delete(k);
        return next;
      });
    }

    function clearAnnotations(): void {
      runSeq++;
      setRunning(false);
      setResults(new Map());
      setSelectedChipId(null);
    }

    // ── Run chips (history strip) ────────────────────────────────────────
    const [selectedChipId, setSelectedChipId] = createSignal<string | null>(null);

    const belongsToSelectedMap = (run: JobInfo | PersistedRun): boolean => {
      const appMapId = server.selectedAppMapId();
      if (!appMapId) return false;
      return (
        run.action === appMapId ||
        run.matrixCase?.appMapId === appMapId ||
        appMapIdForJob(run) === appMapId
      );
    };

    const chips = createMemo<RunChip[]>(() => {
      if (!server.selectedAppMapId()) return [];
      const jobs = server.jobs().filter(belongsToSelectedMap);
      const liveIds = new Set(jobs.map((j) => j.id));
      const rows: RunChip[] = jobs.map((j) => ({
        kind: "live" as const,
        id: j.id,
        ts: j.finishedAt ?? j.startedAt ?? j.queuedAt,
        job: j,
      }));
      for (const run of server.persistedRuns()) {
        if (!belongsToSelectedMap(run) || liveIds.has(run.id)) continue;
        rows.push({ kind: "disk", id: run.id, ts: run.writtenAt, run });
      }
      rows.sort((a, b) => b.ts - a.ts);
      return rows.slice(0, 8);
    });

    const selectedChip = () => chips().find((c) => c.id === selectedChipId()) ?? null;

    /** Click a chip → annotate from that run; click again → back to idle. */
    function toggleChip(id: string): void {
      // Reviewing a run replaces step-through annotations.
      runSeq++;
      setRunning(false);
      setResults(new Map());
      setSelectedChipId((cur) => (cur === id ? null : id));
    }

    /** The job currently executing/paused for the selected App Map, if any. */
    const activeLiveJob = createMemo(() => {
      return (
        server
          .jobs()
          .find(
            (job) =>
              belongsToSelectedMap(job) &&
              (job.status === "running" || job.status === "paused"),
          ) ??
        null
      );
    });

    // ── Annotation resolution ────────────────────────────────────────────
    type Source =
      | { kind: "wb" }
      | { kind: "run"; chip: RunChip; steps: TraceStep[]; error?: string };

    const source = createMemo<Source | null>(() => {
      if (running() || results().size > 0) return { kind: "wb" };
      const chip = selectedChip();
      if (chip) {
        return chip.kind === "live"
          ? { kind: "run", chip, steps: chip.job.steps ?? [], error: chip.job.error }
          : { kind: "run", chip, steps: chip.run.steps, error: chip.run.error };
      }
      const live = activeLiveJob();
      if (live) {
        return {
          kind: "run",
          chip: {
            kind: "live",
            id: live.id,
            ts: live.startedAt ?? live.queuedAt,
            job: live,
          },
          error: live.error,
          steps: live.steps ?? [],
        };
      }
      return null;
    });

    /** The run whose summary/log the pane should show (selected or live). */
    const reviewedRun = () => {
      const s = source();
      return s && s.kind === "run" ? s.chip : null;
    };

    /** Exact trace evidence for the selected human-readable step. */
    const focusedTraceStep = () => {
      const s = source();
      const index = focusedIndex();
      return s?.kind === "run" && index != null ? s.steps[index] : undefined;
    };

    /** Row annotation for step index `i` — the one lookup every list uses. */
    function rowAnno(i: number): RowAnno {
      const s = source();
      if (!s) return { status: "idle" };
      if (s.kind === "wb") return results().get(i) ?? { status: "idle" };
      // Attach the run-level error only to the failing row.
      return traceAnno(s.steps[i], s.error);
    }

    // Any edit to the steps (manual, recorded, or switching recipes) clears
    // annotations back to idle — stale results on changed steps lie.
    createEffect(on(execution.steps, () => clearAnnotations(), { defer: true }));

    // ── Step ↔ frame focus (Figma selection: one index lights both sides) ─
    const [focusedIndex, setFocusedIndex] = createSignal<number | null>(null);
    const [previewRequest, setPreviewRequest] = createSignal<StepPreviewRequest | null>(null);
    let previewToken = 0;

    // New App Map selected → focus its first projected Connection action.
    createEffect(
      on(server.selectedAppMapId, (id) => {
        if (!id) {
          setFocusedIndex(null);
          return;
        }
        // Defer so the canonical document projection has loaded.
        queueMicrotask(() => {
          const n = execution.steps().length;
          if (n > 0) focusStep(0);
          else setFocusedIndex(null);
        });
      }),
    );

    /**
     * Select a step (phone + list highlight). Does NOT open the editor —
     * expand is a separate affordance so users never “lose” the list context.
     */
    function focusStep(i: number | null): void {
      const count = execution.steps().length;
      const next =
        i == null || count === 0 || !Number.isFinite(i)
          ? null
          : Math.max(0, Math.min(Math.trunc(i), count - 1));
      setFocusedIndex(next);
      if (next != null) server.stopPlayback();
    }

    function previewStep(index: number): void {
      if (index < 0 || index >= execution.steps().length) return;
      setPreviewRequest({ index, token: ++previewToken });
    }

    /** Preview requests are one-shot UI events, never persistent selection. */
    function clearPreviewRequest(token: number): void {
      setPreviewRequest((current) => (current?.token === token ? null : current));
    }

    /** Select a frame — lights the matching step without forcing the editor open. */
    function focusFrame(i: number): void {
      server.setFrameIndex(i);
      const frame = server.frames()[i];
      const s = source();
      const matched =
        frame && s?.kind === "run"
          ? s.steps.findIndex((step) =>
              step.frames.some(
                (candidate) =>
                  candidate.capturedAt === frame.capturedAt ||
                  (candidate.path && frame.path && candidate.path === frame.path),
              ),
            )
          : -1;

      // Frames produced outside a run do not carry a step id. They still
      // arrive in step order, so use that ordered position as the explicit
      // fallback. A screen can never become merely "shown" while its list
      // row and inspector remain on a different step.
      focusStep(matched >= 0 ? matched : i);
    }

    return {
      autoContinue,
      setAutoContinue,
      running,
      runFrom,
      stop,
      clearAnnotations,
      chips,
      selectedChipId,
      toggleChip,
      activeLiveJob,
      reviewedRun,
      focusedTraceStep,
      rowAnno,
      focusedIndex,
      focusStep,
      focusFrame,
      previewRequest,
      previewStep,
      clearPreviewRequest,
    };
  },
});
