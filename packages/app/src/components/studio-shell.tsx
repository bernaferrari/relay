import { For, Index, Show, createEffect, createMemo, createSignal, lazy } from "solid-js";
import type { MatrixExpansion } from "@relay/protocol";
import { useServer, type RecipeParameter, type RecipeInfo } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { DeviceStage } from "./stage";
import { RecipeStepsEditor } from "./step-list";
import { JourneyWorkspace } from "./journey-workspace";
import { JourneyInspector, JourneyOutline } from "./journey-chrome";
import { DevicePicker } from "./device-picker";
import { LibraryPanel } from "./studio-library";
import { AgentTestComposer } from "./agent-test-composer";
import { NewTestDialog, TestWelcome } from "./test-onboarding";
import { RunsWorkspace } from "./runs-workspace";
import { TestWorkbench } from "./test-workbench";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";
import { displayTitle } from "../lib/job";
import { toast } from "../context/toast";
import { matrixRunPreview } from "../lib/matrix-presentation";
import {
  modalPanel,
  modalScrim,
  eyebrow,
  productPrimary,
  productSecondary,
  productIconButton,
  productIconButtonDanger,
  tabUnderline,
  tabUnderlineActive,
  dividerY,
} from "../lib/ui";
import {
  shellRoot,
  shellRootLibraryVar,
  shellRail,
  shellMark,
  shellRailNav,
  shellRailItem,
  shellRailItemActive,
  shellMain,
  shellTopbar,
  shellTopbarContext,
  shellTopbarActions,
  shellBreadcrumb,
  shellRecord,
  shellRecordDot,
  shellCapture,
  shellCaptureActive,
  shellStudio,
  shellStudioBar,
  shellCount,
  shellSaveState,
  shellStudioBody,
  shellStudioBodyJourney,
  shellStageWrap,
  shellSteps,
  shellStepsHead,
  shellStepsBody,
  shellDragStrip,
} from "../lib/shell-layout";
import { planTestPrompt } from "../lib/natural-language-plan";
import { testRunBlocker } from "../lib/test-run-readiness";
import type { SettingsSection } from "../pages/settings";

type ProductArea = "tests" | "runs" | "map" | "data";
type StudioView = "workbench" | "map" | "settings";

const DataWorkspace = lazy(() =>
  import("./workspaces/data-workspace").then((module) => ({ default: module.DataWorkspace })),
);
const MapsWorkspace = lazy(() =>
  import("./workspaces/maps-workspace").then((module) => ({ default: module.MapsWorkspace })),
);

const AREA_ITEMS: { id: ProductArea; label: string; icon: IconName }[] = [
  { id: "tests", label: "Tests", icon: "grid" },
  { id: "runs", label: "Runs", icon: "wave" },
  { id: "map", label: "Atlas", icon: "move" },
];

export function StudioShell(props: { onOpenSettings: (section?: SettingsSection) => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const [area, setArea] = createSignal<ProductArea>(
    new URLSearchParams(window.location.search).has("run") ? "runs" : "tests",
  );
  // A test always opens on one continuous workbench: ordered steps, the real
  // device, and the selected step's properties. Map and source-level settings
  // are deliberate power-user destinations, never competing default tabs.
  const [studioView, setStudioView] = createSignal<StudioView>("workbench");
  const [query, setQuery] = createSignal("");
  const [libraryOpen, setLibraryOpen] = createSignal(true);
  const [studioActionsOpen, setStudioActionsOpen] = createSignal(false);
  const [newTestOpen, setNewTestOpen] = createSignal(false);
  const [importReview, setImportReview] = createSignal<{
    yaml: string;
    recipe: RecipeInfo;
    exists: boolean;
    canonicalYaml: string;
  } | null>(null);

  const selected = createMemo(() => server.selectedRecipe());
  let previousReadyRecipeId: string | null = null;
  createEffect(() => {
    const readyId = selected()?.id ?? null;
    if (readyId && readyId !== previousReadyRecipeId) setLibraryOpen(false);
    if (!server.selectedRecipeId()) setLibraryOpen(true);
    previousReadyRecipeId = readyId;
  });
  // Every test opens on the device-first workbench. Remembering an advanced
  // surface across tests makes a new selection feel broken or unpredictable.
  let defaultedViewForId: string | null = null;
  createEffect(() => {
    const id = server.selectedRecipeId();
    if (!id) {
      defaultedViewForId = null;
      return;
    }
    if (defaultedViewForId === id) return;
    const recipe = server.recipes().find((item) => item.id === id);
    if (!recipe) return;
    setStudioView("workbench");
    defaultedViewForId = id;
  });
  const recordBlockedReason = () => {
    if (server.health() !== "online") return "Start the device server before recording";
    if (server.isEmptyDevices() || !server.selectedDevice()) {
      return "Connect or select a device before recording";
    }
    const target = server.devices().find((device) => device.serial === server.selectedDevice());
    if (!target || target.booted === false) return "Start or connect this target before recording";
    return "";
  };
  const testBlockedReason = () =>
    testRunBlocker({
      health: server.health(),
      selectedDevice: server.selectedDevice(),
      devices: server.devices(),
      stepCount: draft.steps().length,
      invalidCount: draft.invalidCount(),
    });
  const runSelectedTest = () => {
    const blocker = testBlockedReason();
    if (blocker) {
      toast(blocker, "warning");
      if (!server.selectedDevice() || server.isEmptyDevices()) props.onOpenSettings("targets");
      return;
    }
    const recipe = selected();
    if (recipe) void server.runRecipeRemote(recipe.id);
  };
  const filteredRecipes = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const rows = [...server.recipes()];
    rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return needle
      ? rows.filter((recipe) =>
          `${recipe.title} ${recipe.description ?? ""}`.toLowerCase().includes(needle),
        )
      : rows;
  });
  async function createTest(record = false, description = ""): Promise<void> {
    const plannedSteps = description.trim()
      ? planTestPrompt(description).map((instruction) => instruction.step)
      : [];
    const saved = await server.saveRecipeRemote({
      title: description
        ? titleFromPrompt(description, server.recipes())
        : nextUntitledTitle(server.recipes()),
      description,
      steps: plannedSteps,
    });
    if (!saved) return;
    server.setSelectedRecipeId(saved.id);
    setNewTestOpen(false);
    setArea("tests");
    setStudioView("workbench");
    if (record) recorder.enterRecordMode();
  }

  async function importTestYaml(yaml: string): Promise<void> {
    try {
      const preview = await server.previewRecipeYaml(yaml);
      setImportReview({ yaml, ...preview });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function confirmImport(conflict: "replace" | "copy"): Promise<void> {
    const review = importReview();
    if (!review) return;
    const saved = await server.importRecipeYaml(review.yaml, review.exists ? conflict : "reject");
    if (!saved) return;
    setImportReview(null);
    setArea("tests");
    // Default view is decided per-test by the effect above (content vs. empty).
  }

  async function duplicateSelected(): Promise<void> {
    const recipe = selected();
    if (!recipe) return;
    const saved = await server.saveRecipeRemote({
      title: `${displayTitle(recipe.title)} copy`,
      description: recipe.description,
      steps: draft.steps(),
    });
    if (saved) server.setSelectedRecipeId(saved.id);
  }

  async function deleteSelected(): Promise<void> {
    const recipe = selected();
    if (!recipe) return;
    if (!window.confirm(`Delete “${displayTitle(recipe.title)}”? This cannot be undone.`)) return;
    await server.deleteRecipeRemote(recipe.id);
  }

  function openRecipe(id: string): void {
    server.setSelectedRecipeId(id);
    setArea("tests");
    // Default view is decided per-test by the effect above (content vs. empty).
    // Opening a test transitions from the file browser to the canvas, like
    // Figma. The library stays one click away in the top-left toolbar.
    setLibraryOpen(false);
  }

  return (
    <div
      class={shellRoot}
      style={shellRootLibraryVar(area() === "tests" && libraryOpen())}
      data-selected-recipe-id={server.selectedRecipeId() ?? ""}
    >
      <div class={shellDragStrip} aria-hidden="true" />
      <aside class={shellRail} aria-label="Product navigation">
        <button
          class={shellMark}
          type="button"
          aria-label="Relay home"
          onClick={() => setArea("tests")}
        >
          <span
            class="absolute inset-[10px_8px] -rotate-[32deg] rounded-full border-[1.5px] border-white/80"
            aria-hidden="true"
          />
          <span class="absolute top-2 right-2 size-1.5 rounded-full bg-white" aria-hidden="true" />
        </button>
        <nav class={shellRailNav}>
          <For each={AREA_ITEMS}>
            {(item) => {
              const active = () => area() === item.id;
              return (
                <button
                  type="button"
                  class={cn(shellRailItem, active() && shellRailItemActive)}
                  aria-current={active() ? "page" : undefined}
                  onClick={() => {
                    const wasActive = active();
                    setArea(item.id);
                    if (item.id === "tests") {
                      if (wasActive) setLibraryOpen((open) => !open);
                      else setLibraryOpen(!selected());
                    } else setLibraryOpen(false);
                  }}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </button>
              );
            }}
          </For>
        </nav>
        <div class="flex w-full flex-col items-center">
          <button
            type="button"
            class={cn(shellRailItem, "min-h-[52px]")}
            aria-label="Open settings"
            onClick={() => props.onOpenSettings()}
          >
            <Icon name="sliders" size={18} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <Show when={area() === "tests"}>
        <LibraryPanel
          open={libraryOpen()}
          query={query()}
          onQuery={setQuery}
          items={filteredRecipes()}
          selectedId={server.selectedRecipeId()}
          onSelect={openRecipe}
          onCreate={() => setNewTestOpen(true)}
          onImport={importTestYaml}
        />
      </Show>

      <main class={shellMain}>
        <header class={shellTopbar}>
          <div class={shellTopbarContext}>
            <Show when={area() === "tests"}>
              <button
                type="button"
                class={productIconButton}
                aria-label={libraryOpen() ? "Hide test library" : "Show test library"}
                onClick={() => setLibraryOpen((value) => !value)}
              >
                <Icon name="panel-left" size={17} />
              </button>
            </Show>
            <div class={shellBreadcrumb}>
              <strong>
                {area() === "runs"
                  ? "Run history"
                  : area() === "map"
                    ? "Atlas"
                    : area() === "data"
                      ? "Test data"
                      : "Tests"}
              </strong>
              <Show when={area() === "tests" && selected()}>
                <Icon name="chevron-right" size={13} />
                <span class="max-w-[min(32vw,360px)] truncate text-[var(--relay-text-secondary)]">
                  {displayTitle(selected()!.title)}
                </span>
              </Show>
            </div>
          </div>
          <div class={shellTopbarActions}>
            <Show when={area() === "tests"}>
              <DevicePicker onManageTargets={() => props.onOpenSettings("targets")} />
            </Show>
            <Show when={area() === "tests" && selected() && studioView() === "workbench"}>
              <button
                type="button"
                class={cn(shellCapture, recorder.recording() && shellCaptureActive)}
                data-blocked={
                  !recorder.recording() && Boolean(recordBlockedReason()) ? "" : undefined
                }
                data-tip={
                  recorder.recording()
                    ? "Stop recording"
                    : recordBlockedReason() || "Record device interactions"
                }
                aria-label={
                  recorder.recording() ? "Stop recording" : recordBlockedReason() || "Record test"
                }
                onClick={() => {
                  if (recorder.recording()) {
                    void recorder.stopRecording();
                    return;
                  }
                  if (recordBlockedReason()) {
                    toast(recordBlockedReason(), "warning");
                    props.onOpenSettings("targets");
                    return;
                  }
                  if (server.health() !== "online") {
                    toast("Start the device server before recording.", "warning");
                    return;
                  }
                  if (server.isEmptyDevices() || !server.selectedDevice()) {
                    toast("Connect or select a device before recording.", "warning");
                    return;
                  }
                  if (!selected()) void createTest(true);
                  else {
                    setStudioView("workbench");
                    recorder.enterRecordMode();
                  }
                }}
              >
                <span
                  class={cn(
                    shellRecordDot,
                    recorder.recording() ? "bg-current" : "bg-[var(--relay-red)]",
                  )}
                  aria-hidden="true"
                />
                {recorder.recording() ? "Stop" : "Record"}
              </button>
              <button
                type="button"
                class={cn(productPrimary, "min-h-9 px-3.5 text-[12px]")}
                data-tip={testBlockedReason() || "Run this test"}
                onClick={runSelectedTest}
              >
                <Icon name="play" size={13} /> Run
              </button>
            </Show>
          </div>
        </header>

        <Show when={area() === "tests"}>
          <section class={shellStudio}>
            <Show when={selected()}>
              <div class={shellStudioBar}>
                <Show
                  when={studioView() !== "settings"}
                  fallback={
                    <div class="flex min-w-0 items-center gap-2 px-1 text-[12px] text-[var(--relay-text-secondary)]">
                      <Icon name="sliders" size={14} />
                      <strong class="font-medium text-[var(--relay-text)]">Test settings</strong>
                      <button
                        type="button"
                        class="ml-1 rounded-md px-2 py-1 text-[11px] text-[var(--text-interactive-base)] hover:bg-[var(--relay-surface-raised)] active:scale-[0.97]"
                        onClick={() => setStudioView("workbench")}
                      >
                        Back to steps
                      </button>
                    </div>
                  }
                >
                  <div
                    class="flex items-center gap-0.5 rounded-lg bg-[var(--relay-bg)] p-0.5 shadow-[inset_0_0_0_1px_var(--relay-line)]"
                    role="tablist"
                    aria-label="Test view"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={studioView() === "workbench"}
                      class={cn(
                        "flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium text-[var(--relay-text-tertiary)] transition-[background-color,color,transform] duration-150 ease-out hover:text-[var(--relay-text)] active:scale-[0.98]",
                        studioView() === "workbench" &&
                          "bg-[var(--relay-surface-raised)] text-[var(--relay-text)] shadow-[inset_0_0_0_1px_var(--relay-line)]",
                      )}
                      onClick={() => setStudioView("workbench")}
                    >
                      <Icon name="grid" size={13} /> Steps
                      <span class={shellCount}>{draft.steps().length}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={studioView() === "map"}
                      class={cn(
                        "flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium text-[var(--relay-text-tertiary)] transition-[background-color,color,transform] duration-150 ease-out hover:text-[var(--relay-text)] active:scale-[0.98]",
                        studioView() === "map" &&
                          "bg-[var(--relay-surface-raised)] text-[var(--relay-text)] shadow-[inset_0_0_0_1px_var(--relay-line)]",
                      )}
                      onClick={() => setStudioView("map")}
                    >
                      <Icon name="move" size={13} /> Map
                    </button>
                  </div>
                </Show>
                <div class="relative flex items-center gap-2">
                  <Show
                    when={
                      selected() &&
                      (draft.saveState() === "saving" || draft.saveState() === "invalid")
                    }
                  >
                    <span class={shellSaveState}>
                      {draft.saveState() === "saving"
                        ? "Saving…"
                        : `${draft.invalidCount()} incomplete`}
                    </span>
                  </Show>
                  <Show when={selected()}>
                    <button
                      class={productIconButton}
                      type="button"
                      aria-label="More test options"
                      aria-expanded={studioActionsOpen()}
                      onClick={() => setStudioActionsOpen((open) => !open)}
                    >
                      <Icon name="more" size={16} />
                    </button>
                    <Show when={studioActionsOpen()}>
                      <div
                        class="ui-pop absolute top-[calc(100%+6px)] right-0 z-40 grid w-[200px] gap-0.5 rounded-[10px] border border-[var(--relay-line-strong)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--v2-elevation-overlay)]"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--relay-text-secondary)] hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)]"
                          onClick={() => {
                            setStudioActionsOpen(false);
                            setStudioView("settings");
                          }}
                        >
                          <Icon name="sliders" size={14} /> Inputs and YAML
                        </button>
                        <div class="my-0.5 h-px bg-[var(--relay-line)]" aria-hidden="true" />
                        <button
                          type="button"
                          role="menuitem"
                          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--relay-text-secondary)] hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)]"
                          onClick={() => {
                            setStudioActionsOpen(false);
                            void duplicateSelected();
                          }}
                        >
                          <Icon name="copy" size={14} /> Duplicate test
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--relay-red)] hover:bg-[var(--relay-surface-strong)]"
                          onClick={() => {
                            setStudioActionsOpen(false);
                            void deleteSelected();
                          }}
                        >
                          <Icon name="trash" size={14} /> Delete test
                        </button>
                      </div>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>
            <div class={studioView() === "settings" ? shellStudioBody : shellStudioBodyJourney}>
              <Show
                when={selected()}
                fallback={
                  <TestWelcome
                    onDescribe={(description) => void createTest(false, description)}
                    onRecord={() => void createTest(true)}
                    onOpenTargets={() => props.onOpenSettings("targets")}
                  />
                }
              >
                <Show when={studioView() === "workbench"}>
                  <TestWorkbench
                    onOpenMap={() => setStudioView("map")}
                    onOpenAdvanced={() => setStudioView("settings")}
                    onOpenTargets={() => props.onOpenSettings("targets")}
                  />
                </Show>
                <Show when={studioView() === "map"}>
                  <JourneyOutline />
                  <div class={cn(shellStageWrap, "flex-1")}>
                    <JourneyWorkspace
                      onLive={() => {
                        setStudioView("workbench");
                        setLibraryOpen(false);
                      }}
                    />
                  </div>
                  <Show when={draft.steps().length > 0}>
                    <JourneyInspector
                      onEdit={() => setStudioView("settings")}
                      onOpenTargets={() => props.onOpenSettings("matrices")}
                    />
                  </Show>
                </Show>
                <Show when={studioView() === "settings"}>
                  <div class={cn(shellStageWrap, "flex-1")}>
                    <DeviceStage
                      onExpandBoard={() => setStudioView("map")}
                      onOpenTargets={() => props.onOpenSettings("targets")}
                    />
                  </div>
                  <StepDocument
                    onOpenData={() => setArea("data")}
                    onOpenTargets={() => props.onOpenSettings("matrices")}
                  />
                </Show>
              </Show>
            </div>
          </section>
        </Show>

        <Show when={area() === "runs"}>
          <RunsWorkspace onOpenRecipe={openRecipe} onOpenTests={() => setArea("tests")} />
        </Show>
        <Show when={area() === "map"}>
          <MapsWorkspace onOpenRecipe={openRecipe} />
        </Show>
        <Show when={area() === "data"}>
          <DataWorkspace onConfigureProvider={props.onOpenSettings} />
        </Show>
      </main>
      <Show when={newTestOpen()}>
        <NewTestDialog
          onClose={() => setNewTestOpen(false)}
          onDescribe={(description) => void createTest(false, description)}
          onRecord={() => void createTest(true)}
        />
      </Show>
      <Show when={importReview()}>
        {(review) => (
          <div class={cn(modalScrim, "z-[120] flex items-center justify-center p-5")}>
            <section
              class={cn(modalPanel, "grid w-[min(100%,480px)] gap-0 overflow-hidden rounded-xl")}
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-review-title"
            >
              <header class="flex items-start justify-between gap-3 border-b border-[var(--relay-line)] px-4 py-3.5">
                <div>
                  <span class={eyebrow}>Relay YAML</span>
                  <h3
                    id="import-review-title"
                    class="mt-1 text-[16px] font-semibold text-[var(--relay-text)]"
                  >
                    {review().exists ? "This test already exists" : "Import this test?"}
                  </h3>
                </div>
                <button
                  type="button"
                  class={productIconButton}
                  aria-label="Close import review"
                  onClick={() => setImportReview(null)}
                >
                  <Icon name="x" size={14} />
                </button>
              </header>
              <div class="mx-4 mt-3.5 flex items-center gap-3 rounded-[10px] border border-[var(--relay-line)] bg-[var(--relay-surface-raised)] p-3">
                <span class="grid size-9 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--relay-green)_12%,transparent)] text-[var(--relay-green)]">
                  <Icon name="check" size={16} />
                </span>
                <div class="min-w-0">
                  <strong class="block text-[13px] text-[var(--relay-text)]">
                    {review().recipe.title}
                  </strong>
                  <small class="block text-[11px] text-[var(--relay-text-tertiary)]">
                    {review().recipe.id} · {review().recipe.steps.length} step
                    {review().recipe.steps.length === 1 ? "" : "s"} · schema valid
                  </small>
                </div>
              </div>
              <details class="mx-4 my-3 rounded-lg border border-[var(--relay-line)] bg-[var(--relay-bg)] px-3 py-2">
                <summary class="cursor-pointer text-[11px] text-[var(--relay-text-secondary)]">
                  Preview canonical YAML
                </summary>
                <pre class="mt-2 max-h-48 overflow-auto font-mono text-[11px]/[1.5] text-[var(--relay-text-tertiary)]">
                  {review().canonicalYaml}
                </pre>
              </details>
              <footer class="flex items-center justify-between gap-3 border-t border-[var(--relay-line)] px-4 py-3">
                <p class="m-0 max-w-[28ch] text-[11px]/[1.45] text-[var(--relay-text-tertiary)]">
                  {review().exists
                    ? "Replacing preserves the current definition in version history. Importing a copy creates a new test ID."
                    : "Relay will store the canonical definition in the tracked tests directory."}
                </p>
                <div class="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    class={productSecondary}
                    onClick={() => setImportReview(null)}
                  >
                    Cancel
                  </button>
                  <Show when={review().exists}>
                    <button
                      type="button"
                      class={productSecondary}
                      onClick={() => void confirmImport("copy")}
                    >
                      Import copy
                    </button>
                  </Show>
                  <button
                    type="button"
                    class={productPrimary}
                    onClick={() => void confirmImport("replace")}
                  >
                    {review().exists ? "Replace test" : "Import test"}
                  </button>
                </div>
              </footer>
            </section>
          </div>
        )}
      </Show>
    </div>
  );
}

function StepDocument(props: { onOpenData: () => void; onOpenTargets: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const [tab, setTab] = createSignal<"steps" | "inputs" | "yaml">("steps");
  const [runMenuOpen, setRunMenuOpen] = createSignal(false);
  const [matrixRepetitions, setMatrixRepetitions] = createSignal<1 | 3>(1);
  const [matrixExpansions, setMatrixExpansions] = createSignal<Record<string, MatrixExpansion>>({});
  const [matrixPreviewBusy, setMatrixPreviewBusy] = createSignal(false);
  const [maintenanceOpen, setMaintenanceOpen] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [history, setHistory] = createSignal<RecipeInfo[]>([]);
  const [yamlSource, setYamlSource] = createSignal<string | null>(null);
  const [yamlDraft, setYamlDraft] = createSignal("");
  const [yamlEditing, setYamlEditing] = createSignal(false);
  const [yamlSaving, setYamlSaving] = createSignal(false);
  const [yamlMessage, setYamlMessage] = createSignal<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [stability, setStability] = createSignal<
    import("../context/server").RecipeStability | null
  >(null);
  const selected = () => server.selectedRecipe();
  const canRun = () =>
    server.health() === "online" &&
    !server.isEmptyDevices() &&
    server.devices().find((device) => device.serial === server.selectedDevice())?.booted !==
      false &&
    draft.invalidCount() === 0 &&
    draft.steps().length > 0;
  const runBlockedReason = () =>
    testRunBlocker({
      health: server.health(),
      selectedDevice: server.selectedDevice(),
      devices: server.devices(),
      stepCount: draft.steps().length,
      invalidCount: draft.invalidCount(),
    });
  const matrixSize = () =>
    Math.max(5, ...server.projectVariables().value.map((variable) => variable.values?.length ?? 1));
  const activeSchedule = () =>
    server
      .schedules()
      .find(
        (schedule) =>
          schedule.recipeId === selected()?.id &&
          schedule.targetId === server.selectedDevice() &&
          schedule.enabled,
      );
  let yamlRequest = 0;
  createEffect(() => {
    const recipe = selected();
    const updatedAt = recipe?.updatedAt;
    if (tab() !== "yaml" || !recipe) return;
    const request = ++yamlRequest;
    setYamlSource(null);
    setYamlDraft("");
    setYamlEditing(false);
    setYamlMessage(null);
    void server.loadRecipeYaml(recipe.id).then((yaml) => {
      if (request === yamlRequest) {
        setYamlSource(yaml);
        setYamlDraft(yaml ?? "");
      }
    });
    void updatedAt;
  });
  const startYamlEdit = () => {
    setYamlDraft(yamlSource() ?? "");
    setYamlMessage(null);
    setYamlEditing(true);
  };
  const cancelYamlEdit = () => {
    setYamlDraft(yamlSource() ?? "");
    setYamlMessage(null);
    setYamlEditing(false);
  };
  const saveYaml = async () => {
    const recipe = selected();
    const source = yamlDraft().trim();
    if (!recipe || !source || yamlSaving()) return;
    setYamlSaving(true);
    setYamlMessage(null);
    try {
      const preview = await server.previewRecipeYaml(source);
      if (preview.recipe.id !== recipe.id) {
        throw new Error("The test id cannot change here. Duplicate the test to create a new id.");
      }
      const saved = await server.importRecipeYaml(source, "replace");
      if (!saved) throw new Error("Relay could not save this YAML.");
      setYamlSource(preview.canonicalYaml);
      setYamlDraft(preview.canonicalYaml);
      setYamlEditing(false);
      setYamlMessage({ tone: "success", text: "Saved and normalized." });
    } catch (error) {
      setYamlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setYamlSaving(false);
    }
  };
  const runTrials = (count: number) => {
    const recipe = selected();
    if (!recipe) return;
    setRunMenuOpen(false);
    void server.runRecipeRemote(recipe.id, count);
  };
  const attemptRun = (count: number) => {
    const blocker = runBlockedReason();
    if (!blocker) {
      runTrials(count);
      return;
    }
    toast(blocker, "warning");
    if (!server.selectedDevice() || server.isEmptyDevices()) props.onOpenTargets();
  };
  const runOnMatrix = (matrixId: string) => {
    const recipe = selected();
    if (!recipe) return;
    setRunMenuOpen(false);
    void server.runCompatibilityMatrixRemote(recipe.id, matrixId, matrixRepetitions());
  };
  createEffect(() => {
    if (!runMenuOpen() || server.matrices().length === 0) return;
    setMatrixPreviewBusy(true);
    void Promise.all(
      server.matrices().map(async (matrix) => {
        const expansion = await server.resolveCompatibilityMatrix(matrix.id);
        return [matrix.id, expansion] as const;
      }),
    )
      .then((entries) => setMatrixExpansions(Object.fromEntries(entries)))
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : String(error), "error"),
      )
      .finally(() => setMatrixPreviewBusy(false));
  });
  createEffect(() => {
    const id = selected()?.id;
    if (!id) return;
    void server
      .loadRecipeStability(id)
      .then(setStability)
      .catch(() => setStability(null));
  });
  const toggleHistory = async () => {
    const recipe = selected();
    if (!recipe) return;
    const open = !historyOpen();
    setHistoryOpen(open);
    if (open) setHistory(await server.loadRecipeHistory(recipe.id).catch(() => []));
  };
  const toggleQuarantine = async () => {
    const recipe = selected();
    if (!recipe) return;
    const quarantined = !recipe.quarantined;
    const reason = quarantined
      ? window.prompt("Why should scheduled runs skip this test?", "Investigating flakiness")
      : "";
    if (quarantined && reason === null) return;
    await server.saveRecipeRemote({
      id: recipe.id,
      title: draft.title(),
      description: draft.description(),
      steps: draft.steps(),
      quarantined,
      quarantineReason: reason ?? "",
    });
  };
  return (
    <aside class={shellSteps} aria-label="Test steps">
      <div class={shellStepsHead}>
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <input
              class="w-full min-w-0 rounded-md border-0 bg-transparent px-0 text-[17px] font-semibold tracking-[-0.02em] text-[var(--relay-text)] outline-none placeholder:text-[var(--relay-text-tertiary)] focus:bg-[var(--relay-surface-raised)] focus:px-2 focus:-mx-2 transition-[background-color,padding,margin] duration-100"
              aria-label="Test name"
              value={draft.title()}
              spellcheck={false}
              placeholder="Untitled test"
              onInput={(event) => draft.setTitle(event.currentTarget.value)}
            />
          </div>
          <div class="relative flex shrink-0 items-center gap-2">
            <div class="flex items-center gap-px">
              <button
                type="button"
                class={cn(shellRecord, "rounded-r-none")}
                data-blocked={!canRun() ? "" : undefined}
                data-tip={runBlockedReason() || "Run this test"}
                onClick={() => attemptRun(1)}
              >
                <Icon name="play" size={13} /> Run
              </button>
              <button
                type="button"
                class={cn(shellRecord, "rounded-l-none px-2")}
                data-blocked={!canRun() ? "" : undefined}
                aria-label="Run options"
                aria-haspopup="dialog"
                aria-expanded={runMenuOpen()}
                onClick={() => {
                  const blocker = runBlockedReason();
                  if (blocker) {
                    toast(blocker, "warning");
                    return;
                  }
                  setRunMenuOpen((open) => !open);
                }}
              >
                <Icon name="chevron-down" size={12} />
              </button>
              <Show when={runMenuOpen()}>
                <div
                  class="absolute top-[calc(100%+6px)] right-0 z-40 grid w-[260px] gap-0.5 rounded-[12px] border border-[var(--relay-line-strong)] bg-surface-raised-stronger-non-alpha p-1.5 shadow-[var(--v2-elevation-overlay)] [&_button]:flex [&_button]:min-h-10 [&_button]:w-full [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-lg [&_button]:px-2.5 [&_button]:text-left [&_button]:text-[12px] [&_button]:text-[var(--relay-text-secondary)] hover:[&_button]:bg-[var(--relay-surface-strong)] hover:[&_button]:text-[var(--relay-text)] [&_strong]:block [&_strong]:text-[var(--relay-text)] [&_small]:block [&_small]:text-[10px] [&_small]:text-[var(--relay-text-tertiary)]"
                  role="dialog"
                  aria-label="Run options"
                >
                  <button type="button" onClick={() => runTrials(1)}>
                    <Icon name="play" size={14} />
                    <span>
                      <strong>Smoke run</strong>
                      <small>One fast execution</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => runTrials(3)}>
                    <Icon name="refresh" size={14} />
                    <span>
                      <strong>Reliability check</strong>
                      <small>Repeat 3 times</small>
                    </span>
                  </button>
                  <button type="button" onClick={() => runTrials(matrixSize())}>
                    <Icon name="grid" size={14} />
                    <span>
                      <strong>All test data</strong>
                      <small>{matrixSize()} approved or generated cases</small>
                    </span>
                  </button>
                  <Show when={server.matrices().length > 0}>
                    <section
                      class="grid gap-1 border-t border-[var(--relay-line)] pt-1.5"
                      aria-label="Test environments"
                    >
                      <header>
                        <span>Test environments</span>
                        <div role="group" aria-label="Trials per environment">
                          <button
                            type="button"
                            aria-pressed={matrixRepetitions() === 1}
                            onClick={() => setMatrixRepetitions(1)}
                          >
                            1×
                          </button>
                          <button
                            type="button"
                            aria-pressed={matrixRepetitions() === 3}
                            onClick={() => setMatrixRepetitions(3)}
                          >
                            3×
                          </button>
                        </div>
                      </header>
                      <For each={server.matrices()}>
                        {(matrix) => {
                          const expansion = () => matrixExpansions()[matrix.id];
                          const preview = () => {
                            const value = expansion();
                            return value ? matrixRunPreview(value, matrixRepetitions()) : null;
                          };
                          return (
                            <div class="grid gap-1 rounded-lg border border-[var(--relay-line)] bg-[var(--relay-surface-raised)] p-2">
                              <button
                                type="button"
                                disabled={!expansion() || expansion()!.profiles.length === 0}
                                onClick={() => runOnMatrix(matrix.id)}
                              >
                                <Icon name="grid" size={14} />
                                <span>
                                  <strong>{matrix.name}</strong>
                                  <small>
                                    <Show
                                      when={expansion()}
                                      fallback={
                                        matrixPreviewBusy() ? "Checking targets…" : "Unavailable"
                                      }
                                    >
                                      {preview()!.summary}
                                    </Show>
                                  </small>
                                </span>
                                <Icon name="chevron-right" size={12} />
                              </button>
                              <Show when={preview()?.exclusions.length}>
                                <details>
                                  <summary>
                                    {preview()!.exclusions.length} target
                                    {preview()!.exclusions.length === 1 ? "" : "s"} excluded
                                  </summary>
                                  <ul>
                                    <For each={preview()!.exclusions}>
                                      {(item) => (
                                        <li>
                                          <strong>{item.name}</strong>
                                          <span>{item.reason}</span>
                                        </li>
                                      )}
                                    </For>
                                  </ul>
                                </details>
                              </Show>
                              <Show when={preview()?.profiles.length}>
                                <details>
                                  <summary>
                                    {preview()!.profiles.length} target
                                    {preview()!.profiles.length === 1 ? "" : "s"} included
                                  </summary>
                                  <ul>
                                    <For each={preview()!.profiles}>
                                      {(profile) => (
                                        <li>
                                          <strong>{profile.name}</strong>
                                          <span>
                                            {profile.platform}
                                            {profile.osVersion ? ` · ${profile.osVersion}` : ""}
                                          </span>
                                        </li>
                                      )}
                                    </For>
                                  </ul>
                                </details>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </section>
                  </Show>
                  <Show when={server.matrices().length === 0}>
                    <div class="px-2 py-3 text-center text-[11px] text-[var(--relay-text-tertiary)]">
                      <strong>No test environment yet</strong>
                      <small>
                        Save a set of devices and OS versions to run this test across them.
                      </small>
                    </div>
                  </Show>
                  <button
                    type="button"
                    onClick={() => {
                      setRunMenuOpen(false);
                      props.onOpenTargets();
                    }}
                  >
                    <Icon name="sliders" size={14} />
                    <span>
                      <strong>Manage test environments</strong>
                      <small>Choose devices, OS versions, and capabilities</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const recipe = selected();
                      if (!recipe) return;
                      setRunMenuOpen(false);
                      void server
                        .scheduleRecipe({ recipeId: recipe.id, intervalMinutes: 1_440 })
                        .then(() => toast("Daily local run scheduled", "success"))
                        .catch((error: unknown) =>
                          toast(error instanceof Error ? error.message : String(error), "error"),
                        );
                    }}
                  >
                    <Icon name="clock" size={14} />
                    <span>
                      <strong>Schedule daily</strong>
                      <small>Runs on this target</small>
                    </span>
                  </button>
                </div>
              </Show>
            </div>
            <span class={dividerY} aria-hidden="true" />
            <button
              type="button"
              class={productIconButton}
              aria-label="More test actions"
              aria-expanded={maintenanceOpen()}
              onClick={() => setMaintenanceOpen((open) => !open)}
            >
              <Icon name="more" size={14} />
            </button>
            <Show when={maintenanceOpen()}>
              <div
                class="ui-pop absolute top-[calc(100%+6px)] right-0 z-40 grid w-[220px] gap-0.5 rounded-[10px] border border-[var(--relay-line-strong)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--v2-elevation-overlay)] [&_button]:flex [&_button]:min-h-9 [&_button]:w-full [&_button]:items-center [&_button]:gap-2 [&_button]:rounded-md [&_button]:px-2.5 [&_button]:text-left [&_button]:text-[12px] [&_button]:text-[var(--relay-text-secondary)] hover:[&_button]:bg-[var(--relay-surface-strong)]"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMaintenanceOpen(false);
                    void toggleHistory();
                  }}
                >
                  <Icon name="clock" size={14} /> Version history
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMaintenanceOpen(false);
                    void toggleQuarantine();
                  }}
                >
                  <Icon name={selected()?.quarantined ? "refresh" : "pause"} size={14} />
                  {selected()?.quarantined ? "Restore to suite" : "Quarantine test"}
                </button>
                <Show when={activeSchedule()}>
                  {(schedule) => (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMaintenanceOpen(false);
                        if (!window.confirm("Remove this local schedule?")) return;
                        void server.deleteLocalSchedule(schedule().id);
                      }}
                    >
                      <Icon name="x" size={14} /> Remove daily schedule
                    </button>
                  )}
                </Show>
              </div>
            </Show>
          </div>
        </div>
        <textarea
          class="mt-1 w-full resize-none rounded-md border-0 bg-transparent px-0 text-[12px]/[1.45] text-[var(--relay-text-secondary)] outline-none placeholder:text-[var(--relay-text-tertiary)] focus:bg-[var(--relay-surface-raised)] focus:px-2 focus:-mx-2 transition-[background-color,padding,margin] duration-100"
          aria-label="Test description"
          value={draft.description()}
          placeholder="Add a short description…"
          rows={1}
          spellcheck={false}
          onInput={(event) => draft.setDescription(event.currentTarget.value)}
        />
        <Show
          when={
            stability()?.passRate != null || selected()?.quarantined || Boolean(activeSchedule())
          }
        >
          <div class="mt-1 flex min-h-6 items-center gap-2 text-[10.5px] text-[var(--relay-text-tertiary)] [&>b]:rounded [&>b]:bg-[color-mix(in_srgb,var(--relay-amber)_16%,transparent)] [&>b]:px-1.5 [&>b]:py-0.5 [&>b]:font-medium [&>b]:text-[var(--relay-amber)]">
            <Show when={stability()?.passRate !== null && stability()?.passRate !== undefined}>
              <span>
                {Math.round((stability()!.passRate ?? 0) * 100)}% stable · {stability()!.total}{" "}
                recent runs
              </span>
            </Show>
            <Show when={selected()?.quarantined}>
              <b title={selected()?.quarantineReason}>Quarantined</b>
            </Show>
            <Show when={activeSchedule()}>
              <span>Scheduled daily</span>
            </Show>
          </div>
        </Show>
        <Show when={historyOpen()}>
          <div class="absolute top-[calc(100%+6px)] right-0 z-40 grid w-[280px] gap-0 overflow-hidden rounded-[12px] border border-[var(--relay-line-strong)] bg-surface-raised-stronger-non-alpha shadow-[var(--v2-elevation-overlay)] [&_header]:flex [&_header]:items-center [&_header]:justify-between [&_header]:border-b [&_header]:border-[var(--relay-line)] [&_header]:px-3 [&_header]:py-2.5 [&_button]:flex [&_button]:w-full [&_button]:items-center [&_button]:gap-2 [&_button]:px-3 [&_button]:py-2 [&_button]:text-left hover:[&_button]:bg-[var(--relay-surface-strong)] [&_strong]:text-[12px] [&_strong]:text-[var(--relay-text)] [&_small]:text-[10px] [&_small]:text-[var(--relay-text-tertiary)]">
            <header>
              <div>
                <strong>Version history</strong>
                <small>Every saved edit remains recoverable.</small>
              </div>
              <button
                type="button"
                aria-label="Close history"
                onClick={() => setHistoryOpen(false)}
              >
                <Icon name="x" size={13} />
              </button>
            </header>
            <For each={history()} fallback={<p>No earlier versions yet.</p>}>
              {(version) => (
                <button
                  type="button"
                  onClick={() => {
                    if (!selected()) return;
                    void server.restoreRecipeVersion(selected()!.id, version.updatedAt).then(() => {
                      setHistoryOpen(false);
                      toast("Version restored", "success");
                    });
                  }}
                >
                  <span>
                    <strong>{new Date(version.updatedAt).toLocaleString()}</strong>
                    <small>
                      {version.steps.length} steps · {version.title}
                    </small>
                  </span>
                  <Icon name="refresh" size={13} />
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="mt-1.5 flex items-center" role="tablist" aria-label="Test editor panels">
          <For each={["steps", "inputs", "yaml"] as const}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === item}
                class={cn(tabUnderline, tab() === item && tabUnderlineActive)}
                onClick={() => setTab(item)}
              >
                {item === "steps" ? "Steps" : item === "inputs" ? "Inputs" : "YAML"}
                <Show when={item === "steps"}>
                  <span class="min-w-4 rounded-full bg-surface-weak px-1 text-center text-[11px]/4 text-text-weak">
                    {draft.steps().length}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class={shellStepsBody} data-editor-tab={tab()}>
        <Show when={tab() === "steps"}>
          <div class="flex h-full min-h-0 flex-col">
            <AgentTestComposer />
            <RecipeStepsEditor />
          </div>
        </Show>
        <Show when={tab() === "inputs"}>
          <div class="grid content-start gap-4 p-4">
            <FlowParametersEditor />
            <div class="flex items-center justify-between gap-3 border-t border-[var(--relay-line)] pt-3.5">
              <div class="flex min-w-0 items-center gap-2.5">
                <Icon
                  name="sparkle"
                  size={15}
                  class="shrink-0 text-[var(--text-interactive-base)]"
                />
                <span class="min-w-0">
                  <strong class="block text-[11.5px] font-medium text-[var(--relay-text-secondary)]">
                    Need values shared across tests?
                  </strong>
                  <small class="mt-0.5 block text-[10px] text-[var(--relay-text-tertiary)]">
                    Workspace variables use {"{{variable_name}}"}.
                  </small>
                </span>
              </div>
              <button
                type="button"
                class="shrink-0 text-[11px] font-semibold text-[var(--text-interactive-base)] hover:underline"
                onClick={props.onOpenData}
              >
                Open variables
              </button>
            </div>
          </div>
        </Show>
        <Show when={tab() === "yaml"}>
          <div class="flex h-full min-h-0 flex-col overflow-hidden">
            <header class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--relay-line)] px-3">
              <span class="text-[11px] font-semibold tracking-[0.06em] text-[var(--relay-text-tertiary)] uppercase">
                Source file
              </span>
              <div class="flex items-center gap-1">
                <Show when={!yamlEditing()}>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--relay-text-secondary)] hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)] disabled:opacity-40"
                    disabled={!yamlSource()}
                    onClick={() => void navigator.clipboard?.writeText(yamlSource() ?? "")}
                  >
                    <Icon name="copy" size={13} /> Copy
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--relay-text-secondary)] hover:bg-[var(--relay-surface-strong)] hover:text-[var(--relay-text)] disabled:opacity-40"
                    disabled={!yamlSource()}
                    onClick={startYamlEdit}
                  >
                    <Icon name="edit" size={13} /> Edit
                  </button>
                </Show>
                <Show when={yamlEditing()}>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--relay-text-secondary)] hover:bg-[var(--relay-surface-strong)] disabled:opacity-40"
                    onClick={cancelYamlEdit}
                    disabled={yamlSaving()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-[var(--relay-text)] hover:bg-[var(--relay-surface-strong)] disabled:opacity-40"
                    onClick={() => void saveYaml()}
                    disabled={yamlSaving()}
                  >
                    {yamlSaving() ? "Saving…" : "Save YAML"}
                  </button>
                </Show>
              </div>
            </header>
            <Show
              when={yamlSource()}
              fallback={
                <div class="grid flex-1 place-items-center text-[12px] text-[var(--relay-text-tertiary)]">
                  Loading canonical YAML…
                </div>
              }
            >
              <Show
                when={yamlEditing()}
                fallback={
                  <pre class="m-0 min-h-0 flex-1 overflow-auto bg-[var(--relay-bg)] p-3 font-mono text-[11px]/[1.5] text-[var(--relay-text-secondary)]">
                    {yamlSource()}
                  </pre>
                }
              >
                <textarea
                  class="min-h-0 flex-1 resize-none border-0 bg-[var(--relay-bg)] p-3 font-mono text-[11px]/[1.5] text-[var(--relay-text)] outline-none"
                  aria-label="Test YAML"
                  spellcheck={false}
                  value={yamlDraft()}
                  onInput={(event) => {
                    setYamlDraft(event.currentTarget.value);
                    setYamlMessage(null);
                  }}
                />
              </Show>
              <Show when={yamlMessage()}>
                {(message) => (
                  <p
                    class={cn(
                      "m-0 border-t border-[var(--relay-line)] px-3 py-2 text-[11px]",
                      message().tone === "success" && "text-[var(--relay-green)]",
                      message().tone === "error" && "text-[var(--relay-red)]",
                      message().tone !== "success" &&
                        message().tone !== "error" &&
                        "text-[var(--relay-text-secondary)]",
                    )}
                    role="status"
                  >
                    {message().text}
                  </p>
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </aside>
  );
}

function FlowParametersEditor() {
  const draft = useRecipeDraft();
  const add = () => {
    const used = new Set(draft.parameters().map((parameter) => parameter.name));
    let index = draft.parameters().length + 1;
    while (used.has(`input_${index}`)) index += 1;
    draft.setParameters([
      ...draft.parameters(),
      { name: `input_${index}`, label: `Input ${index}`, required: true },
    ]);
  };
  const patch = (index: number, changes: Partial<RecipeParameter>) =>
    draft.setParameters(
      draft
        .parameters()
        .map((parameter, current) =>
          current === index ? { ...parameter, ...changes } : parameter,
        ),
    );
  const remove = (index: number) =>
    draft.setParameters(draft.parameters().filter((_, current) => current !== index));

  const field =
    "h-[30px] w-full min-w-0 rounded-[7px] border border-[var(--relay-line)] bg-[var(--relay-panel)] px-2 text-[11px] text-[var(--relay-text)] outline-none focus:border-[var(--text-interactive-base)]";
  const label = "grid min-w-0 gap-1 text-[10px] text-[var(--relay-text-tertiary)]";

  return (
    <div class="grid gap-3.5">
      <header class="flex items-center justify-between gap-4 max-sm:grid max-sm:grid-cols-1">
        <div class="grid min-w-0 gap-1">
          <h3 class="m-0 text-[15px] font-semibold leading-[1.2] tracking-[-0.01em] text-[var(--relay-text)]">
            Inputs
          </h3>
          <p class="m-0 max-w-[34rem] text-[10.5px]/[1.45] text-[var(--relay-text-tertiary)]">
            Values a caller supplies when reusing this flow.
          </p>
        </div>
        <button
          type="button"
          class={cn(productSecondary, "min-h-8 shrink-0 whitespace-nowrap px-2.5 text-[11px]")}
          onClick={add}
        >
          <Icon name="plus" size={13} /> Add input
        </button>
      </header>
      <Show
        when={draft.parameters().length > 0}
        fallback={
          <div class="grid min-h-24 place-items-center border-y border-dashed border-[var(--relay-line)] px-4 py-5 text-center">
            <div>
              <strong class="block text-[11.5px] font-medium text-[var(--relay-text-secondary)]">
                No caller inputs
              </strong>
              <span class="mt-1 block text-[10px] text-[var(--relay-text-tertiary)]">
                This flow runs with its recorded values.
              </span>
            </div>
          </div>
        }
      >
        <div class="grid gap-2">
          <Index each={draft.parameters()}>
            {(parameter, index) => (
              <article class="grid gap-2.5 rounded-[10px] border border-[var(--relay-line)] bg-surface-raised-stronger-non-alpha p-[11px]">
                <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_28px] items-end gap-2 max-sm:grid-cols-1">
                  <label class={label}>
                    <span>Variable name</span>
                    <input
                      class={cn(field, "font-mono")}
                      value={parameter().name}
                      placeholder="login_email"
                      onInput={(event) => patch(index, { name: event.currentTarget.value })}
                    />
                  </label>
                  <label class={label}>
                    <span>Label</span>
                    <input
                      class={field}
                      value={parameter().label ?? ""}
                      placeholder="Login email"
                      onInput={(event) =>
                        patch(index, { label: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label class="flex h-[30px] items-center gap-1.5 whitespace-nowrap text-[10px] text-[var(--relay-text-secondary)]">
                    <input
                      type="checkbox"
                      checked={parameter().required === true}
                      onChange={(event) => patch(index, { required: event.currentTarget.checked })}
                    />
                    <span>Required</span>
                  </label>
                  <button
                    type="button"
                    class={productIconButtonDanger}
                    aria-label={`Remove ${parameter().label || parameter().name}`}
                    onClick={() => remove(index)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                  <label class={label}>
                    <span>Default</span>
                    <input
                      class={cn(field, "font-mono")}
                      value={parameter().default ?? ""}
                      placeholder="Optional safe default"
                      onInput={(event) =>
                        patch(index, { default: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label class={label}>
                    <span>Guidance</span>
                    <input
                      class={field}
                      value={parameter().description ?? ""}
                      placeholder="What the flow expects"
                      onInput={(event) =>
                        patch(index, { description: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                </div>
              </article>
            )}
          </Index>
        </div>
      </Show>
      <Show when={draft.parameterIssue()}>
        {(message) => (
          <p
            class="m-0 rounded-lg border border-[color-mix(in_srgb,var(--relay-red)_45%,var(--relay-line))] bg-[color-mix(in_srgb,var(--relay-red)_8%,transparent)] px-2.5 py-2 text-[11px] text-[var(--relay-red)]"
            role="alert"
          >
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}

function nextUntitledTitle(recipes: RecipeInfo[]): string {
  const used = new Set(recipes.map((recipe) => recipe.title));
  if (!used.has("Untitled test")) return "Untitled test";
  let index = 2;
  while (used.has(`Untitled test ${index}`)) index++;
  return `Untitled test ${index}`;
}

function titleFromPrompt(description: string, recipes: RecipeInfo[]): string {
  const sentence = description.split(/[.!?\n]/, 1)[0]?.trim() || "New test";
  const base = sentence.length > 52 ? `${sentence.slice(0, 49).trimEnd()}…` : sentence;
  const normalized = base.charAt(0).toUpperCase() + base.slice(1);
  if (!recipes.some((recipe) => recipe.title === normalized)) return normalized;
  let index = 2;
  while (recipes.some((recipe) => recipe.title === `${normalized} ${index}`)) index++;
  return `${normalized} ${index}`;
}
