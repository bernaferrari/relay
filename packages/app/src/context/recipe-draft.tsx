import { createSignal, createEffect, on, onCleanup } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import { useServer, type RecipeInfo, type RecipeParameter, type RecipeStep } from "./server";
import { stepValid } from "../lib/step-sentence";
import { collapseUnchangedFlow, expandFlowToEditableSteps } from "../lib/run-gates";
import { toast } from "./toast";

export type SaveState = "saved" | "saving" | "invalid";

/**
 * The run-pane's step list IS the test editor (no modal). This context owns a
 * local draft (title/description/steps) for whichever recipe is selected —
 * builtin or custom — autosaving 600ms after the last edit.
 *
 * Packaged defaults are editable in place. The server stores an override under
 * the same id, so the UI never exposes a protected-template exception.
 *
 * The draft reseeds only when `selectedRecipeId` changes (not on background
 * polls), so mid-edit typing survives refreshes and our own auto-fork.
 */
export const { use: useRecipeDraft, provider: RecipeDraftProvider } = createSimpleContext({
  name: "RecipeDraft",
  gate: false,
  init: () => {
    const server = useServer();

    const [title, setTitleState] = createSignal("");
    const [description, setDescriptionState] = createSignal("");
    const [parameters, setParametersState] = createSignal<RecipeParameter[]>([]);
    const [steps, setStepsState] = createSignal<RecipeStep[]>([]);
    const [saveState, setSaveState] = createSignal<SaveState>("saved");
    const [source, setSource] = createSignal<"custom" | "builtin" | null>(null);
    const [flashSteps, setFlashSteps] = createSignal<Set<RecipeStep>>(new Set());
    /** Which step row is expanded in the editor — drives soft-invalid chrome. */
    const [expandedStep, setExpandedStep] = createSignal<number | null>(null);
    /** When we auto-forked a library test, where to go “back”. */
    const [forkedFrom, setForkedFrom] = createSignal<{ id: string; title: string } | null>(null);

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

    /** Original packaged flow id when draft rows were expanded from planned[]. */
    let expandedFromFlow: string | null = null;

    function seedFrom(r: RecipeInfo | null): void {
      currentId = r?.id ?? null;
      setSource(r?.source ?? null);
      setTitleState(r?.title ?? "");
      setDescriptionState(r?.description ?? "");
      setParametersState(r?.parameters?.map((parameter) => ({ ...parameter })) ?? []);
      setExpandedStep(null);
      // Clear back-link unless this seed is the fork we just created.
      if (!r || skipReseedFor !== r.id) setForkedFrom(null);
      const raw = r?.steps ? r.steps.map((s) => ({ ...s })) : [];
      expandedFromFlow = null;
      // Library tests are one opaque flow step — expand planned titles into the
      // same editable list as custom tests (nothing special about defaults).
      if (r) {
        const flowId =
          raw.length === 1 && raw[0]?.kind === "flow" && raw[0].flow
            ? raw[0].flow
            : r.source === "builtin"
              ? r.id
              : null;
        const planned = flowId ? server.actions().find((a) => a.id === flowId)?.planned : undefined;
        const expanded = expandFlowToEditableSteps({
          steps: raw,
          recipeId: r.id,
          source: r.source,
          planned,
        });
        if (expanded && flowId) {
          expandedFromFlow = flowId;
          setStepsState(expanded);
        } else {
          setStepsState(raw);
        }
      } else {
        setStepsState([]);
      }
      dirty = false;
      setSaveState("saved");
      clearTimeout(saveTimer);
    }

    createEffect(
      on(
        // Also re-run when actions load so planned[] is available to expand.
        () =>
          [server.selectedRecipeId(), server.actions().length, server.recipes().length] as const,
        ([id]) => {
          if (id && skipReseedFor === id) {
            skipReseedFor = null;
            return;
          }
          // Don't clobber an in-progress edit when only actions[] length changed.
          if (dirty && id && currentId === id) return;
          seedFrom(server.recipes().find((x) => x.id === id) ?? null);
        },
      ),
    );

    const parameterIssue = () => {
      const names = new Set<string>();
      for (const parameter of parameters()) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(parameter.name)) {
          return "Each flow input needs a variable-style name.";
        }
        if (names.has(parameter.name)) return `Duplicate flow input: ${parameter.name}`;
        names.add(parameter.name);
      }
      return null;
    };
    const invalidCount = () =>
      steps().filter((s) => !stepValid(s)).length + (parameterIssue() ? 1 : 0);

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

      // If the user only renamed / saved without reworking the expanded plan,
      // persist as a single flow so Run still executes the real packaged action.
      let persistSteps: RecipeStep[] = steps();
      if (expandedFromFlow) {
        const planned = server.actions().find((a) => a.id === expandedFromFlow)?.planned;
        const collapsed = collapseUnchangedFlow({
          steps: persistSteps,
          flowId: expandedFromFlow,
          planned,
        });
        if (collapsed) persistSteps = collapsed;
        else expandedFromFlow = null; // user reworked the plan — free-form from here
      }

      const body = {
        title: title().trim() || "Untitled test",
        description: description().trim() || undefined,
        parameters: parameters(),
        steps: persistSteps,
      };

      const overridingPackaged = source() === "builtin";
      const saved = await server.saveRecipeRemote({ id, ...body });

      // The selection (or a newer save) moved on while this was in flight.
      if (currentId !== id || mySeq !== saveSeq) return;
      if (!saved) {
        setSaveState("invalid");
        return;
      }
      if (overridingPackaged) {
        setSource("custom");
        toast("Test is now customized", "info");
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
    function setParameters(next: RecipeParameter[]): void {
      setParametersState(next);
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

    /**
     * Explicit “Edit” for packaged tests — fork to custom while keeping the
     * same flow body (and thus the same planned step titles in the UI).
     * Title stays clean (no forced “ (copy)” suffix from us).
     */
    function openOriginal(): void {
      const origin = forkedFrom();
      if (!origin) return;
      setForkedFrom(null);
      server.setSelectedRecipeId(origin.id);
    }

    return {
      title,
      description,
      parameters,
      steps,
      saveState,
      source,
      invalidCount,
      parameterIssue,
      flashSteps,
      expandedStep,
      setExpandedStep,
      forkedFrom,
      openOriginal,
      setTitle,
      setDescription,
      setParameters,
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
