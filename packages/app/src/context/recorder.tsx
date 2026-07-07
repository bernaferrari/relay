import { createSignal } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { useServer, type SnapshotNode } from "./server";
import { toast } from "./toast";

/**
 * Interactive recorder: click the device preview to tap the real device, and
 * record each tap at the best available abstraction level —
 *   click @e26            (accessibility ref — most robust)
 *   click "Sign in"       (label text)
 *   click 540, 1200       (raw coordinate — always works)
 * Recorded sequences become custom recipes (client-side macros) you can replay.
 */
export type RecLevel = "smart" | "element" | "point";

export type RecStep =
  | { kind: "ref"; ref: string; label?: string }
  | { kind: "label"; label: string }
  | { kind: "point"; x: number; y: number };

export type CustomRecipe = {
  id: string;
  title: string;
  steps: RecStep[];
  createdAt: number;
};

const STORAGE_KEY = "specimen:custom-recipes";

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export function describeStep(step: RecStep): string {
  if (step.kind === "ref")
    return step.label ? `click ${step.ref} · ${step.label}` : `click ${step.ref}`;
  if (step.kind === "label") return `click "${step.label}"`;
  return `click ${step.x}, ${step.y}`;
}

function loadRecipes(): CustomRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomRecipe[]) : [];
  } catch {
    return [];
  }
}

function persist(list: CustomRecipe[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export const { use: useRecorder, provider: RecorderProvider } = createSimpleContext({
  name: "Recorder",
  gate: false,
  init: () => {
    const server = useServer();
    const [interacting, setInteracting] = createSignal(false);
    const [recording, setRecording] = createSignal(false);
    const [level, setLevel] = createSignal<RecLevel>("smart");
    const [steps, setSteps] = createSignal<RecStep[]>([]);
    const [recipes, setRecipes] = createSignal<CustomRecipe[]>(loadRecipes());
    const [replaying, setReplaying] = createSignal(false);
    const [selectedRecipeId, setSelectedRecipeId] = createSignal<string | null>(null);
    const selectedRecipe = () => recipes().find((r) => r.id === selectedRecipeId()) ?? null;

    /** Most specific a11y node containing the fractional point (null if none). */
    function nodeAt(fx: number, fy: number): SnapshotNode | null {
      const snap = server.snapshot();
      if (!snap?.bounds) return null;
      const bw = snap.bounds.width;
      const bh = snap.bounds.height;
      let best: SnapshotNode | null = null;
      let bestArea = Infinity;
      for (const n of snap.nodes) {
        if (!n.rect) continue;
        const nx = n.rect.x / bw;
        const ny = n.rect.y / bh;
        const nw = n.rect.width / bw;
        const nh = n.rect.height / bh;
        if (fx >= nx && fx <= nx + nw && fy >= ny && fy <= ny + nh) {
          const area = nw * nh;
          if (area > 0 && area < bestArea) {
            best = n;
            bestArea = area;
          }
        }
      }
      return best;
    }

    /** Pick the step kind for the chosen level + hit node. */
    function resolveStep(node: SnapshotNode | null, fx: number, fy: number): RecStep {
      const bounds = server.snapshot()?.bounds;
      const w = bounds?.width ?? 1;
      const h = bounds?.height ?? 1;
      const asPoint = (): RecStep => ({
        kind: "point",
        x: Math.round(fx * w),
        y: Math.round(fy * h),
      });
      const lv = level();
      if (lv === "point" || !node) return asPoint();
      const label = (node.label ?? node.value ?? node.identifier ?? "").trim();
      if (node.ref) {
        return {
          kind: "ref",
          ref: node.ref.startsWith("@") ? node.ref : `@${node.ref}`,
          label: label || undefined,
        };
      }
      if (label) return { kind: "label", label };
      return asPoint();
    }

    /** Called by the stage on a preview click (fx, fy are 0..1 of the image). */
    async function handleTap(fx: number, fy: number): Promise<void> {
      if (server.health() !== "online") {
        toast("Server offline — can't interact", "warning");
        return;
      }
      // need a snapshot to resolve elements; grab one if missing and not pure-point
      if (!server.snapshot()?.bounds) {
        await server.captureUiSnapshot().catch(() => undefined);
      }
      const node = nodeAt(fx, fy);
      const step = resolveStep(node, fx, fy);
      let ok = await server.interactStep(step, describeStep(step));
      let recorded = step;
      if (!ok && step.kind !== "point") {
        // ref/label failed (no session) — retry as a raw coordinate tap
        const bounds = server.snapshot()?.bounds;
        if (bounds) {
          const pointStep: RecStep = {
            kind: "point",
            x: Math.round(fx * bounds.width),
            y: Math.round(fy * bounds.height),
          };
          ok = await server.interactStep(pointStep, describeStep(pointStep));
          recorded = pointStep;
        }
      }
      if (ok && recording()) {
        setSteps((s) => [...s, recorded]);
        toast(describeStep(recorded), "info", 1600);
      }
    }

    /** Record a step without executing (used by the stage element picker). */
    function recordStep(step: RecStep): void {
      setSteps((s) => [...s, step]);
      toast(describeStep(step), "info", 1600);
    }

    function clearSteps(): void {
      setSteps([]);
    }
    function removeStep(i: number): void {
      setSteps((s) => s.filter((_, idx) => idx !== i));
    }

    function saveRecipe(title: string): void {
      const t = title.trim() || `Recipe ${recipes().length + 1}`;
      const r: CustomRecipe = {
        id: `custom-${Date.now().toString(36)}`,
        title: t,
        steps: steps(),
        createdAt: Date.now(),
      };
      const next = [r, ...recipes()];
      setRecipes(next);
      persist(next);
      setSteps([]);
      setRecording(false);
      toast(`Saved "${t}" — ${r.steps.length} steps`, "success");
    }
    function saveRecipeFromSteps(title: string, newSteps: RecStep[]): void {
      const t = title.trim() || `Recipe ${recipes().length + 1}`;
      const r: CustomRecipe = {
        id: `custom-${Date.now().toString(36)}`,
        title: t,
        steps: newSteps,
        createdAt: Date.now(),
      };
      const next = [r, ...recipes()];
      setRecipes(next);
      persist(next);
      toast(`Saved "${t}" — ${r.steps.length} steps`, "success");
    }
    function updateRecipe(id: string, title: string, updatedSteps: RecStep[]): void {
      const next = recipes().map((r) =>
        r.id === id ? { ...r, title: title.trim() || r.title, steps: updatedSteps } : r,
      );
      setRecipes(next);
      persist(next);
      toast("Recipe updated", "success");
    }
    function forkRecipe(meta: { title: string; description?: string }): void {
      const base = (meta.title ?? "").trim() || "Recipe";
      const r: CustomRecipe = {
        id: `custom-${Date.now().toString(36)}`,
        title: `${base} (copy)`,
        steps: [],
        createdAt: Date.now(),
      };
      const next = [r, ...recipes()];
      setRecipes(next);
      persist(next);
      setSelectedRecipeId(r.id);
      toast(`Forked "${base}" — add steps via Interact mode or the editor`, "success");
    }

    function deleteRecipe(id: string): void {
      const next = recipes().filter((r) => r.id !== id);
      setRecipes(next);
      persist(next);
    }

    async function runRecipe(r: CustomRecipe): Promise<void> {
      if (replaying()) {
        toast("Already replaying — wait for it to finish", "warning");
        return;
      }
      if (server.health() !== "online") {
        toast("Server offline — can't replay", "warning");
        return;
      }
      setReplaying(true);
      server.setPanelTab("steps");
      try {
        for (const step of r.steps) {
          await server.interactStep(step, describeStep(step));
          await sleep(900);
        }
        toast(`Replayed "${r.title}"`, "success");
      } finally {
        setReplaying(false);
      }
    }

    return {
      interacting,
      setInteracting,
      recording,
      setRecording,
      level,
      setLevel,
      steps,
      recipes,
      selectedRecipeId,
      setSelectedRecipeId,
      selectedRecipe,
      replaying,
      handleTap,
      recordStep,
      clearSteps,
      removeStep,
      saveRecipe,
      deleteRecipe,
      runRecipe,
      saveRecipeFromSteps,
      updateRecipe,
      forkRecipe,
    };
  },
});
