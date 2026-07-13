import { createSignal, createEffect } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import {
  useServer,
  type Frame,
  type RecordedNodeEvidence,
  type RecordedSelectorCandidate,
  type RecordedStepEvidence,
  type SnapshotNode,
  type SnapshotState,
  type RecipeStep,
  type StepTarget,
} from "./server";
import {
  ancestryOf,
  nodeAtPoint,
  strategiesFor,
  targetFromStrategy,
  type PickStrategy,
} from "../lib/snapshot";
import { sentenceForStep } from "../lib/step-sentence";
import { useRecipeDraft } from "./recipe-draft";
import { toast } from "./toast";

/**
 * Interactive recorder: click the device preview to tap the real device, and
 * record each tap at every available abstraction level — the full fallback
 * chain (ref · label · point) — so replays survive app updates. Recorded
 * sequences are saved as server recipes (POST /recipes) and replayed as jobs
 * (POST /jobs {recipe}); localStorage is only read once, to migrate legacy
 * recipes onto the server.
 */
export type RecLevel = "smart" | "element" | "point";

/** Legacy localStorage step shape (pre-plan-003). */
export type LegacyRecStep =
  | { kind: "ref"; ref: string; label?: string }
  | { kind: "label"; label: string }
  | { kind: "point"; x: number; y: number };

/** Legacy only — recipes now live on the server. Kept for one-time migration. */
const STORAGE_KEY = "specimen:custom-recipes";

/**
 * Pure: map a legacy localStorage step to a plan-002 RecipeStep. Every legacy
 * kind was a tap, so all become `{ kind: "tap", target: {...} }` carrying the
 * fields that were known. (Extracted to a pure function so it is testable
 * headlessly — the app package has no test harness today.)
 */
export function migrateLegacyStep(step: LegacyRecStep): RecipeStep {
  if (step.kind === "ref") {
    const target: StepTarget = { ref: step.ref };
    if (step.label) target.label = step.label;
    return { kind: "tap", target };
  }
  if (step.kind === "label") return { kind: "tap", target: { label: step.label } };
  return { kind: "tap", target: { point: { x: step.x, y: step.y } } };
}

/** Human-readable one-liner for a RecipeStep (stage / run-panel row / log
 *  captions) — re-exported here so existing `from "../context/recorder"`
 *  imports keep working. Canonical implementation lives in lib/step-sentence
 *  so it's shared by the row list without pulling in this context. */
export const describeStep = sentenceForStep;

/**
 * Build the full tap target for a click — every field that is known, so the
 * recorded step can fall back through ref → label → point at replay time
 * (plan 002's runner). Pure: shared by the recorder and the stage picker.
 */
export function buildTapTarget(
  bounds: { width: number; height: number } | undefined,
  node: SnapshotNode | null,
  fx: number,
  fy: number,
): StepTarget {
  const w = bounds?.width ?? 1;
  const h = bounds?.height ?? 1;
  const point = { x: Math.round(fx * w), y: Math.round(fy * h) };
  if (!node) return { point };
  const label = (node.label ?? node.value ?? node.identifier ?? "").trim();
  const target: StepTarget = { point };
  if (node.ref) target.ref = node.ref.startsWith("@") ? node.ref : `@${node.ref}`;
  if (label) target.label = label;
  return target;
}

function evidenceId(): string {
  const suffix =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `ev-${Date.now().toString(36)}-${suffix}`;
}

function recordedNode(node: SnapshotNode): RecordedNodeEvidence {
  return {
    ...(node.label ? { label: node.label } : {}),
    ...(node.value ? { value: node.value } : {}),
    ...(node.identifier ? { identifier: node.identifier } : {}),
    ...(node.role ? { role: node.role } : {}),
    ...(node.type ? { type: node.type } : {}),
    ...(node.ref ? { ref: node.ref.startsWith("@") ? node.ref : `@${node.ref}` } : {}),
    ...(node.index !== undefined ? { index: node.index } : {}),
    ...(node.rect ? { rect: { ...node.rect } } : {}),
  };
}

function recordedCandidates(
  snap: SnapshotState,
  node: SnapshotNode | null,
  fx: number,
  fy: number,
): RecordedSelectorCandidate[] {
  const candidates: RecordedSelectorCandidate[] = [];
  const seen = new Set<string>();
  const chain = node && snap ? ancestryOf(snap, node).slice(0, 8) : [];
  chain.forEach((candidateNode, index) => {
    for (const strategy of strategiesFor(candidateNode, snap, fx, fy)) {
      if (strategy.kind === "point") continue;
      const target = targetFromStrategy(strategy, fx, fy, snap?.bounds);
      const key = `${strategy.kind}:${JSON.stringify(target)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        strategy: strategy.kind,
        label: strategy.describe,
        source: index === 0 ? "element" : "ancestor",
        confidence: index === 0 ? "high" : "medium",
        target,
      });
    }
  });
  const point = targetFromStrategy(
    {
      id: "point",
      kind: "point",
      x: Math.round(fx * (snap?.bounds?.width ?? 1)),
      y: Math.round(fy * (snap?.bounds?.height ?? 1)),
      describe: "Coordinate",
    },
    fx,
    fy,
    snap?.bounds,
  );
  candidates.push({
    strategy: "point",
    label: `coordinate ${point.point?.x ?? 0}, ${point.point?.y ?? 0}`,
    source: "coordinate",
    confidence: "fallback",
    target: point,
  });
  return candidates;
}

function recordedEvidence(
  snap: SnapshotState,
  node: SnapshotNode | null,
  fx?: number,
  fy?: number,
  serial?: string | null,
): RecordedStepEvidence {
  const id = evidenceId();
  const bounds = snap?.bounds;
  const hasPointer = fx !== undefined && fy !== undefined;
  return {
    id,
    recordedAt: Date.now(),
    ...(serial ? { serial } : {}),
    ...(bounds ? { deviceBounds: { ...bounds } } : {}),
    ...(hasPointer && bounds
      ? { pointer: { x: Math.round(fx * bounds.width), y: Math.round(fy * bounds.height) } }
      : {}),
    ...(node ? { node: recordedNode(node) } : {}),
    ...(node && snap ? { ancestors: ancestryOf(snap, node).slice(1, 9).map(recordedNode) } : {}),
    ...(hasPointer ? { candidates: recordedCandidates(snap, node, fx, fy) } : {}),
  };
}

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const draft = useRecipeDraft();
    const [interacting, setInteracting] = createSignal(false);
    const [recording, setRecording] = createSignal(false);

    /** "Recorded test N" — next free number, so back-to-back recordings
     *  without a rename don't collide. */
    function nextRecordedTitle(): string {
      const used = new Set(
        server
          .recipes()
          .map((r) => /^Recorded test (\d+)$/.exec(r.title)?.[1])
          .filter((x): x is string => Boolean(x))
          .map((x) => parseInt(x, 10)),
      );
      let n = 1;
      while (used.has(n)) n++;
      return `Recorded test ${n}`;
    }

    /** Where should a just-captured step land? The selected test — builtin
     *  or custom (builtins silently auto-fork on save). Nothing selected →
     *  auto-create + select "Recorded test N". Returns null only if the
     *  create-recipe call itself failed (offline etc). */
    async function ensureRecordingTarget(): Promise<string | null> {
      return draft.ensureRecordingDraft(nextRecordedTitle);
    }

    function latestFrame(since = 0): Frame | undefined {
      return [...server.frames()].reverse().find((frame) => frame.capturedAt >= since);
    }

    async function attachEvidenceScreenshot(
      evidence: RecordedStepEvidence,
      recipeId: string,
      frame: Frame | undefined,
    ): Promise<void> {
      if (!frame || frame.mime !== "image/png") return;
      const saved = await server.persistRecordingEvidence(recipeId, evidence.id, frame);
      if (!saved) return;
      evidence.screenshot = {
        recipeId,
        id: evidence.id,
        capturedAt: frame.capturedAt,
        mime: "image/png",
      };
    }

    /** Enter Record mode: arm the flag + make sure the stage has something
     *  to show (overlays on, a snapshot if we don't have one yet). Shared by
     *  the stage's segmented control and the empty-state's "Record from
     *  device" action so both paths behave identically. */
    function enterRecordMode(): void {
      if (recording()) return;
      setInteracting(true);
      setRecording(true);
      server.setShowOverlays(true);
      void Promise.all([
        server.captureUiSnapshot(),
        server.captureUiScreenshot("Recording started", undefined, undefined, true),
      ]).catch(() => undefined);
    }

    async function stopRecording(): Promise<void> {
      await flushType();
      setRecording(false);
    }

    /** Execute a tap target on the device, preferring ref → label → point. */
    async function executeTap(target: StepTarget, caption?: string): Promise<boolean> {
      if (target.ref) {
        const ok = await server.interactStep({ kind: "ref", ref: target.ref }, caption);
        if (ok) return true;
      }
      if (target.label) {
        const ok = await server.interactStep({ kind: "label", label: target.label }, caption);
        if (ok) return true;
      }
      if (target.point) {
        return server.interactStep(
          { kind: "point", x: target.point.x, y: target.point.y },
          caption,
        );
      }
      return false;
    }

    /**
     * Drive a tap through the mirror: hit-test the current snapshot, build the
     * FULL target silently (ref · label · point — every known field), send the
     * interaction preferring ref → label → point exactly like the runner, and
     * if recording append a tap step. No strategy UI, no per-step toast — the
     * recorder bar is the single feedback surface (plan 010 step 3).
     */
    async function driveTap(fx: number, fy: number): Promise<boolean> {
      if (server.health() !== "online") {
        toast("Relay isn’t connected — can’t interact yet", "warning");
        return false;
      }
      // Flush any buffered typing first so order stays tap → type, not interleaved.
      await flushType();
      if (!server.snapshot()?.bounds) {
        await server.captureUiSnapshot().catch(() => undefined);
      }
      const node = nodeAtPoint(server.snapshot(), fx, fy);
      const target = buildTapTarget(server.snapshot()?.bounds, node, fx, fy);
      const evidence = recordedEvidence(server.snapshot(), node, fx, fy, server.selectedDevice());
      const step: Extract<RecipeStep, { kind: "tap" }> = { kind: "tap", target };
      const ok = await executeTap(target, describeStep(step));
      if (ok && recording()) {
        const id = await ensureRecordingTarget();
        if (id) {
          await attachEvidenceScreenshot(evidence, id, latestFrame(evidence.recordedAt));
          draft.appendSteps([{ ...step, evidence }]);
        }
      }
      return ok;
    }

    /**
     * Drive a swipe through the mirror. `from`/`to` are fractional image
     * coords (0..1); converted to device coords via snapshot bounds. Sends the
     * interaction and, if recording, appends a swipe step.
     */
    async function driveSwipe(
      from: { x: number; y: number },
      to: { x: number; y: number },
      durationMs: number,
    ): Promise<boolean> {
      if (server.health() !== "online") {
        toast("Relay isn’t connected — can’t interact yet", "warning");
        return false;
      }
      await flushType();
      const b = server.snapshot()?.bounds;
      const w = b?.width ?? 1;
      const h = b?.height ?? 1;
      const devFrom = { x: Math.round(from.x * w), y: Math.round(from.y * h) };
      const devTo = { x: Math.round(to.x * w), y: Math.round(to.y * h) };
      const evidence = recordedEvidence(
        server.snapshot(),
        nodeAtPoint(server.snapshot(), from.x, from.y),
        from.x,
        from.y,
        server.selectedDevice(),
      );
      const step: Extract<RecipeStep, { kind: "swipe" }> = {
        kind: "swipe",
        from: devFrom,
        to: devTo,
        durationMs,
      };
      const ok = await server.interactStep(
        { kind: "swipe", from: devFrom, to: devTo, durationMs },
        describeStep(step),
      );
      if (ok && recording()) {
        const id = await ensureRecordingTarget();
        if (id) {
          await attachEvidenceScreenshot(evidence, id, latestFrame(evidence.recordedAt));
          draft.appendSteps([{ ...step, evidence }]);
        }
      }
      return ok;
    }

    /**
     * Record a picker (right-click) choice as a tap step. The user explicitly
     * picked a strategy, so ONLY that strategy's field is recorded (plus point
     * as the emergency fallback); the runner's ref → label → text → point order
     * must not silently override the user's intent.
     */
    async function recordPick(strategy: PickStrategy, fx: number, fy: number): Promise<void> {
      const target = targetFromStrategy(strategy, fx, fy, server.snapshot()?.bounds);
      const id = await ensureRecordingTarget();
      if (!id) return;
      const frame = latestFrame();
      const node = nodeAtPoint(server.snapshot(), fx, fy);
      const evidence = recordedEvidence(server.snapshot(), node, fx, fy, server.selectedDevice());
      if (frame) evidence.recordedAt = Math.min(evidence.recordedAt, frame.capturedAt);
      await attachEvidenceScreenshot(evidence, id, frame);
      draft.appendSteps([{ kind: "tap", target, evidence }]);
    }

    // ── Typing capture (plan 010 step 3.3) ──────────────────────────────────
    // Keystrokes are buffered while Drive/Record is active and no app input or
    // modal has focus, then flushed as ONE type interaction + ONE recorded step
    // after 800 ms idle or on Enter. The window keydown listener (in the stage,
    // which can see the command context's modalOpen gate) calls feedTypeKey.
    const [typeBuffer, setTypeBuffer] = createSignal("");
    let typeTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleTypeFlush(): void {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => void flushType(), 800);
    }

    /** Send the buffered text to the device + record a type step. No-op if empty. */
    async function flushType(): Promise<void> {
      if (typeTimer) {
        clearTimeout(typeTimer);
        typeTimer = undefined;
      }
      const text = typeBuffer();
      if (!text) return;
      setTypeBuffer("");
      if (server.health() !== "online") return;
      const evidence = recordedEvidence(
        server.snapshot(),
        null,
        undefined,
        undefined,
        server.selectedDevice(),
      );
      const step: Extract<RecipeStep, { kind: "type" }> = { kind: "type", text };
      const ok = await server.interactStep({ kind: "type", text }, describeStep(step));
      if (ok && recording()) {
        const id = await ensureRecordingTarget();
        if (id) {
          await attachEvidenceScreenshot(evidence, id, latestFrame(evidence.recordedAt));
          draft.appendSteps([{ ...step, evidence }]);
        }
      }
    }

    /**
     * Buffer a keyboard event for the phone. Handles Escape (clear), Enter
     * (flush + end), Backspace (delete last), and printable chars. Returns true
     * when the key was consumed (the caller may preventDefault). The caller is
     * responsible for the modal/focus/modifier gate so palette keys never reach
     * here.
     */
    function feedTypeKey(e: KeyboardEvent): boolean {
      if (e.key === "Escape") {
        setTypeBuffer("");
        return true;
      }
      if (e.key === "Enter") {
        void flushType();
        return true;
      }
      if (e.key === "Backspace") {
        setTypeBuffer((b) => b.slice(0, -1));
        scheduleTypeFlush();
        return true;
      }
      if (e.key.length === 1) {
        setTypeBuffer((b) => b + e.key);
        scheduleTypeFlush();
        return true;
      }
      return false;
    }

    /**
     * Fork any recipe (builtin or custom) into an editable custom copy. Builtins
     * are recipes whose steps are a single opaque `flow` step, so the copy is
     * honest now (previously it forked an empty recipe).
     */
    async function forkRecipe(recipe: {
      title: string;
      description?: string;
      steps: RecipeStep[];
    }): Promise<void> {
      const saved = await server.saveRecipeRemote({
        title: `${recipe.title} (copy)`,
        description: recipe.description,
        steps: recipe.steps,
      });
      if (saved) {
        server.setSelectedRecipeId(saved.id);
        toast(`Created a copy of “${recipe.title}”`, "success");
      }
    }

    // ---- One-time localStorage migration (plan 003, Step 2) ----
    // Reads legacy `specimen:custom-recipes`, converts each recipe to
    // RecipeSteps, and POSTs them to the server. The key is removed ONLY after
    // every recipe saves successfully; on failure we retry when health flips
    // back online. Losing a user's recorded recipes is the one unrecoverable
    // failure in this plan.
    let migrationInFlight = false;
    let migrationDone = false;
    async function migrateLegacyRecipes(): Promise<void> {
      if (migrationDone || migrationInFlight) return;
      if (server.health() !== "online") return;
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        return;
      }
      if (!raw) {
        migrationDone = true;
        return;
      }
      let legacy: { id?: string; title?: string; steps?: LegacyRecStep[] }[] = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) legacy = parsed as typeof legacy;
      } catch {
        // corrupt key — nothing we can migrate; leave it for safety
        migrationDone = true;
        return;
      }
      if (legacy.length === 0) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        migrationDone = true;
        return;
      }
      migrationInFlight = true;
      let allOk = true;
      try {
        for (const r of legacy) {
          const steps = (r.steps ?? []).map(migrateLegacyStep);
          const saved = await server.saveRecipeRemote({
            title: (r.title ?? "Untitled test").trim() || "Untitled test",
            steps,
          });
          if (!saved) allOk = false;
        }
        if (allOk) {
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          migrationDone = true;
          toast(
            `Migrated ${legacy.length} recorded recipe${legacy.length === 1 ? "" : "s"} to the server`,
            "success",
          );
        }
      } finally {
        migrationInFlight = false;
      }
    }

    // attempt on init (no-op if offline) and retry when health flips online
    void migrateLegacyRecipes();
    createEffect(() => {
      if (server.health() === "online") void migrateLegacyRecipes();
    });

    return {
      interacting,
      setInteracting,
      recording,
      setRecording,
      enterRecordMode,
      stopRecording,
      driveTap,
      driveSwipe,
      typeBuffer,
      feedTypeKey,
      flushType,
      recordPick,
      forkRecipe,
    };
  },
});
