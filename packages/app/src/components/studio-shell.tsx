import { Show, Suspense, createEffect, createMemo, createSignal, lazy, onCleanup } from "solid-js";
import { useServer, type RecipeInfo } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { JourneyWorkspace } from "./journey-workspace";
import { JourneyNavigator, type NavigatorArea } from "./journey-navigator";
import { TestWelcome } from "./test-onboarding";
import { TestSettingsPanel } from "./test-details-panel";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { displayTitle } from "../lib/job";
import { deviceReadiness } from "../lib/device-readiness";
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
  shellRootNavVar,
  shellMain,
  shellTopbar,
  shellTopbarContext,
  shellTopbarActions,
  shellBreadcrumb,
  shellStudio,
  shellSaveState,
  shellStudioBodyJourney,
  shellStageWrap,
  shellDragStrip,
} from "../lib/shell-layout";
import { blockerIsDeviceRelated, testRunBlocker } from "../lib/test-run-readiness";
import { ensureJourneyGraph } from "../lib/journey-graph";
import type { JourneyRunReadiness as GraphRunReadiness } from "../lib/journey-run-readiness";
import type { SettingsSection } from "../pages/settings";

type ProductArea = "tests" | "suites" | "runs" | "map";
type StudioView = "workbench" | "map";
const DataWorkspace = lazy(() =>
  import("./workspaces/data-workspace").then((module) => ({ default: module.DataWorkspace })),
);
const MapsWorkspace = lazy(() =>
  import("./workspaces/maps-workspace").then((module) => ({ default: module.MapsWorkspace })),
);
const RunsWorkspace = lazy(() =>
  import("./runs-workspace").then((module) => ({ default: module.RunsWorkspace })),
);
const SuitesWorkspace = lazy(() =>
  import("./suites-workspace").then((module) => ({ default: module.SuitesWorkspace })),
);
const TestWorkbench = lazy(() =>
  import("./test-workbench").then((module) => ({ default: module.TestWorkbench })),
);

function WorkspaceLoading(props: { label: string }) {
  return (
    <div class="grid min-h-0 flex-1 place-items-center bg-[var(--v2-background-bg-deep)] text-[12px] text-[var(--text-weak)]">
      Loading {props.label}…
    </div>
  );
}

export function StudioShell(props: { onOpenSettings: (section?: SettingsSection) => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const [area, setArea] = createSignal<ProductArea>(
    new URLSearchParams(window.location.search).has("run") ? "runs" : "tests",
  );
  // The graph is the journey's source of truth. Device remains one click away
  // for direct editing, while the graph keeps each captured screen and its
  // outgoing actions visible as the journey grows.
  const [studioView, setStudioView] = createSignal<StudioView>("map");
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [variablesOpen, setVariablesOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [navOpen, setNavOpen] = createSignal(false);
  const [studioActionsOpen, setStudioActionsOpen] = createSignal(false);
  const [devicePanelOpen, setDevicePanelOpen] = createSignal(false);
  const [graphRunReadiness, setGraphRunReadiness] = createSignal<GraphRunReadiness>({
    visible: false,
    ready: false,
    reason: "Record a connection before running this journey",
    label: "Run journey",
    transitionPath: null,
  });
  const [importReview, setImportReview] = createSignal<{
    yaml: string;
    recipe: RecipeInfo;
    exists: boolean;
    canonicalYaml: string;
  } | null>(null);

  const selected = createMemo(() => server.selectedRecipe());
  // Opening Relay should feel like reopening a design file, not entering a
  // creation wizard. The provider restores the persisted id during startup;
  // this reactive fallback closes the small renderer race where recipes can
  // become visible before that asynchronous restore has selected a canvas.
  // It also gives browser-only sessions (with empty storage) the most recent
  // authored journey immediately.
  let restoredInitialJourney = false;
  createEffect(() => {
    if (restoredInitialJourney || server.health() !== "online") return;
    if (server.selectedRecipeId()) {
      restoredInitialJourney = true;
      return;
    }
    const latestJourney = server
      .recipes()
      .filter((recipe) => recipe.source === "custom")
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
    if (!latestJourney) return;
    restoredInitialJourney = true;
    server.setSelectedRecipeId(latestJourney.id);
  });
  // Atlas is reached from a journey's own menu, not the navigator tabs, so it
  // shows as Journeys rather than leaving every tab unselected.
  const navigatorArea = createMemo<NavigatorArea>(() => {
    const current = area();
    return current === "map" ? "tests" : current;
  });
  let titleBeforeEdit = "";
  let variablesDialog: HTMLElement | undefined;
  createEffect(() => {
    const openSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: SettingsSection }>).detail;
      props.onOpenSettings(detail?.section);
    };
    window.addEventListener("relay:open-settings", openSettings);
    onCleanup(() => window.removeEventListener("relay:open-settings", openSettings));
  });
  createEffect(() => {
    const updateDevicePanel = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail;
      setDevicePanelOpen(detail?.open === true);
    };
    window.addEventListener("relay:device-panel-state", updateDevicePanel);
    onCleanup(() => window.removeEventListener("relay:device-panel-state", updateDevicePanel));
  });
  createEffect(() => {
    const updateGraphRunReadiness = (event: Event) => {
      setGraphRunReadiness((event as CustomEvent<GraphRunReadiness>).detail);
    };
    window.addEventListener("relay:graph-run-readiness", updateGraphRunReadiness);
    onCleanup(() =>
      window.removeEventListener("relay:graph-run-readiness", updateGraphRunReadiness),
    );
  });
  createEffect(() => {
    if (!variablesOpen()) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVariablesOpen(false);
    };
    window.addEventListener("keydown", close);
    requestAnimationFrame(() => variablesDialog?.focus({ preventScroll: true }));
    onCleanup(() => window.removeEventListener("keydown", close));
  });
  // Navigator, Device, and Properties are three contextual side surfaces.
  // Showing more than one at once makes the canvas feel boxed in and leaves
  // no obvious answer to which context is active.
  createEffect(() => {
    if (!navOpen()) return;
    setSettingsOpen(false);
    window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
  });
  // A journey is authored on its graph. The live device remains available
  // inside that workspace, but merely connecting hardware must never change
  // what the user is editing or reopen yesterday's draft on launch.
  let openedRecipeId: string | null | undefined;
  createEffect(() => {
    const id = server.selectedRecipeId();
    if (openedRecipeId === id) return;
    openedRecipeId = id;
    setStudioView("map");
    setSettingsOpen(false);
    setVariablesOpen(false);
    if (id) setNavOpen(false);
  });
  const readinessState = () => ({
    health: server.health(),
    selectedDevice: server.selectedDevice(),
    devices: server.devices(),
    stepCount: draft.steps().length,
    invalidCount: draft.invalidCount(),
  });
  const selectedDeviceReadiness = createMemo(() => {
    const device = server
      .devices()
      .find((candidate) => candidate.serial === server.selectedDevice());
    const liveFrame = server.liveFrame();
    return deviceReadiness(device, server.health() === "online", {
      ...(device?.platform === "ios" ? { appleSetup: server.appleDeviceSetup() } : {}),
      liveCaptureIssue: server.liveCaptureIssue(),
      recordingIssue: recorder.recordingIssue(),
      requireLiveScreen: true,
      liveScreenAvailable:
        Boolean(liveFrame?.base64) && (!liveFrame?.serial || liveFrame.serial === device?.serial),
    });
  });
  const selectedTargetIsReady = () => selectedDeviceReadiness().kind === "ready";
  const openDevicePicker = () => window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
  const testBlockedReason = () => testRunBlocker(readinessState());
  const graphBlockedReason = () => {
    if (server.health() !== "online") return "Server offline";
    if (!selectedTargetIsReady()) return "Choose a ready device";
    if (draft.saveState() === "invalid") return "Fix incomplete actions";
    if (draft.saveState() === "saving") return "Saving…";
    return graphRunReadiness().ready ? "" : graphRunReadiness().reason;
  };
  const runSelectedTest = () => {
    const blocker = studioView() === "map" ? graphBlockedReason() : testBlockedReason();
    if (blocker) {
      toast(blocker, "warning");
      if (
        server.isEmptyDevices() ||
        blocker === "Choose a ready device" ||
        blockerIsDeviceRelated(readinessState())
      ) {
        // Hardware selection is a direct, lightweight decision. Settings is
        // reserved for managing target configuration, never a detour before a
        // normal record or run.
        openDevicePicker();
      }
      return;
    }
    const recipe = selected();
    if (!recipe) return;
    if (studioView() === "map") {
      window.dispatchEvent(new CustomEvent("relay:run-journey-graph"));
      return;
    }
    void server.runRecipeRemote(recipe.id);
  };
  const filteredRecipes = createMemo(() => {
    const needle = query().trim().toLowerCase();
    // Journeys are the work people create and review. Built-in operational
    // commands remain available to the runner, but do not belong in this
    // library beside authored work.
    const rows = server.recipes().filter((recipe) => recipe.source === "custom");
    rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return needle
      ? rows.filter((recipe) =>
          `${recipe.title} ${recipe.description ?? ""}`.toLowerCase().includes(needle),
        )
      : rows;
  });
  async function createTest(record = false): Promise<RecipeInfo | null> {
    if (record && !selectedTargetIsReady()) {
      openDevicePicker();
      return null;
    }
    const saved = await server.saveRecipeRemote({
      title: nextUntitledTitle(server.recipes()),
      steps: [],
    });
    if (!saved) return null;
    server.setSelectedRecipeId(saved.id);
    setArea("tests");
    setStudioView("map");
    setSettingsOpen(false);
    setNavOpen(false);
    if (record) {
      if (selectedTargetIsReady()) recorder.enterRecordMode();
      else window.dispatchEvent(new CustomEvent("relay:open-device-picker"));
    }
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

  function confirmDeleteJourney(recipe: RecipeInfo): void {
    confirmAction({
      title: "Delete journey?",
      body: `“${displayTitle(recipe.title)}” and its version history will be removed. This cannot be undone.`,
      confirmLabel: "Delete journey",
      onConfirm: async () => {
        await server.deleteRecipeRemote(recipe.id);
      },
    });
  }

  function deleteSelected(): void {
    const recipe = selected();
    if (recipe) confirmDeleteJourney(recipe);
  }

  function deleteJourney(id: string): void {
    const recipe = server.recipes().find((item) => item.id === id);
    if (recipe) confirmDeleteJourney(recipe);
  }

  function openRecipe(id: string): void {
    server.setSelectedRecipeId(id);
    setArea("tests");
    setStudioView("map");
    setSettingsOpen(false);
    // The library is for choosing work. Once chosen, give the graph and live
    // device the room; the toolbar button keeps the library one click away.
    setNavOpen(false);
  }

  async function createFlow(): Promise<void> {
    const suite = await server.saveSuiteRemote({
      title: `Collection ${server.suites().length + 1}`,
      sections: [{ title: "Main path", entries: [] }],
    });
    if (!suite) return;
    setArea("suites");
    server.setSelectedSuiteId(suite.id);
  }

  async function reusableEmptyJourney(): Promise<RecipeInfo | null> {
    const candidates = server
      .recipes()
      .filter((recipe) => recipe.source === "custom" && recipe.steps.length === 0)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    for (const candidate of candidates) {
      try {
        const metadata = await server.loadJourney(candidate.id);
        const graph = ensureJourneyGraph(metadata.value, candidate.steps);
        const hasAuthoredContent =
          graph.screens.length > 0 ||
          graph.transitions.length > 0 ||
          Boolean(metadata.value.notes?.length) ||
          Boolean(metadata.value.takes?.length);
        if (!hasAuthoredContent) return candidate;
      } catch {
        // A failed metadata read is not proof that a journey is empty.
      }
    }
    return null;
  }

  /** New journey reuses an untouched blank canvas before creating another
   * durable document. This keeps instant creation without filling the library
   * with abandoned “Untitled journey 19, 20, 21…” entries. */
  async function startNewJourney(): Promise<void> {
    setArea("tests");
    const reusable = await reusableEmptyJourney();
    if (reusable) {
      server.setSelectedRecipeId(reusable.id);
      setStudioView("map");
      setSettingsOpen(false);
      setNavOpen(false);
      return;
    }
    await createTest(false);
  }

  return (
    <div
      class={shellRoot}
      style={shellRootNavVar(navOpen())}
      data-selected-recipe-id={server.selectedRecipeId() ?? ""}
    >
      <div class={shellDragStrip} aria-hidden="true" />

      <JourneyNavigator
        open={navOpen()}
        area={navigatorArea()}
        onArea={(nextArea) => {
          setArea(nextArea);
          // Run history already owns its own filters and result list. Keeping
          // the navigator's second copy open makes the same runs compete in
          // two columns, so the report surface takes focus immediately.
          if (nextArea === "runs") setNavOpen(false);
        }}
        query={query()}
        onQuery={setQuery}
        items={filteredRecipes()}
        selectedId={server.selectedRecipeId()}
        onSelect={openRecipe}
        onDelete={deleteJourney}
        onCreate={startNewJourney}
        onCreateFlow={() => void createFlow()}
        onOpenRun={(id) => server.setSelectedJobId(id)}
        onImport={importTestYaml}
        onOpenSettings={() => props.onOpenSettings()}
      />
      <Show when={navOpen()}>
        <button
          type="button"
          class="fixed inset-0 z-[70] cursor-default bg-black/10 backdrop-blur-[1px]"
          aria-label="Close navigator"
          onClick={() => setNavOpen(false)}
        />
      </Show>

      <main class={shellMain}>
        {/* One toolbar. The journey's name, its view, and its actions used to
            be split across two stacked bars for no reason a user could name. */}
        <header class={cn(shellTopbar, !navOpen() && "pl-[calc(var(--traffic-pad,12px)+18px)]")}>
          <div class={shellTopbarContext}>
            <button
              type="button"
              class={productIconButton}
              aria-label={navOpen() ? "Hide navigator" : "Show navigator"}
              data-tip={navOpen() ? "Hide navigator" : "Show navigator"}
              onClick={() => setNavOpen((value) => !value)}
            >
              <Icon name="panel-left" size={17} />
            </button>
            <div class={shellBreadcrumb}>
              <Show
                when={area() === "tests" && selected()}
                fallback={
                  <strong>
                    {area() === "runs"
                      ? "Run history"
                      : area() === "suites"
                        ? "Collections"
                        : area() === "map"
                          ? "Atlas"
                          : "Journeys"}
                  </strong>
                }
              >
                <input
                  type="text"
                  size={Math.max(
                    12,
                    Math.min(34, (draft.title() || "Untitled journey").length + 1),
                  )}
                  class="h-8 min-w-[120px] max-w-[min(32vw,360px)] rounded-md bg-transparent px-1.5 font-medium text-[var(--text-base)] outline-none transition-[background-color,box-shadow,color] duration-150 placeholder:text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-01)] focus:bg-[var(--v2-background-bg-layer-01)] focus:text-[var(--text-strong)] focus:shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)]"
                  aria-label="Journey name"
                  data-tip="Rename journey"
                  value={draft.title()}
                  placeholder="Untitled journey"
                  spellcheck={false}
                  onFocus={() => {
                    titleBeforeEdit = draft.title();
                  }}
                  onInput={(event) => draft.setTitle(event.currentTarget.value)}
                  onBlur={() => {
                    if (!draft.title().trim()) draft.setTitle("Untitled journey");
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
            <Show when={area() === "tests" && selected()}>
              <Show when={draft.saveState() === "saving" || draft.saveState() === "invalid"}>
                <span class={shellSaveState}>
                  {draft.saveState() === "saving"
                    ? "Saving…"
                    : `${draft.invalidCount()} incomplete`}
                </span>
              </Show>
              <Show when={studioView() === "workbench"}>
                <button
                  type="button"
                  class={cn(productSecondary, "min-h-8 gap-1.5 px-2.5 text-[12px]")}
                  onClick={() => {
                    setSettingsOpen(false);
                    setStudioView("map");
                  }}
                >
                  <Icon name="chevron-left" size={13} /> Back to journey
                </button>
              </Show>
            </Show>
            <Show when={area() === "tests" && selected()}>
              <Show when={studioView() === "map"}>
                <button
                  type="button"
                  aria-pressed={devicePanelOpen()}
                  class={cn(
                    productSecondary,
                    "relative min-h-9 gap-2 px-3 text-[12px] before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']",
                    devicePanelOpen() &&
                      "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                  )}
                  aria-label={devicePanelOpen() ? "Hide device" : "Show device"}
                  data-tip={
                    selectedDeviceReadiness().kind === "ready"
                      ? devicePanelOpen()
                        ? "Hide device"
                        : "Show device"
                      : "Device needs attention"
                  }
                  onClick={() => {
                    setSettingsOpen(false);
                    window.dispatchEvent(new CustomEvent("relay:toggle-device-panel"));
                  }}
                >
                  <i
                    class={cn(
                      "size-1.5 rounded-full",
                      selectedTargetIsReady()
                        ? "bg-[var(--icon-success-base)]"
                        : "bg-[var(--icon-warning-base)]",
                    )}
                    aria-hidden="true"
                  />
                  <Icon name="smartphone" size={14} /> Device
                </button>
              </Show>
              <div class="relative flex items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={settingsOpen()}
                  class={cn(productIconButton, settingsOpen() && "bg-surface-base-active")}
                  aria-label="Journey properties"
                  data-tip="Journey properties"
                  onClick={() => {
                    const opening = !settingsOpen();
                    if (opening) {
                      window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
                    }
                    setSettingsOpen(opening);
                  }}
                >
                  <Icon name="sliders" size={16} />
                </button>
                <button
                  class={productIconButton}
                  type="button"
                  aria-label="More journey options"
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
                      <Icon name="copy" size={14} /> Duplicate journey
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
                      <Icon name="trash" size={14} /> Delete journey
                    </button>
                  </div>
                </Show>
              </div>
              <Show
                when={
                  studioView() === "map" ? graphRunReadiness().visible : draft.steps().length > 0
                }
              >
                <button
                  type="button"
                  class={cn(productPrimary, "min-h-9 px-3.5 text-[12px]")}
                  aria-disabled={
                    (studioView() === "map" ? graphBlockedReason() : testBlockedReason())
                      ? "true"
                      : undefined
                  }
                  data-blocked={
                    (studioView() === "map" ? graphBlockedReason() : testBlockedReason())
                      ? ""
                      : undefined
                  }
                  data-tip={
                    (studioView() === "map" ? graphBlockedReason() : testBlockedReason()) ||
                    graphRunReadiness().label
                  }
                  aria-label={
                    (studioView() === "map" ? graphBlockedReason() : testBlockedReason()) ||
                    graphRunReadiness().label
                  }
                  onClick={runSelectedTest}
                >
                  <Icon name="play" size={13} />
                  {studioView() === "map" ? graphRunReadiness().label : "Run"}
                </button>
              </Show>
            </Show>
          </div>
        </header>

        <Show when={area() === "tests"}>
          <section class={shellStudio}>
            <div
              class={
                selected()
                  ? studioView() === "map"
                    ? "relative flex min-h-0 min-w-0 flex-1"
                    : shellStudioBodyJourney
                  : "grid min-h-0 min-w-0 flex-1 grid-cols-1"
              }
            >
              <Show
                when={selected()}
                fallback={
                  <TestWelcome onStartJourney={startNewJourney} onBrowse={() => setNavOpen(true)} />
                }
              >
                <Show when={studioView() === "workbench"}>
                  <Suspense fallback={<WorkspaceLoading label="actions" />}>
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
                  </Suspense>
                </Show>
                <Show when={studioView() === "map"}>
                  <div class={cn(shellStageWrap, "flex flex-1")}>
                    <JourneyWorkspace
                      navigatorOpen={navOpen()}
                      onOpenTargets={() => props.onOpenSettings("targets")}
                    />
                  </div>
                  <Show when={settingsOpen()}>
                    <TestSettingsPanel
                      presentation="floating"
                      onClose={() => setSettingsOpen(false)}
                      onOpenVariables={() => setVariablesOpen(true)}
                    />
                  </Show>
                </Show>
              </Show>
            </div>
          </section>
        </Show>

        <Show when={area() === "runs"}>
          <Suspense fallback={<WorkspaceLoading label="runs" />}>
            <RunsWorkspace onOpenRecipe={openRecipe} onOpenTests={() => setArea("tests")} />
          </Suspense>
        </Show>
        <Show when={area() === "suites"}>
          <Suspense fallback={<WorkspaceLoading label="collections" />}>
            <SuitesWorkspace
              onOpenTest={openRecipe}
              onOpenRun={(id) => {
                server.setSelectedJobId(id);
                setArea("runs");
              }}
              onOpenTargets={() => props.onOpenSettings("targets")}
              onRecordTest={(suiteId, sectionId) => void recordTestForSuite(suiteId, sectionId)}
            />
          </Suspense>
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
  if (!used.has("Untitled journey")) return "Untitled journey";
  let index = 2;
  while (used.has(`Untitled journey ${index}`)) index++;
  return `Untitled journey ${index}`;
}
