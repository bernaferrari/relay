import {
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
} from "solid-js";
import { useServer, type RecipeInfo, type RecipeStep } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { JourneyWorkspace } from "./journey-workspace";
import { JourneyInspector, JourneyOutline } from "./journey-chrome";
import { DevicePicker } from "./device-picker";
import { LibraryPanel } from "./studio-library";
import { TestWelcome } from "./test-onboarding";
import { RunsWorkspace } from "./runs-workspace";
import { TestWorkbench } from "./test-workbench";
import { TestSettingsPanel } from "./test-details-panel";
import { SuitesWorkspace } from "./suites-workspace";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";
import { displayTitle } from "../lib/job";
import { toast } from "../context/toast";
import { confirmAction } from "./confirm-dialog";
import {
  modalPanel,
  modalScrim,
  eyebrow,
  productPrimary,
  productSecondary,
  productIconButton,
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
  shellStudio,
  shellStudioBar,
  shellViewTabs,
  shellViewTab,
  shellViewTabActive,
  shellSaveState,
  shellStudioBodyJourney,
  shellStageWrap,
  shellStageDrawerClearance,
  shellDragStrip,
} from "../lib/shell-layout";
import { planTestPrompt } from "../lib/natural-language-plan";
import { blockerIsDeviceRelated, testRunBlocker } from "../lib/test-run-readiness";
import type { SettingsSection } from "../pages/settings";

type ProductArea = "tests" | "suites" | "runs" | "map";
type StudioView = "workbench" | "map";

const DataWorkspace = lazy(() =>
  import("./workspaces/data-workspace").then((module) => ({ default: module.DataWorkspace })),
);
const MapsWorkspace = lazy(() =>
  import("./workspaces/maps-workspace").then((module) => ({ default: module.MapsWorkspace })),
);
const AREA_ITEMS: { id: ProductArea; label: string; icon: IconName }[] = [
  { id: "tests", label: "Tests", icon: "grid" },
  { id: "suites", label: "Flows", icon: "check" },
  { id: "runs", label: "Runs", icon: "wave" },
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
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [variablesOpen, setVariablesOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [libraryOpen, setLibraryOpen] = createSignal(true);
  const [studioActionsOpen, setStudioActionsOpen] = createSignal(false);
  const [importReview, setImportReview] = createSignal<{
    yaml: string;
    recipe: RecipeInfo;
    exists: boolean;
    canonicalYaml: string;
  } | null>(null);

  const selected = createMemo(() => server.selectedRecipe());
  let titleBeforeEdit = "";
  let variablesDialog: HTMLElement | undefined;
  createEffect(() => {
    if (!variablesOpen()) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVariablesOpen(false);
    };
    window.addEventListener("keydown", close);
    requestAnimationFrame(() => variablesDialog?.focus({ preventScroll: true }));
    onCleanup(() => window.removeEventListener("keydown", close));
  });
  let previousReadyRecipeId: string | null = null;
  createEffect(() => {
    const readyId = selected()?.id ?? null;
    if (readyId && readyId !== previousReadyRecipeId) setLibraryOpen(false);
    if (!server.selectedRecipeId()) setLibraryOpen(true);
    previousReadyRecipeId = readyId;
  });
  // Every test opens on the device-first workbench. Remembering a settings
  // drawer across tests makes a new selection feel broken or unpredictable.
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
    setSettingsOpen(false);
    setVariablesOpen(false);
    defaultedViewForId = id;
  });
  const readinessState = () => ({
    health: server.health(),
    selectedDevice: server.selectedDevice(),
    devices: server.devices(),
    stepCount: draft.steps().length,
    invalidCount: draft.invalidCount(),
  });
  const testBlockedReason = () => testRunBlocker(readinessState());
  const runSelectedTest = () => {
    const blocker = testBlockedReason();
    if (blocker) {
      toast(blocker, "warning");
      if (server.isEmptyDevices()) props.onOpenSettings("targets");
      else if (readinessState() && blockerIsDeviceRelated(readinessState())) {
        // A selected-but-stopped device is fixed in the picker, not in settings.
        window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
      }
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
  async function createTest(record = false, description = ""): Promise<RecipeInfo | null> {
    const plannedSteps = description.trim()
      ? planTestPrompt(description).map((instruction) => instruction.step)
      : [];
    const saved = await server.saveRecipeRemote({
      title: description
        ? titleFromPrompt(description, server.recipes(), plannedSteps)
        : nextUntitledTitle(server.recipes()),
      description,
      steps: plannedSteps,
    });
    if (!saved) return null;
    server.setSelectedRecipeId(saved.id);
    setArea("tests");
    setStudioView("workbench");
    setSettingsOpen(false);
    if (record) recorder.enterRecordMode();
    return saved;
  }

  async function recordTestForSuite(suiteId: string, sectionId: string): Promise<void> {
    const saved = await createTest(true);
    const suite = server.suites().find((item) => item.id === suiteId);
    if (!saved || !suite) return;
    await server.saveSuiteRemote({
      id: suite.id,
      title: suite.title,
      description: suite.description,
      sections: suite.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              entries: [
                ...section.entries,
                { id: crypto.randomUUID(), testId: saved.id, enabled: true, version: "latest" },
              ],
            }
          : section,
      ),
    });
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
    // Copies of copies get "(copy 2)", never "… (copy) copy".
    const base = displayTitle(recipe.title).replace(/\s*\((copy)(?:\s+\d+)?\)\s*$/i, "");
    const titles = new Set(server.recipes().map((item) => displayTitle(item.title)));
    let title = `${base} (copy)`;
    for (let index = 2; titles.has(title); index++) title = `${base} (copy ${index})`;
    const saved = await server.saveRecipeRemote({
      title,
      description: recipe.description,
      steps: draft.steps(),
    });
    if (saved) server.setSelectedRecipeId(saved.id);
  }

  function deleteSelected(): void {
    const recipe = selected();
    if (!recipe) return;
    confirmAction({
      title: "Delete test?",
      body: `“${displayTitle(recipe.title)}” and its version history will be removed. This cannot be undone.`,
      confirmLabel: "Delete test",
      onConfirm: async () => {
        await server.deleteRecipeRemote(recipe.id);
        toast("Test deleted", "info");
      },
    });
  }

  function openRecipe(id: string): void {
    server.setSelectedRecipeId(id);
    setArea("tests");
    // Default view is decided per-test by the effect above (content vs. empty).
    // Opening a test transitions from the file browser to the canvas, like
    // Figma. The library stays one click away in the top-left toolbar.
    setLibraryOpen(false);
  }

  function openNewTestComposer(): void {
    setArea("tests");
    server.setSelectedRecipeId(null);
    setLibraryOpen(true);
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>("[data-new-test-prompt]")?.focus();
    });
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
                  aria-label={item.label}
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
          onCreate={openNewTestComposer}
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
              <Show
                when={area() === "tests" && selected()}
                fallback={
                  <strong>
                    {area() === "runs"
                      ? "Run history"
                      : area() === "suites"
                        ? "Flows"
                        : area() === "map"
                          ? "Atlas"
                          : "Tests"}
                  </strong>
                }
              >
                <button
                  type="button"
                  class="rounded font-medium text-[var(--text-weak)] transition-colors hover:text-[var(--text-strong)]"
                  onClick={() => {
                    server.setSelectedRecipeId(null);
                    setLibraryOpen(true);
                  }}
                >
                  Tests
                </button>
                <Icon name="chevron-right" size={13} />
                <input
                  type="text"
                  size={Math.max(12, Math.min(34, (draft.title() || "Untitled test").length + 1))}
                  class="h-8 min-w-[120px] max-w-[min(32vw,360px)] rounded-md bg-transparent px-1.5 font-medium text-[var(--text-base)] outline-none transition-[background-color,box-shadow,color] duration-150 placeholder:text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-01)] focus:bg-[var(--v2-background-bg-layer-01)] focus:text-[var(--text-strong)] focus:shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]"
                  aria-label="Test name"
                  data-tip="Rename test"
                  value={draft.title()}
                  placeholder="Untitled test"
                  spellcheck={false}
                  onFocus={() => {
                    titleBeforeEdit = draft.title();
                  }}
                  onInput={(event) => draft.setTitle(event.currentTarget.value)}
                  onBlur={() => {
                    if (!draft.title().trim()) draft.setTitle("Untitled test");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      draft.setTitle(titleBeforeEdit);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </Show>
            </div>
          </div>
          <div class={shellTopbarActions}>
            <Show when={area() === "tests" || area() === "suites" || area() === "map"}>
              <DevicePicker onManageTargets={() => props.onOpenSettings("targets")} />
            </Show>
            <Show when={area() === "tests" && selected()}>
              <button
                type="button"
                class={cn(productPrimary, "min-h-9 px-3.5 text-[12px]")}
                data-blocked={testBlockedReason() ? "" : undefined}
                data-tip={testBlockedReason() || "Run this test"}
                aria-label={testBlockedReason() || "Run this test"}
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
                <div class={shellViewTabs} role="group" aria-label="Test view">
                  <button
                    type="button"
                    aria-pressed={studioView() === "workbench"}
                    class={cn(shellViewTab, studioView() === "workbench" && shellViewTabActive)}
                    onClick={() => setStudioView("workbench")}
                  >
                    <Icon name="grid" size={13} /> Steps
                  </button>
                  <button
                    type="button"
                    aria-pressed={studioView() === "map"}
                    class={cn(shellViewTab, studioView() === "map" && shellViewTabActive)}
                    onClick={() => {
                      setSettingsOpen(false);
                      setStudioView("map");
                    }}
                  >
                    <Icon name="move" size={13} /> Map
                  </button>
                </div>
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
                      type="button"
                      aria-pressed={settingsOpen()}
                      class={cn(shellViewTab, settingsOpen() && shellViewTabActive)}
                      onClick={() => {
                        setStudioView("workbench");
                        setSettingsOpen((open) => !open);
                      }}
                    >
                      <Icon name="sliders" size={13} /> Properties
                    </button>
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
                        class="ui-pop absolute top-[calc(100%+6px)] right-0 z-40 grid w-[200px] gap-0.5 rounded-[10px] border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--v2-elevation-overlay)]"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
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
                          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                          onClick={() => {
                            setStudioActionsOpen(false);
                            setArea("map");
                          }}
                        >
                          <Icon name="move" size={14} /> Explore in Atlas
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          class="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--icon-critical-base)] hover:bg-[var(--v2-background-bg-layer-02)]"
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
            <div
              class={
                selected() ? shellStudioBodyJourney : "grid min-h-0 min-w-0 flex-1 grid-cols-1"
              }
            >
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
                    onOpenTargets={() => props.onOpenSettings("targets")}
                    onOpenRun={(id) => {
                      server.setSelectedJobId(id);
                      setArea("runs");
                    }}
                    details={
                      settingsOpen() ? (
                        <TestSettingsPanel
                          onClose={() => setSettingsOpen(false)}
                          onOpenVariables={() => setVariablesOpen(true)}
                        />
                      ) : undefined
                    }
                  />
                </Show>
                <Show when={studioView() === "map"}>
                  <JourneyOutline />
                  <div class={cn(shellStageWrap, shellStageDrawerClearance, "flex-1")}>
                    <JourneyWorkspace
                      onLive={() => {
                        setStudioView("workbench");
                        setLibraryOpen(false);
                      }}
                    />
                  </div>
                  <Show when={draft.steps().length > 0}>
                    <JourneyInspector onOpenTargets={() => props.onOpenSettings("matrices")} />
                  </Show>
                </Show>
              </Show>
            </div>
          </section>
        </Show>

        <Show when={area() === "runs"}>
          <RunsWorkspace onOpenRecipe={openRecipe} onOpenTests={() => setArea("tests")} />
        </Show>
        <Show when={area() === "suites"}>
          <SuitesWorkspace
            onOpenTest={openRecipe}
            onOpenRun={(id) => {
              server.setSelectedJobId(id);
              setArea("runs");
            }}
            onOpenTargets={() => props.onOpenSettings("targets")}
            onRecordTest={(suiteId, sectionId) => void recordTestForSuite(suiteId, sectionId)}
          />
        </Show>
        <Show when={area() === "map"}>
          <Suspense
            fallback={
              <div class="grid min-h-0 flex-1 place-items-center bg-[var(--v2-background-bg-deep)] p-8 text-center">
                <div>
                  <span class="mx-auto grid size-10 place-items-center rounded-xl bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
                    <Icon name="move" size={16} />
                  </span>
                  <p class="mt-3 text-[12px] text-[var(--text-weak)]">Loading Atlas…</p>
                </div>
              </div>
            }
          >
            <MapsWorkspace onOpenRecipe={openRecipe} onOpenTests={() => setArea("tests")} />
          </Suspense>
        </Show>
      </main>
      <Show when={variablesOpen()}>
        <div
          class={cn(modalScrim, "z-[130] flex items-center justify-center p-5")}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setVariablesOpen(false);
          }}
        >
          <section
            ref={(element) => {
              variablesDialog = element;
            }}
            class={cn(modalPanel, "h-[min(82vh,760px)] w-[min(100%,980px)] outline-none")}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace variables"
            tabindex={-1}
          >
            <Suspense
              fallback={
                <div class="grid h-full place-items-center text-[12px] text-[var(--text-weak)]">
                  Loading variables…
                </div>
              }
            >
              <DataWorkspace
                embedded
                onClose={() => setVariablesOpen(false)}
                onConfigureProvider={() => {
                  setVariablesOpen(false);
                  props.onOpenSettings();
                }}
              />
            </Suspense>
          </section>
        </div>
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
              <header class="flex items-start justify-between gap-3 border-b border-[var(--v2-border-border-muted)] px-4 py-3.5">
                <div>
                  <span class={eyebrow}>Relay YAML</span>
                  <h3
                    id="import-review-title"
                    class="mt-1 text-[16px] font-semibold text-[var(--text-strong)]"
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
              <div class="mx-4 mt-3.5 flex items-center gap-3 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] p-3">
                <span class="grid size-9 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] text-[var(--icon-success-base)]">
                  <Icon name="check" size={16} />
                </span>
                <div class="min-w-0">
                  <strong class="block text-[13px] text-[var(--text-strong)]">
                    {review().recipe.title}
                  </strong>
                  <small class="block text-[11px] text-[var(--text-weak)]">
                    {review().recipe.id} · {review().recipe.steps.length} step
                    {review().recipe.steps.length === 1 ? "" : "s"} · schema valid
                  </small>
                </div>
              </div>
              <details class="mx-4 my-3 rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-3 py-2">
                <summary class="cursor-pointer text-[11px] text-[var(--text-base)]">
                  Preview canonical YAML
                </summary>
                <pre class="mt-2 max-h-48 overflow-auto font-mono text-[11px]/[1.5] text-[var(--text-weak)]">
                  {review().canonicalYaml}
                </pre>
              </details>
              <footer class="flex items-center justify-between gap-3 border-t border-[var(--v2-border-border-muted)] px-4 py-3">
                <p class="m-0 max-w-[28ch] text-[11px]/[1.45] text-[var(--text-weak)]">
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

function nextUntitledTitle(recipes: RecipeInfo[]): string {
  const used = new Set(recipes.map((recipe) => recipe.title));
  if (!used.has("Untitled test")) return "Untitled test";
  let index = 2;
  while (used.has(`Untitled test ${index}`)) index++;
  return `Untitled test ${index}`;
}

function titleFromPrompt(
  description: string,
  recipes: RecipeInfo[],
  steps: RecipeStep[] = [],
): string {
  const sentence = description.split(/[.!?\n]/, 1)[0]?.trim() || "New test";
  // Long prompts make unreadable truncated titles; the check clause (the point
  // of the test) makes a better name than the first 49 characters.
  const check = steps.find(
    (step): step is Extract<RecipeStep, { kind: "expect" }> => step.kind === "expect",
  );
  const checkLabel = check && "target" in check ? check.target?.label?.trim() : "";
  const base =
    sentence.length > 52 && checkLabel
      ? `${checkLabel} ${check?.condition === "gone" ? "disappears" : "appears"}`
      : sentence.length > 52
        ? `${sentence.slice(0, 49).trimEnd()}…`
        : sentence;
  const normalized = base.charAt(0).toUpperCase() + base.slice(1);
  if (!recipes.some((recipe) => recipe.title === normalized)) return normalized;
  let index = 2;
  while (recipes.some((recipe) => recipe.title === `${normalized} ${index}`)) index++;
  return `${normalized} ${index}`;
}
