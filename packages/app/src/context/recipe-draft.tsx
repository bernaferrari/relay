import { createSignal, createEffect, on, onCleanup } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { useServer, type RecipeInfo, type RecipeStep } from "./server";
import { stepValid } from "../lib/step-sentence";
import { displayTitle } from "../lib/job";
import { toast } from "./toast";

export type SaveState = "saved" | "saving" | "invalid";

/**
 * The run-pane's step list IS the test editor (no modal). This context owns a
 * local draft (title/description/steps) for whichever recipe is selected —
 * builtin or custom — autosaving 600ms after the last edit. Manual row edits
 * and recorder appends flow through the same path, so "Saved / Saving… /
 * Fix N steps to save" always reflects the true state.
 *
 * Builtins are editable like everything else: the first edit silently
 * auto-forks the builtin into a custom copy (same title, no suffix), selects
 * it, and toasts "Now editing your copy of <title>". From the user's seat,
 * everything is simply editable, always.
 *
 * The draft reseeds only when `selectedRecipeId` changes (not on background
 * polls), so mid-edit typing and mid-recording appends survive refreshes —
 * including the refresh triggered by our own autosave and the selection
 * change triggered by our own auto-fork.
 */
export const { use: useRecipeDraft, provider: RecipeDraftProvider } = createSimpleContext({
  name: "RecipeDraft",
  gate: false,
  init: () => {
    const server = useServer();

    const [title, setTitleState] = createSignal("");
    const [description, setDescriptionState] = createSignal("");
    const [steps, setStepsState] = createSignal<RecipeStep[]>([]);
    const [saveState, setSaveState] = createSignal<SaveState>("saved");
    const [source, setSource] = createSignal<"custom" | "builtin" | null>(null);
    const [flashSteps, setFlashSteps] = createSignal<Set<RecipeStep>>(new Set());

    let currentId: string | null = null;
    let dirty = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let saveSeq = 0;
    /** Bumped on every edit — a finished save only clears `dirty` when no
     *  edits landed while the request was in flight. */
    let editSeq = 0;
    /** Selection changes we caused ourselves (auto-fork) must not reseed the
     *  draft — the user may have kept editing while the fork was in flight. */
    let skipReseedFor: string | null = null;

    function seedFrom(r: RecipeInfo | null): void {
      currentId = r?.id ?? null;
      setSource(r?.source ?? null);
      setTitleState(r?.title ?? "");
      setDescriptionState(r?.description ?? "");
      setStepsState(r?.steps ? r.steps.map((s) => ({ ...s })) : []);
      dirty = false;
      setSaveState("saved");
      clearTimeout(saveTimer);
    }

    createEffect(
      on(server.selectedRecipeId, (id) => {
        if (id && skipReseedFor === id) {
          skipReseedFor = null;
          return;
        }
        seedFrom(server.recipes().find((x) => x.id === id) ?? null);
      }),
    );

    const invalidCount = () => steps().filter((s) => !stepValid(s)).length;

    function scheduleSave(): void {
      if (!currentId) return;
      dirty = true;
      editSeq++;
      setSaveState(invalidCount() > 0 ? "invalid" : "saving");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flush(), 600);
    }

    async function flush(): Promise<void> {
      const id = currentId;
      if (!id || !dirty) return;
      if (invalidCount() > 0) {
        setSaveState("invalid");
        return;
      }
      const mySeq = ++saveSeq;
      const myEdit = editSeq;
      setSaveState("saving");

      const body = {
        title: title().trim() || "Untitled test",
        description: description().trim() || undefined,
        steps: steps(),
      };

      // Editing a builtin? Silently fork it into the user's own copy first —
      // same title, no "(copy)" suffix — then keep editing that.
      const forking = source() === "builtin";
      const saved = await server.saveRecipeRemote(forking ? body : { id, ...body });

      // The selection (or a newer save) moved on while this was in flight.
      if (currentId !== id || mySeq !== saveSeq) return;
      if (!saved) {
        setSaveState("invalid");
        return;
      }
      if (forking) {
        currentId = saved.id;
        setSource("custom");
        skipReseedFor = saved.id;
        server.setSelectedRecipeId(saved.id);
        toast(`Now editing your copy of ${displayTitle(saved.title)}`, "info");
      }
      if (editSeq === myEdit) {
        dirty = false;
        setSaveState("saved");
      } else {
        // Edits landed mid-save — go around again (now targeting the copy).
        scheduleSave();
      }
    }

    onCleanup(() => clearTimeout(saveTimer));

    function setTitle(v: string): void {
      setTitleState(v);
      scheduleSave();
    }
    function setDescription(v: string): void {
      setDescriptionState(v);
      scheduleSave();
    }
    function insertStep(index: number, step: RecipeStep): void {
      setStepsState((s) => [...s.slice(0, index), step, ...s.slice(index)]);
      scheduleSave();
    }
    function updateStep(index: number, next: RecipeStep): void {
      setStepsState((s) => s.map((st, i) => (i === index ? next : st)));
      scheduleSave();
    }
    function removeStep(index: number): void {
      setStepsState((s) => s.filter((_, i) => i !== index));
      scheduleSave();
    }
    function duplicateStep(index: number): void {
      setStepsState((s) => {
        const target = s[index];
        if (!target) return s;
        return [...s.slice(0, index + 1), { ...target }, ...s.slice(index + 1)];
      });
      scheduleSave();
    }
    function moveStep(index: number, dir: -1 | 1): void {
      setStepsState((s) => {
        const j = index + dir;
        if (j < 0 || j >= s.length) return s;
        const next = [...s];
        const tmp = next[index]!;
        next[index] = next[j]!;
        next[j] = tmp;
        return next;
      });
      scheduleSave();
    }

    /** Flash-highlight freshly recorder-appended steps for ~1.4s. */
    function flash(extra: RecipeStep[]): void {
      setFlashSteps((f) => {
        const next = new Set(f);
        for (const s of extra) next.add(s);
        return next;
      });
      setTimeout(() => {
        setFlashSteps((f) => {
          const next = new Set(f);
          for (const s of extra) next.delete(s);
          return next;
        });
      }, 1400);
    }

    /** Recorder append path: steps land at the end of whatever's selected
     *  (a builtin auto-forks on save like any other edit). */
    function appendSteps(extra: RecipeStep[]): void {
      if (!currentId || extra.length === 0) return;
      setStepsState((s) => [...s, ...extra]);
      flash(extra);
      scheduleSave();
    }

    /**
     * Recording needs somewhere to land: any selected recipe works (builtins
     * auto-fork on the first appended step). Only when NOTHING is selected do
     * we create a fresh "Recorded test <n>" and select it.
     */
    async function ensureRecordingDraft(makeTitle: () => string): Promise<string | null> {
      if (currentId) return currentId;
      const saved = await server.saveRecipeRemote({ title: makeTitle(), steps: [] });
      if (!saved) return null;
      seedFrom(saved);
      server.setSelectedRecipeId(saved.id);
      return saved.id;
    }

    return {
      title,
      description,
      steps,
      saveState,
      source,
      invalidCount,
      flashSteps,
      setTitle,
      setDescription,
      insertStep,
      updateStep,
      removeStep,
      duplicateStep,
      moveStep,
      appendSteps,
      ensureRecordingDraft,
    };
  },
});
