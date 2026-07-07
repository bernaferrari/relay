import { createSignal, createEffect } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { useServer, type SnapshotNode, type RecipeStep, type StepTarget } from "./server";
import { nodeAtPoint, targetFromStrategy, type PickStrategy } from "../lib/snapshot";
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

function descTarget(t: StepTarget): string {
  const parts: string[] = [];
  if (t.ref) parts.push(t.ref);
  if (t.label) parts.push(`"${t.label}"`);
  if (t.text) parts.push(`text "${t.text}"`);
  if (t.point) parts.push(`${t.point.x},${t.point.y}`);
  return parts.join(" · ") || "<target>";
}

/** Human-readable one-liner for a RecipeStep (stage / run-panel / editor). */
export function describeStep(step: RecipeStep): string {
  switch (step.kind) {
    case "tap":
      return `tap ${descTarget(step.target)}`;
    case "type":
      return step.target
        ? `type "${step.text}" → ${descTarget(step.target)}`
        : `type "${step.text}"`;
    case "scroll":
      return step.amount ? `scroll ${step.direction} ${step.amount}` : `scroll ${step.direction}`;
    case "swipe":
      return `swipe ${Math.round(step.from.x)},${Math.round(step.from.y)} → ${Math.round(step.to.x)},${Math.round(step.to.y)}`;
    case "key":
      return `key ${step.key}`;
    case "sleep":
      return `sleep ${step.ms}ms`;
    case "wait-for":
      return `wait for ${descTarget(step.target)}${
        step.timeoutMs ? ` (${Math.round(step.timeoutMs / 1000)}s)` : ""
      }`;
    case "pause":
      return `pause: ${step.message}`;
    case "screenshot":
      return step.caption ? `screenshot · ${step.caption}` : "screenshot";
    case "flow":
      return `flow: ${step.flow}`;
  }
}

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

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const [interacting, setInteracting] = createSignal(false);
    const [recording, setRecording] = createSignal(false);
    const [steps, setSteps] = createSignal<RecipeStep[]>([]);

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
        toast("Server offline — can't interact", "warning");
        return false;
      }
      // Flush any buffered typing first so order stays tap → type, not interleaved.
      await flushType();
      if (!server.snapshot()?.bounds) {
        await server.captureUiSnapshot().catch(() => undefined);
      }
      const node = nodeAtPoint(server.snapshot(), fx, fy);
      const target = buildTapTarget(server.snapshot()?.bounds, node, fx, fy);
      const step: RecipeStep = { kind: "tap", target };
      const ok = await executeTap(target, describeStep(step));
      if (ok && recording()) setSteps((s) => [...s, step]);
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
        toast("Server offline — can't interact", "warning");
        return false;
      }
      await flushType();
      const b = server.snapshot()?.bounds;
      const w = b?.width ?? 1;
      const h = b?.height ?? 1;
      const devFrom = { x: Math.round(from.x * w), y: Math.round(from.y * h) };
      const devTo = { x: Math.round(to.x * w), y: Math.round(to.y * h) };
      const step: RecipeStep = { kind: "swipe", from: devFrom, to: devTo, durationMs };
      const ok = await server.interactStep(
        { kind: "swipe", from: devFrom, to: devTo, durationMs },
        describeStep(step),
      );
      if (ok && recording()) setSteps((s) => [...s, step]);
      return ok;
    }

    /** Internal: append a recorded step (no toast — the bar shows the list). */
    function recordStep(step: RecipeStep): void {
      setSteps((s) => [...s, step]);
    }

    /**
     * Record a picker (right-click) choice as a tap step. The user explicitly
     * picked a strategy, so ONLY that strategy's field is recorded (plus point
     * as the emergency fallback); the runner's ref → label → text → point order
     * must not silently override the user's intent.
     */
    function recordPick(strategy: PickStrategy, fx: number, fy: number): void {
      const target = targetFromStrategy(strategy, fx, fy, server.snapshot()?.bounds);
      recordStep({ kind: "tap", target });
    }

    function clearSteps(): void {
      setSteps([]);
    }
    function removeStep(i: number): void {
      setSteps((s) => s.filter((_, idx) => idx !== i));
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
      const step: RecipeStep = { kind: "type", text };
      const ok = await server.interactStep({ kind: "type", text }, describeStep(step));
      if (ok && recording()) setSteps((s) => [...s, step]);
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

    /** Save the recorded steps as a server recipe, then clear the buffer. */
    async function saveRecipe(title: string): Promise<void> {
      // Capture any buffered typing before freezing the step list.
      await flushType();
      const t = title.trim() || `Recipe ${Date.now().toString(36).slice(-4)}`;
      const saved = await server.saveRecipeRemote({ title: t, steps: steps() });
      if (saved) {
        setSteps([]);
        setRecording(false);
        server.setSelectedRecipeId(saved.id);
        toast(`Saved "${saved.title}" — ${saved.steps.length} steps`, "success");
      }
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
        toast(`Forked "${recipe.title}"`, "success");
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
            title: (r.title ?? "Recipe").trim() || "Recipe",
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
      steps,
      driveTap,
      driveSwipe,
      typeBuffer,
      feedTypeKey,
      flushType,
      recordPick,
      clearSteps,
      removeStep,
      saveRecipe,
      forkRecipe,
    };
  },
});
