import { createSignal, createEffect, on, onCleanup, onMount } from "solid-js";
import { createSimpleContext } from "@relay/ui/context/helper";
import { useServer, type RecipeInfo, type RecipeParameter, type RecipeStep } from "./server";
import { stepValid } from "../lib/step-sentence";
import { collapseUnchangedFlow, expandFlowToEditableSteps } from "../lib/run-gates";
import { createStepId, ensureStepId } from "../lib/step-identity";
import { toast } from "./toast";

export type SaveState = "saved" | "saving" | "invalid";

type DraftSnapshot = {
  title: string;
  description: string;
  parameters: RecipeParameter[];
  steps: RecipeStep[];
  expandedFromFlow: string | null;
};

type DraftHistoryEntry = {
  before: DraftSnapshot;
  after: DraftSnapshot;
  key?: string;
  at: number;
};

const HISTORY_LIMIT = 100;
const HISTORY_COALESCE_MS = 750;

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
    const [historyDepth, setHistoryDepth] = createSignal({ undo: 0, redo: 0 });
    /** Durable checkpoints are kept by the recipe store, not just this tab's
     * undo stack. It means an accidental edit can be recovered after reload,
     * restart, or hand-off to another person. */
    const [savedHistory, setSavedHistory] = createSignal<RecipeInfo[]>([]);
    const [historyLoading, setHistoryLoading] = createSignal(false);

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
    const draftCache = new Map<
      string,
      {
        title: string;
        description: string;
        parameters: RecipeParameter[];
        steps: RecipeStep[];
        source: "custom" | "builtin" | null;
        expandedFromFlow: string | null;
        dirty: boolean;
      }
    >();

    /** Original packaged flow id when draft rows were expanded from planned[]. */
    let expandedFromFlow: string | null = null;
    let undoStack: DraftHistoryEntry[] = [];
    let redoStack: DraftHistoryEntry[] = [];

    function snapshot(): DraftSnapshot {
      return {
        title: title(),
        description: description(),
        parameters: structuredClone(parameters()),
        steps: structuredClone(steps()),
        expandedFromFlow,
      };
    }

    function restoreSnapshot(next: DraftSnapshot): void {
      setTitleState(next.title);
      setDescriptionState(next.description);
      setParametersState(structuredClone(next.parameters));
      setStepsState(structuredClone(next.steps));
      expandedFromFlow = next.expandedFromFlow;
      setExpandedStep(null);
    }

    function syncHistoryDepth(): void {
      setHistoryDepth({ undo: undoStack.length, redo: redoStack.length });
    }

    function clearHistory(): void {
      undoStack = [];
      redoStack = [];
      syncHistoryDepth();
    }

    async function refreshSavedHistory(id = currentId): Promise<void> {
      if (!id) {
        setSavedHistory([]);
        return;
      }
      setHistoryLoading(true);
      try {
        const entries = await server.loadRecipeHistory(id);
        if (currentId === id) setSavedHistory(entries);
      } finally {
        if (currentId === id) setHistoryLoading(false);
      }
    }

    function snapshotsMatch(a: DraftSnapshot, b: DraftSnapshot): boolean {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function editDraft(change: () => void, key?: string): void {
      const before = snapshot();
      change();
      const after = snapshot();
      if (snapshotsMatch(before, after)) return;

      const at = Date.now();
      const previous = undoStack.at(-1);
      if (key && previous?.key === key && at - previous.at < HISTORY_COALESCE_MS) {
        previous.after = after;
        previous.at = at;
      } else {
        undoStack.push({ before, after, key, at });
        if (undoStack.length > HISTORY_LIMIT) undoStack = undoStack.slice(-HISTORY_LIMIT);
      }
      redoStack = [];
      syncHistoryDepth();
      scheduleSave();
    }

    function preserveStepMetadata(current: RecipeStep | undefined, next: RecipeStep): RecipeStep {
      const group =
        "group" in next ? next.group : current && "group" in current ? current.group : undefined;
      const evidence =
        "evidence" in next
          ? next.evidence
          : current && "evidence" in current
            ? current.evidence
            : undefined;
      const note =
        "note" in next ? next.note : current && "note" in current ? current.note : undefined;
      return {
        ...next,
        id: next.id ?? current?.id ?? createStepId(),
        ...(group ? { group } : {}),
        ...(evidence ? { evidence } : {}),
        ...(note ? { note } : {}),
      };
    }

    function seedFrom(r: RecipeInfo | null): void {
      // Selection can change from the library, suites, command palette, or a
      // completed save. Start the previous valid save before replacing the
      // signals it reads so rapid navigation never discards the last edit.
      if (dirty && currentId && currentId !== r?.id) {
        draftCache.set(currentId, {
          title: title(),
          description: description(),
          parameters: parameters().map((parameter) => ({ ...parameter })),
          steps: steps().map((step) => structuredClone(step)),
          source: source(),
          expandedFromFlow,
          dirty: true,
        });
        if (invalidCount() === 0) void flush();
      }
      currentId = r?.id ?? null;
      void refreshSavedHistory(currentId);
      const cached = r ? draftCache.get(r.id) : undefined;
      if (cached) {
        setSource(cached.source);
        setTitleState(cached.title);
        setDescriptionState(cached.description);
        setParametersState(cached.parameters.map((parameter) => ({ ...parameter })));
        setStepsState(cached.steps.map((step) => ensureStepId(structuredClone(step))));
        setExpandedStep(null);
        expandedFromFlow = cached.expandedFromFlow;
        clearHistory();
        dirty = cached.dirty;
        setSaveState(invalidCount() > 0 ? "invalid" : "saving");
        clearTimeout(saveTimer);
        if (invalidCount() === 0) saveTimer = setTimeout(() => void flush(), 0);
        return;
      }
      setSource(r?.source ?? null);
      setTitleState(r?.title ?? "");
      setDescriptionState(r?.description ?? "");
      setParametersState(r?.parameters?.map((parameter) => ({ ...parameter })) ?? []);
      setExpandedStep(null);
      // Clear back-link unless this seed is the fork we just created.
      if (!r || skipReseedFor !== r.id) setForkedFrom(null);
      const raw = r?.steps ? r.steps.map((s) => ensureStepId(structuredClone(s))) : [];
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
          setStepsState(expanded.map(ensureStepId));
        } else {
          setStepsState(raw);
        }
      } else {
        setStepsState([]);
      }
      clearHistory();
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
        title: title().trim() || "Untitled journey",
        description: description().trim() || undefined,
        parameters: parameters(),
        steps: persistSteps,
      };

      const overridingPackaged = source() === "builtin";
      const saved = await server.saveRecipeRemote({ id, ...body });

      if (saved) draftCache.delete(id);

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
        void refreshSavedHistory(id);
      } else {
        // Edits landed mid-save — go around again (now targeting the copy).
        scheduleSave();
      }
    }

    onMount(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (!((event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase()))) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        if (event.key.toLowerCase() === "y" || event.shiftKey) redo();
        else undo();
      };
      window.addEventListener("keydown", onKeyDown);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    });

    onCleanup(() => {
      if (dirty && invalidCount() === 0) void flush();
      clearTimeout(saveTimer);
    });

    function setTitle(v: string): void {
      editDraft(() => setTitleState(v), "title");
    }
    function setDescription(v: string): void {
      editDraft(() => setDescriptionState(v), "description");
    }
    function setParameters(next: RecipeParameter[]): void {
      editDraft(() => setParametersState(structuredClone(next)), "parameters");
    }
    function insertStep(index: number, step: RecipeStep): void {
      editDraft(() =>
        setStepsState((s) => [
          ...s.slice(0, index),
          ensureStepId(structuredClone(step)),
          ...s.slice(index),
        ]),
      );
    }
    function updateStep(index: number, next: RecipeStep): void {
      const current = steps()[index];
      const coalesceKey =
        current && current.kind === next.kind
          ? `step:${current.id ?? index}:${current.kind}`
          : undefined;
      editDraft(
        () =>
          setStepsState((s) =>
            s.map((step, position) =>
              position === index ? preserveStepMetadata(step, structuredClone(next)) : step,
            ),
          ),
        coalesceKey,
      );
    }
    function removeStep(index: number): void {
      editDraft(() => setStepsState((s) => s.filter((_, position) => position !== index)));
    }
    function duplicateStep(index: number): void {
      editDraft(() =>
        setStepsState((s) => {
          const target = s[index];
          if (!target) return s;
          return [
            ...s.slice(0, index + 1),
            { ...structuredClone(target), id: createStepId() },
            ...s.slice(index + 1),
          ];
        }),
      );
    }
    function moveStep(index: number, dir: -1 | 1): void {
      editDraft(() =>
        setStepsState((s) => {
          const j = index + dir;
          if (j < 0 || j >= s.length) return s;
          const next = [...s];
          const tmp = next[index]!;
          next[index] = next[j]!;
          next[j] = tmp;
          return next;
        }),
      );
    }

    function moveStepTo(from: number, to: number): void {
      if (from === to) return;
      editDraft(() =>
        setStepsState((steps) => {
          if (from < 0 || from >= steps.length || to < 0 || to >= steps.length) return steps;
          const next = [...steps];
          const [step] = next.splice(from, 1);
          if (!step) return steps;
          next.splice(to, 0, step);
          return next;
        }),
      );
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
      const recorded = extra.map((step) => ensureStepId(structuredClone(step)));
      editDraft(() => setStepsState((s) => [...s, ...recorded]));
      flash(recorded);
    }

    /** Rename one task boundary without touching the runnable action payloads. */
    function renameGroup(from: string, to: string): void {
      const next = to.trim();
      if (!from || !next || from === next) return;
      editDraft(() =>
        setStepsState((items) =>
          items.map((step) => (step.group === from ? { ...step, group: next } : step)),
        ),
      );
    }

    function undo(): void {
      const entry = undoStack.pop();
      if (!entry) return;
      restoreSnapshot(entry.before);
      redoStack.push(entry);
      syncHistoryDepth();
      scheduleSave();
    }

    function redo(): void {
      const entry = redoStack.pop();
      if (!entry) return;
      restoreSnapshot(entry.after);
      undoStack.push(entry);
      syncHistoryDepth();
      scheduleSave();
    }

    /** Restore is intentionally a normal save: the current state itself is
     * checkpointed first, so recovery is reversible rather than destructive. */
    async function restoreSavedHistory(updatedAt: number): Promise<void> {
      const id = currentId;
      if (!id) return;
      setHistoryLoading(true);
      try {
        const restored = await server.restoreRecipeVersion(id, updatedAt);
        if (currentId !== id) return;
        draftCache.delete(id);
        skipReseedFor = id;
        seedFrom(restored);
        server.setSelectedRecipeId(id);
        toast("Restored a previous version", "success");
        await refreshSavedHistory(id);
      } catch {
        toast("Couldn’t restore that version", "error");
      } finally {
        if (currentId === id) setHistoryLoading(false);
      }
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
      canUndo: () => historyDepth().undo > 0,
      canRedo: () => historyDepth().redo > 0,
      savedHistory,
      historyLoading,
      refreshSavedHistory,
      restoreSavedHistory,
      undo,
      redo,
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
      moveStepTo,
      appendSteps,
      renameGroup,
      ensureRecordingDraft,
    };
  },
});
