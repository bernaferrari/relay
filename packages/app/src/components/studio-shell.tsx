import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { MatrixExpansion } from "@relay/protocol";
import {
  useServer,
  type JobInfo,
  type PersistedRun,
  type RecipeParameter,
  type RecipeInfo,
} from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { DeviceStage } from "./stage";
import { FrameCanvas } from "./frame-canvas";
import { RecipeStepsEditor } from "./step-list";
import { JourneyWorkspace } from "./journey-workspace";
import { JourneyInspector, JourneyOutline } from "./journey-chrome";
import { DevicePicker } from "./device-picker";
import { LibraryPanel } from "./studio-library";
import { AgentTestComposer } from "./agent-test-composer";
import { DataWorkspace } from "./workspaces/data-workspace";
import { MapsWorkspace } from "./workspaces/maps-workspace";
import { RunSummary } from "./run-summary";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur, displayTitle, titleize } from "../lib/job";
import { toast } from "../context/toast";
import { presentTarget } from "../lib/target-presentation";
import { matrixRunPreview } from "../lib/matrix-presentation";
import { nextRovingIndex } from "../lib/roving-focus";
import { modalPanel, modalScrim } from "../lib/ui";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import { sentenceForStep } from "../lib/step-sentence";
import { runFrameCanvasItems, type FrameCanvasItem } from "../lib/frame-canvas-presentation";
import type { SettingsSection } from "../pages/settings";

type ProductArea = "tests" | "runs" | "map" | "data";
type StudioView = "live" | "journey";

const AREA_ITEMS: { id: ProductArea; label: string; icon: IconName }[] = [
  { id: "tests", label: "Tests", icon: "grid" },
  { id: "runs", label: "Runs", icon: "wave" },
  { id: "map", label: "Map", icon: "move" },
];

export function StudioShell(props: { onOpenSettings: (section?: SettingsSection) => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const [area, setArea] = createSignal<ProductArea>(
    new URLSearchParams(window.location.search).has("run") ? "runs" : "tests",
  );
  const [studioView, setStudioView] = createSignal<StudioView>("live");
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

  const selected = () => server.selectedRecipe();
  const recordBlockedReason = () => {
    if (server.health() !== "online") return "Start the device server before recording";
    if (server.isEmptyDevices() || !server.selectedDevice()) {
      return "Connect or select a device before recording";
    }
    const target = server.devices().find((device) => device.serial === server.selectedDevice());
    if (!target || target.booted === false) return "Start or connect this target before recording";
    return "";
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
    const saved = await server.saveRecipeRemote({
      title: description
        ? titleFromPrompt(description, server.recipes())
        : nextUntitledTitle(server.recipes()),
      description,
      steps: [],
    });
    if (!saved) return;
    server.setSelectedRecipeId(saved.id);
    setNewTestOpen(false);
    setArea("tests");
    setStudioView("live");
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
    setStudioView("live");
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
    setStudioView("live");
    setLibraryOpen(true);
  }

  return (
    <div class={cn("relay-shell", (area() !== "tests" || !libraryOpen()) && "is-library-closed")}>
      <div class="relay-window-drag-strip" aria-hidden="true" />
      <aside class="relay-rail" aria-label="Product navigation">
        <button
          class="relay-mark"
          type="button"
          aria-label="Relay home"
          onClick={() => setArea("tests")}
        >
          <span class="relay-mark__orbit" aria-hidden="true" />
          <span class="relay-mark__dot" aria-hidden="true" />
        </button>
        <nav class="relay-rail__nav">
          <For each={AREA_ITEMS}>
            {(item) => {
              const active = () => area() === item.id;
              return (
                <button
                  type="button"
                  class={cn("relay-rail__item", active() && "is-active")}
                  aria-current={active() ? "page" : undefined}
                  onClick={() => {
                    setArea(item.id);
                    setLibraryOpen(item.id === "tests");
                  }}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </button>
              );
            }}
          </For>
        </nav>
        <div class="relay-rail__foot">
          <button
            type="button"
            class="relay-rail__item relay-rail__settings"
            aria-label="Open settings"
            onClick={() => props.onOpenSettings()}
          >
            <Icon name="sliders" size={19} />
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

      <main class="relay-main">
        <header class="relay-topbar">
          <div class="relay-topbar__context">
            <Show when={area() === "tests" && studioView() === "live"}>
              <button
                type="button"
                class="relay-icon-button"
                aria-label={libraryOpen() ? "Hide test library" : "Show test library"}
                onClick={() => setLibraryOpen((value) => !value)}
              >
                <Icon name="panel-left" size={17} />
              </button>
            </Show>
            <div class="relay-breadcrumb">
              <span>Relay</span>
              <Icon name="chevron-right" size={13} />
              <strong>
                {area() === "runs"
                  ? "Run history"
                  : area() === "map"
                    ? "Product map"
                    : area() === "data"
                      ? "Test data"
                      : selected()
                        ? displayTitle(selected()!.title)
                        : "Test studio"}
              </strong>
            </div>
          </div>
          <div class="relay-topbar__actions">
            <DevicePicker />
            <Show when={area() === "tests" && selected() && studioView() === "live"}>
              <button
                type="button"
                class={cn("relay-record", recorder.recording() && "is-recording")}
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
                    setStudioView("live");
                    recorder.enterRecordMode();
                  }
                }}
              >
                <span class="relay-record__dot" aria-hidden="true" />
                {recorder.recording() ? "Stop recording" : "Record test"}
              </button>
            </Show>
          </div>
        </header>

        <Show when={area() === "tests"}>
          <section class="relay-studio">
            <Show when={selected()}>
              <div class="relay-studio__bar">
                <div class="relay-view-tabs" role="tablist" aria-label="Test view">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studioView() === "live"}
                    class={cn(studioView() === "live" && "is-active")}
                    onClick={() => {
                      setStudioView("live");
                      setLibraryOpen(true);
                    }}
                  >
                    <Icon name="smartphone" size={15} /> Build
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studioView() === "journey"}
                    class={cn(studioView() === "journey" && "is-active")}
                    disabled={draft.steps().length === 0 && server.frames().length === 0}
                    onClick={() => {
                      setStudioView("journey");
                      setLibraryOpen(false);
                    }}
                  >
                    <Icon name="move" size={15} /> Flow
                    <span class="relay-count">
                      {server.frames().length || draft.steps().length}
                    </span>
                  </button>
                </div>
                <div class="relay-studio__tools">
                  <Show when={selected()}>
                    <span class="relay-save-state">
                      {draft.saveState() === "saving"
                        ? "Saving…"
                        : draft.saveState() === "invalid"
                          ? `${draft.invalidCount()} incomplete`
                          : "All changes saved"}
                    </span>
                    <button
                      class="relay-icon-button"
                      type="button"
                      aria-label="More test options"
                      aria-expanded={studioActionsOpen()}
                      onClick={() => setStudioActionsOpen((open) => !open)}
                    >
                      <Icon name="more" size={16} />
                    </button>
                    <Show when={studioActionsOpen()}>
                      <div class="relay-studio-actions-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
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
                          class="is-danger"
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
            <div class={cn("relay-studio__body", studioView() === "journey" && "is-journey")}>
              <Show
                when={selected()}
                fallback={
                  <TestWelcome
                    onCreate={() => setNewTestOpen(true)}
                    onRecord={() => void createTest(true)}
                    onOpenSettings={props.onOpenSettings}
                    recordBlockedReason={recordBlockedReason()}
                  />
                }
              >
                <Show when={studioView() === "journey"}>
                  <JourneyOutline
                    onBack={() => {
                      setStudioView("live");
                      setLibraryOpen(true);
                    }}
                  />
                </Show>
                <div class="relay-stage-wrap">
                  <Show
                    when={studioView() === "live"}
                    fallback={
                      <JourneyWorkspace
                        onLive={() => {
                          setStudioView("live");
                          setLibraryOpen(true);
                        }}
                      />
                    }
                  >
                    <DeviceStage onExpandBoard={() => setStudioView("journey")} />
                  </Show>
                </div>
                <Show
                  when={studioView() === "journey"}
                  fallback={
                    <StepDocument
                      onOpenData={() => setArea("data")}
                      onOpenTargets={() => props.onOpenSettings("matrices")}
                    />
                  }
                >
                  <JourneyInspector
                    onEdit={() => {
                      setStudioView("live");
                      setLibraryOpen(true);
                    }}
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
              class={cn(modalPanel, "relay-import-review")}
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-review-title"
            >
              <header>
                <div>
                  <span class="relay-eyebrow">Relay YAML</span>
                  <h3 id="import-review-title">
                    {review().exists ? "This test already exists" : "Import this test?"}
                  </h3>
                </div>
                <button
                  type="button"
                  class="relay-icon-button"
                  aria-label="Close import review"
                  onClick={() => setImportReview(null)}
                >
                  <Icon name="x" size={14} />
                </button>
              </header>
              <div class="relay-import-review__summary">
                <span class="relay-import-review__icon">
                  <Icon name="check" size={16} />
                </span>
                <div>
                  <strong>{review().recipe.title}</strong>
                  <small>
                    {review().recipe.id} · {review().recipe.steps.length} step
                    {review().recipe.steps.length === 1 ? "" : "s"} · schema valid
                  </small>
                </div>
              </div>
              <details>
                <summary>Preview canonical YAML</summary>
                <pre>{review().canonicalYaml}</pre>
              </details>
              <footer>
                <p>
                  {review().exists
                    ? "Replacing preserves the current definition in version history. Importing a copy creates a new test ID."
                    : "Relay will store the canonical definition in the tracked tests directory."}
                </p>
                <div>
                  <button
                    type="button"
                    class="relay-secondary"
                    onClick={() => setImportReview(null)}
                  >
                    Cancel
                  </button>
                  <Show when={review().exists}>
                    <button
                      type="button"
                      class="relay-secondary"
                      onClick={() => void confirmImport("copy")}
                    >
                      Import copy
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="relay-primary"
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
  const runBlockedReason = () => {
    if (server.health() !== "online") return "Start the Relay server before running this test.";
    if (server.isEmptyDevices() || !server.selectedDevice())
      return "Choose a target before running this test.";
    const target = server.devices().find((device) => device.serial === server.selectedDevice());
    if (!target || target.booted === false) return "Start this target or choose another one.";
    if (draft.steps().length === 0) return "Add at least one step before running this test.";
    if (draft.invalidCount() > 0)
      return `Complete ${draft.invalidCount()} unfinished step${draft.invalidCount() === 1 ? "" : "s"}.`;
    return "";
  };
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
    <aside class="relay-steps" aria-label="Test steps">
      <div class="relay-steps__head">
        <div class="relay-steps__title-row">
          <div>
            <span class="relay-eyebrow">Test</span>
            <input
              aria-label="Test name"
              value={draft.title()}
              spellcheck={false}
              onInput={(event) => draft.setTitle(event.currentTarget.value)}
            />
          </div>
          <div class="relay-run-control">
            <button
              type="button"
              class="relay-run"
              data-blocked={!canRun() ? "" : undefined}
              data-tip={runBlockedReason() || "Run this test"}
              onClick={() => attemptRun(1)}
            >
              <Icon name="play" size={13} /> Run
            </button>
            <button
              type="button"
              class="relay-run relay-run--menu"
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
              <div class="relay-run-menu" role="dialog" aria-label="Run options">
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
                  <section class="relay-run-menu__matrices" aria-label="Test environments">
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
                          <div class="relay-run-matrix">
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
                  <div class="relay-run-menu__empty">
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
        </div>
        <textarea
          aria-label="Test description"
          value={draft.description()}
          placeholder="Add a short description…"
          rows={1}
          spellcheck={false}
          onInput={(event) => draft.setDescription(event.currentTarget.value)}
        />
        <div class="relay-test-health">
          <Show
            when={stability()?.passRate !== null && stability()?.passRate !== undefined}
            fallback={<span>No run baseline yet</span>}
          >
            <span>
              {Math.round((stability()!.passRate ?? 0) * 100)}% stable · {stability()!.total} recent
              runs
            </span>
          </Show>
          <Show when={selected()?.quarantined}>
            <b title={selected()?.quarantineReason}>Quarantined</b>
          </Show>
          <Show when={activeSchedule()}>
            <span>Scheduled daily</span>
          </Show>
          <button
            type="button"
            class="relay-test-health__more"
            aria-label="More test actions"
            aria-expanded={maintenanceOpen()}
            onClick={() => setMaintenanceOpen((open) => !open)}
          >
            <Icon name="more" size={14} />
          </button>
          <Show when={maintenanceOpen()}>
            <div class="relay-test-maintenance-menu" role="menu">
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
        <Show when={historyOpen()}>
          <div class="relay-history-popover">
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
        <div class="mt-1.5 flex items-center gap-4" role="tablist" aria-label="Test editor panels">
          <For each={["steps", "inputs", "yaml"] as const}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === item}
                class={cn(
                  "relative inline-flex min-h-8 items-center gap-1.5 px-0.5 text-[11px]/[1.25] font-semibold text-text-weaker transition-colors after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:scale-x-0 after:rounded-full after:bg-surface-brand-base after:transition-transform hover:text-text-weak focus-visible:outline-1 focus-visible:outline-border-strong-focus",
                  tab() === item && "text-text-base after:scale-x-100",
                )}
                onClick={() => setTab(item)}
              >
                {item === "steps" ? "Steps" : item === "inputs" ? "Inputs" : "YAML"}
                <Show when={item === "steps"}>
                  <span class="min-w-4 rounded-full bg-surface-weak px-1 text-center text-[9px]/4 text-text-weak">
                    {draft.steps().length}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="relay-steps__body" data-editor-tab={tab()}>
        <Show when={tab() === "steps"}>
          <div class="flex h-full min-h-0 flex-col">
            <AgentTestComposer />
            <RecipeStepsEditor />
          </div>
        </Show>
        <Show when={tab() === "inputs"}>
          <div class="relay-inputs-panel">
            <FlowParametersEditor />
            <div class="relay-inputs-panel__variables">
              <div>
                <Icon name="sparkle" size={17} />
                <span>
                  <strong>Workspace variables</strong>
                  <small>
                    Use {"{{variable_name}}"} in any step. Every run preserves its value.
                  </small>
                </span>
              </div>
              <button type="button" class="relay-secondary" onClick={props.onOpenData}>
                Manage variables
              </button>
            </div>
          </div>
        </Show>
        <Show when={tab() === "yaml"}>
          <div class="relay-code-panel">
            <header>
              <span>Source file</span>
              <div class="relay-code-panel__actions">
                <Show when={!yamlEditing()}>
                  <button
                    type="button"
                    disabled={!yamlSource()}
                    onClick={() => void navigator.clipboard?.writeText(yamlSource() ?? "")}
                  >
                    <Icon name="copy" size={13} /> Copy
                  </button>
                  <button type="button" disabled={!yamlSource()} onClick={startYamlEdit}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                </Show>
                <Show when={yamlEditing()}>
                  <button type="button" onClick={cancelYamlEdit} disabled={yamlSaving()}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => void saveYaml()} disabled={yamlSaving()}>
                    {yamlSaving() ? "Saving…" : "Save YAML"}
                  </button>
                </Show>
              </div>
            </header>
            <Show
              when={yamlSource()}
              fallback={<div class="relay-code-panel__loading">Loading canonical YAML…</div>}
            >
              <Show when={yamlEditing()} fallback={<pre>{yamlSource()}</pre>}>
                <textarea
                  class="relay-code-panel__editor"
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
                  <p class={cn("relay-code-panel__message", `is-${message().tone}`)} role="status">
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

function NewTestDialog(props: {
  onClose: () => void;
  onDescribe: (description: string) => void;
  onRecord: () => void;
}) {
  const [description, setDescription] = createSignal("");
  const submit = () => {
    const value = description().trim();
    if (value) props.onDescribe(value);
  };
  return (
    <div class={cn(modalScrim, "relay-new-test-scrim")}>
      <section
        class={cn(modalPanel, "relay-new-test")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-test-title"
      >
        <header>
          <div>
            <span class="relay-eyebrow">New test</span>
            <h2 id="new-test-title">What should Relay verify?</h2>
          </div>
          <button
            type="button"
            class="relay-icon-button"
            aria-label="Close"
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>
        <label>
          <span class="sr-only">Describe the test</span>
          <textarea
            autofocus
            rows={4}
            value={description()}
            placeholder="Sign in with email, open the dashboard, and verify the welcome message"
            onInput={(event) => setDescription(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
            }}
          />
        </label>
        <button
          type="button"
          class="relay-primary relay-new-test__submit"
          disabled={!description().trim()}
          onClick={submit}
        >
          <Icon name="sparkle" size={15} /> Create from description
        </button>
        <div class="relay-new-test__divider">
          <span>or capture the real flow</span>
        </div>
        <button type="button" class="relay-new-test__record" onClick={props.onRecord}>
          <span class="relay-record__dot" aria-hidden="true" />
          <span>
            <strong>Record on a device</strong>
            <small>Use the app normally; every interaction becomes an editable step.</small>
          </span>
          <Icon name="arrow-right" size={15} />
        </button>
        <p>Import and advanced authoring remain available from the test library.</p>
      </section>
    </div>
  );
}

function TestWelcome(props: {
  onCreate: () => void;
  onRecord: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
  recordBlockedReason: string;
}) {
  const server = useServer();
  const selectedDevice = () =>
    server.devices().find((device) => device.serial === server.selectedDevice()) ?? null;
  const target = selectedDevice;
  const targetCopy = () => (target() ? presentTarget(target()!) : null);
  const targetReady = () =>
    Boolean(target()) && server.health() === "online" && target()!.booted !== false;
  return (
    <section class="relay-welcome relay-first-test" aria-labelledby="test-welcome-title">
      <div class="relay-first-test__content">
        <span class="relay-eyebrow">Test studio</span>
        <h2 id="test-welcome-title">Turn a manual flow into a repeatable test.</h2>
        <p>
          {targetReady()
            ? "Press record and use the app normally. Relay captures editable steps as you go."
            : target()
              ? "Start this device, then record the flow exactly as a customer would."
              : "Connect a device or browser. Every tap, swipe, and typed value becomes an editable step."}
        </p>
        <Show when={target()}>
          <div class="relay-first-test__target" aria-live="polite">
            <Icon name={target()!.platform === "browser" ? "server" : "smartphone"} size={17} />
            <div>
              <strong>{targetCopy()!.displayName}</strong>
              <span>{targetReady() ? "Ready to record" : "Needs setup"}</span>
            </div>
            <button
              type="button"
              class="relay-first-test__change"
              onClick={() => props.onOpenSettings("targets")}
            >
              Change
            </button>
          </div>
        </Show>
        <div class="relay-first-test__actions">
          <Show
            when={target()}
            fallback={
              <button
                type="button"
                class="relay-primary"
                onClick={() => props.onOpenSettings("targets")}
              >
                Connect device or browser <Icon name="arrow-right" size={14} />
              </button>
            }
          >
            <Show
              when={targetReady()}
              fallback={
                <button
                  type="button"
                  class="relay-primary"
                  onClick={() => props.onOpenSettings("targets")}
                >
                  Set up this target <Icon name="arrow-right" size={14} />
                </button>
              }
            >
              <button
                class="relay-primary"
                type="button"
                disabled={Boolean(props.recordBlockedReason)}
                data-tip={props.recordBlockedReason || "Record device interactions"}
                onClick={props.onRecord}
              >
                <span class="relay-record__dot" /> Start recording
              </button>
            </Show>
          </Show>
          <button class="relay-first-test__manual" type="button" onClick={props.onCreate}>
            Build without recording
          </button>
        </div>
      </div>
      <div class="relay-welcome__visual relay-first-test__visual" aria-hidden="true">
        <div class="relay-welcome__phone">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div class="relay-pointer-demo">
          <Icon name="pointer" size={30} strokeWidth={1.8} />
          <i />
        </div>
        <div class="relay-welcome__step">
          <span>01</span>
          <strong>Tap “Continue”</strong>
        </div>
      </div>
    </section>
  );
}

function RunsWorkspace(props: { onOpenRecipe: (id: string) => void; onOpenTests: () => void }) {
  const server = useServer();
  const linkedRun = new URLSearchParams(window.location.search).get("run");
  const [selectedId, setSelectedId] = createSignal<string | null>(linkedRun);
  const [selectedRunStep, setSelectedRunStep] = createSignal(0);
  const [tab, setTab] = createSignal<
    "summary" | "replay" | "evaluation" | "network" | "logs" | "compatibility"
  >("summary");
  const [matrixReport, setMatrixReport] = createSignal<
    import("@relay/protocol").CompatibilityReport | null
  >(null);
  const [refreshing, setRefreshing] = createSignal(false);
  async function refreshRuns(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await withRefreshFeedback(async () => {
        await server.refreshJobs();
        await server.refreshRuns();
      });
    } finally {
      setRefreshing(false);
    }
  }
  const rows = createMemo(() => {
    const live = server.jobs();
    const liveIds = new Set(live.map((run) => run.id));
    const disk = server
      .persistedRuns()
      .filter((run) => !liveIds.has(run.id))
      .map(persistedAsJob);
    return [...live, ...disk].sort(
      (a, b) => (b.startedAt ?? b.queuedAt) - (a.startedAt ?? a.queuedAt),
    );
  });
  const selected = () => rows().find((row) => row.id === selectedId()) ?? null;
  const selectedCanvasItems = createMemo(() => {
    const job = selected();
    if (!job) return [];
    return runFrameCanvasItems({
      job,
      persistedFrameUrl: (run, frame) => server.frameUrlForPersisted(run, frame),
    });
  });
  createEffect(() => {
    const requested = server.selectedJobId();
    if (!requested || !rows().some((row) => row.id === requested)) return;
    setSelectedId(requested);
    setSelectedRunStep(0);
    setTab("summary");
  });
  createEffect(() => {
    const job = selected();
    if (tab() !== "compatibility" || !job?.batchId || !job.targetProfile) {
      setMatrixReport(null);
      return;
    }
    void server.loadCompatibilityReport(job.batchId).then(setMatrixReport);
  });
  const baseline = () => {
    const current = selected();
    if (!current) return null;
    return (
      rows().find(
        (row) =>
          row.id !== current.id &&
          row.action === current.action &&
          (row.finishedAt ?? row.startedAt ?? row.queuedAt) <
            (current.finishedAt ?? current.startedAt ?? current.queuedAt),
      ) ?? null
    );
  };
  const onReportTabKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const currentTarget = event.currentTarget as HTMLButtonElement;
    const tablist = currentTarget.closest<HTMLElement>("[role='tablist']");
    const tabs = [...(tablist?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [])];
    if (tabs.length === 0) return;
    event.preventDefault();
    const current = tabs.indexOf(currentTarget);
    const next = nextRovingIndex(event.key, current, tabs.length, "horizontal");
    if (next === null) return;
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <section
      class={cn(
        "relay-page",
        rows().length === 0 && "relay-runs-empty",
        selected() && "relay-runs-workspace-page",
      )}
    >
      <Show when={!selected()}>
        <div class="relay-page__hero">
          <div>
            <span class="relay-eyebrow">Execution</span>
            <h2>Run history</h2>
            <p>See what passed, what needs attention, and why.</p>
          </div>
          <Show when={rows().length > 0}>
            <button
              type="button"
              class="relay-secondary"
              disabled={refreshing()}
              aria-busy={refreshing()}
              onClick={() => void refreshRuns()}
            >
              <Icon
                name="refresh"
                size={15}
                class={refreshing() ? "relay-refresh-icon is-spinning" : "relay-refresh-icon"}
              />{" "}
              Refresh
            </button>
          </Show>
        </div>
      </Show>
      <Show when={rows().length > 0 && !selected()}>
        <div class="mx-auto mb-4 grid w-full max-w-[1180px] grid-cols-3 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger [&>*+*]:border-l [&>*+*]:border-border-weak-base">
          <Metric label="Total runs" value={rows().length} detail="all time" />
          <Metric
            label="Passed"
            value={rows().filter((row) => row.status === "ok" || row.status === "healed").length}
            detail="including healed"
            tone="success"
          />
          <Metric
            label="Needs attention"
            value={rows().filter((row) => row.status === "error").length}
            detail="failed runs"
            tone="danger"
          />
        </div>
      </Show>
      <div
        class={cn(
          "mx-auto grid w-full max-w-[1180px] min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5",
          selected() && "relay-run-workspace max-w-none",
          rows().length === 0 && "place-items-center px-6 py-16",
        )}
      >
        <div
          class={cn(
            "w-full max-w-none overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger",
            rows().length === 0 && "max-w-[680px] rounded-[20px]",
            selected() && "relay-run-library max-h-none overflow-y-auto",
          )}
        >
          <Show when={selected()}>
            <header class="relay-run-library__head">
              <div>
                <span class="relay-eyebrow">Workspace</span>
                <h2>Runs</h2>
              </div>
              <button
                type="button"
                aria-label="Refresh runs"
                disabled={refreshing()}
                onClick={() => void refreshRuns()}
              >
                <Icon
                  name="refresh"
                  size={14}
                  class={refreshing() ? "relay-refresh-icon is-spinning" : "relay-refresh-icon"}
                />
              </button>
            </header>
          </Show>
          <Show when={rows().length > 0 && !selected()}>
            <div class="grid min-h-9.5 grid-cols-[minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.6fr)] items-center gap-4 border-b border-border-weak-base bg-surface-weak px-4 text-[11px]/[1.25] font-semibold tracking-[0.07em] text-text-weaker uppercase [&>span]:min-w-0 [&>span]:truncate">
              <span>Test</span>
              <span>Status</span>
              <span>Device</span>
              <span>Started</span>
              <span>Duration</span>
            </div>
          </Show>
          <For
            each={rows()}
            fallback={
              <div class="relay-runs-first">
                <div class="relay-runs-first__visual" aria-hidden="true">
                  <div class="relay-run-mini-device">
                    <i />
                    <span />
                    <span />
                    <b>Continue</b>
                  </div>
                  <div class="relay-run-mini-trace">
                    <span>
                      <i>01</i>
                      <b>Tap “Continue”</b>
                      <em>248ms</em>
                    </span>
                    <span>
                      <i>02</i>
                      <b>Enter account</b>
                      <em>612ms</em>
                    </span>
                    <span>
                      <i>03</i>
                      <b>Check welcome</b>
                      <em>Passed</em>
                    </span>
                  </div>
                  <div class="relay-run-mini-artifacts">
                    <span>
                      <Icon name="camera" size={13} />
                      <b>3 screenshots</b>
                    </span>
                    <span>
                      <Icon name="wave" size={13} />
                      <b>Network</b>
                    </span>
                    <span>
                      <Icon name="check" size={13} />
                      <b>Saved</b>
                    </span>
                  </div>
                </div>
                <span class="relay-eyebrow">Run history</span>
                <h3>Every run keeps the evidence</h3>
                <p>Run a test to keep its result, replay, diagnostics, and test data together.</p>
                <button type="button" class="relay-primary" onClick={props.onOpenTests}>
                  Run your first test <Icon name="arrow-right" size={14} />
                </button>
              </div>
            }
          >
            {(job) => {
              const open = () => {
                setSelectedId(job.id);
                setSelectedRunStep(0);
                setTab("summary");
              };
              return (
                <Show
                  when={selected()}
                  fallback={<RunRow job={job} selected={selectedId() === job.id} onOpen={open} />}
                >
                  <RunNavigatorRow job={job} selected={selectedId() === job.id} onOpen={open} />
                </Show>
              );
            }}
          </For>
        </div>
        <Show when={selected()}>
          {(job) => (
            <section class="relay-run-canvas-panel min-w-0 overflow-hidden border border-border-weak-base bg-background-stronger">
              <header class="relay-run-canvas-panel__bar flex items-center justify-between gap-3 border-b border-border-weak-base px-3.5">
                <div class="grid min-w-0 gap-1">
                  <strong class="truncate text-[12px]/[1.25] font-semibold text-text-base">
                    {server.recipes().find((recipe) => recipe.id === job().action)?.title ??
                      job().title ??
                      job().action}
                  </strong>
                </div>
                <span class="relay-run-canvas-panel__mode">
                  <Icon name="move" size={13} /> Observed journey
                </span>
                <span class={cn("relay-status", `is-${job().status}`)}>
                  {job().status === "ok" || job().status === "healed"
                    ? "Passed"
                    : job().status === "error"
                      ? "Needs attention"
                      : titleize(job().status)}
                </span>
              </header>
              <div class="relay-run-canvas-panel__body min-h-0 overflow-hidden">
                <Show
                  when={selectedCanvasItems().length > 0}
                  fallback={
                    <RunExecutionCanvas
                      job={job()}
                      selectedIndex={selectedRunStep()}
                      onSelect={setSelectedRunStep}
                    />
                  }
                >
                  <FrameCanvas
                    items={selectedCanvasItems()}
                    selectedIndex={selectedRunStep()}
                    onSelect={setSelectedRunStep}
                    showInspector={false}
                  />
                </Show>
              </div>
            </section>
          )}
        </Show>
        <Show when={selected()}>
          {(job) => (
            <aside class="relay-run-inspector min-w-0 overflow-hidden border border-border-weak-base bg-background-stronger max-[1120px]:col-span-2 max-[820px]:col-span-1">
              <header class="flex min-h-18 items-center justify-between gap-3 px-4 py-3">
                <div class="grid min-w-0 gap-1">
                  <span class="relay-eyebrow">Diagnosis</span>
                  <strong class="truncate text-[16px]/[1.25] font-semibold text-text-base">
                    {server.recipes().find((r) => r.id === job().action)?.title ??
                      job().title ??
                      job().action}
                  </strong>
                  <small class="truncate text-[10px]/[1.25] text-text-weaker">
                    {job().targetProfile?.name ?? job().serial ?? "Target not recorded"} ·{" "}
                    {fmtAgo(job().finishedAt ?? job().startedAt ?? job().queuedAt, server.clock())}
                  </small>
                </div>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px]/[1.25] font-semibold text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-base focus-visible:outline-1 focus-visible:outline-border-strong-focus"
                    aria-label="Copy report link"
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set("run", job().id);
                      void navigator.clipboard?.writeText(url.toString());
                      window.history.replaceState({}, "", url);
                      toast("Report link copied", "success");
                    }}
                  >
                    <Icon name="copy" size={13} /> Copy link
                  </button>
                  <button
                    type="button"
                    class="grid size-10 place-items-center rounded-lg text-text-weaker transition-colors hover:bg-surface-base-hover hover:text-text-base focus-visible:outline-1 focus-visible:outline-border-strong-focus"
                    aria-label="Close report"
                    data-tip="Close report"
                    onClick={() => {
                      setSelectedId(null);
                      const url = new URL(window.location.href);
                      url.searchParams.delete("run");
                      window.history.replaceState({}, "", url);
                    }}
                  >
                    <Icon name="x" size={15} />
                  </button>
                </div>
              </header>
              <RunStateInspector
                job={job()}
                index={selectedRunStep()}
                items={selectedCanvasItems()}
              />
              <nav
                class="flex overflow-x-auto border-b border-border-weak-base px-2.5"
                role="tablist"
                aria-label="Run evidence"
              >
                {(
                  [
                    ["summary", "Summary"],
                    ["evaluation", "Evaluation"],
                    ["network", "Network"],
                    ["logs", "Logs"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    role="tab"
                    id={`run-report-tab-${id}`}
                    aria-controls="run-report-panel"
                    aria-selected={tab() === id}
                    tabindex={tab() === id ? 0 : -1}
                    class={cn(
                      "inline-flex h-9.5 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-[10px]/[1.25] text-text-weaker transition-colors hover:text-text-weak focus-visible:outline-1 focus-visible:outline-border-strong-focus",
                      tab() === id && "border-surface-brand-base text-text-base",
                    )}
                    onClick={() => setTab(id)}
                    onKeyDown={onReportTabKeyDown}
                  >
                    {label}
                    {id === "network" &&
                    (job().artifacts?.filter((a) => a.kind === "network").length ?? 0) > 0 ? (
                      <span class="min-w-4 rounded-full bg-surface-interactive-weak px-1 text-center text-[8px]/4 text-text-interactive-base">
                        {job().artifacts!.filter((a) => a.kind === "network").length}
                      </span>
                    ) : null}
                  </button>
                ))}
                <Show when={job().batchId && job().targetProfile}>
                  <button
                    type="button"
                    role="tab"
                    id="run-report-tab-compatibility"
                    aria-controls="run-report-panel"
                    aria-selected={tab() === "compatibility"}
                    tabindex={tab() === "compatibility" ? 0 : -1}
                    class={cn(
                      "inline-flex h-9.5 shrink-0 items-center border-b-2 border-transparent px-2 text-[10px]/[1.25] text-text-weaker transition-colors hover:text-text-weak focus-visible:outline-1 focus-visible:outline-border-strong-focus",
                      tab() === "compatibility" && "border-surface-brand-base text-text-base",
                    )}
                    onClick={() => setTab("compatibility")}
                    onKeyDown={onReportTabKeyDown}
                  >
                    Matrix
                  </button>
                </Show>
              </nav>
              <div
                id="run-report-panel"
                class="max-h-[570px] overflow-auto p-3.5"
                role="tabpanel"
                aria-labelledby={`run-report-tab-${tab()}`}
                tabindex={0}
              >
                <Show when={tab() === "summary"}>
                  <RunSummary
                    job={job()}
                    clock={server.clock()}
                    previous={baseline()}
                    onOpenRecipe={props.onOpenRecipe}
                    onRetry={(id) => void server.retrySelectedJob(id)}
                  />
                  <details class="group col-span-2 mt-2 border-t border-border-weak-base">
                    <summary class="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-[11px]/[1.25] text-text-weaker focus-visible:outline-1 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
                      <span>More details</span>
                      <Icon
                        name="chevron-down"
                        size={13}
                        class="transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <dl class="m-0 grid gap-2 pb-3">
                      <div class="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2.5">
                        <dt class="min-w-0 text-[10px]/[1.25] text-text-weaker">Run ID</dt>
                        <dd class="m-0 flex min-w-0 items-center gap-1.5">
                          <code class="truncate text-[10px]/[1.25] text-text-weak">{job().id}</code>
                          <button
                            type="button"
                            class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                            aria-label="Copy run ID"
                            onClick={() => void navigator.clipboard?.writeText(job().id)}
                          >
                            <Icon name="copy" size={12} />
                          </button>
                        </dd>
                      </div>
                      <Show when={job().serial}>
                        <div class="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2.5">
                          <dt class="min-w-0 text-[10px]/[1.25] text-text-weaker">
                            Target identifier
                          </dt>
                          <dd class="m-0 flex min-w-0 items-center gap-1.5">
                            <code class="truncate text-[10px]/[1.25] text-text-weak">
                              {job().serial}
                            </code>
                            <button
                              type="button"
                              class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                              aria-label="Copy target identifier"
                              onClick={() => void navigator.clipboard?.writeText(job().serial!)}
                            >
                              <Icon name="copy" size={12} />
                            </button>
                          </dd>
                        </div>
                      </Show>
                      <Show when={job().error}>
                        <div class="grid gap-1 border-t border-border-weak-base pt-2.5">
                          <dt class="min-w-0 text-[10px]/[1.25] text-text-weaker">
                            Technical message
                          </dt>
                          <dd class="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-[10px]/[1.45] text-text-weak">
                            {job().error}
                          </dd>
                        </div>
                      </Show>
                    </dl>
                  </details>
                </Show>
                <Show when={tab() === "replay"}>
                  <RunReplay job={job()} />
                </Show>
                <Show when={tab() === "network"}>
                  <EvidenceList
                    items={job().artifacts?.filter((item) => item.kind === "network") ?? []}
                    empty="No network evidence in this run. Add a Capture network step where the traffic matters."
                  />
                </Show>
                <Show when={tab() === "evaluation"}>
                  <EvidenceList
                    items={
                      job().artifacts?.filter((item) =>
                        [
                          "response-completion",
                          "conversation-turn",
                          "content-assertion",
                          "semantic-evaluation",
                          "judge-consensus",
                          "frozen-inputs",
                          "app-build",
                        ].includes(item.kind),
                      ) ?? []
                    }
                    empty="No conversational evidence yet. Add Extract, Check content, or Evaluate response steps."
                  />
                </Show>
                <Show when={tab() === "logs"}>
                  <pre class="relay-report-log">
                    {job().logs?.join("\n") || "No logs were captured for this run."}
                  </pre>
                </Show>
                <Show when={tab() === "compatibility"}>
                  <CompatibilityReportPanel
                    report={matrixReport()}
                    selectedProfileId={job().targetProfile?.id ?? ""}
                  />
                </Show>
              </div>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
}

function persistedAsJob(run: PersistedRun): JobInfo {
  const status = ["queued", "running", "paused", "ok", "error", "healed", "cancelled"].includes(
    run.status,
  )
    ? (run.status as JobInfo["status"])
    : "error";
  return {
    ...run,
    status,
    queuedAt: run.queuedAt ?? run.startedAt ?? run.writtenAt,
    logs: run.logs ?? [],
    attempts: run.attempts ?? 1,
  };
}

function CompatibilityReportPanel(props: {
  report: import("@relay/protocol").CompatibilityReport | null;
  selectedProfileId: string;
}) {
  return (
    <Show
      when={props.report}
      fallback={<div class="relay-table-empty">Preparing the comparison…</div>}
    >
      {(report) => (
        <div class="relay-compatibility-report">
          <header>
            <div>
              <span class="relay-eyebrow">Compatibility matrix</span>
              <strong>{report().matrixName ?? "Target comparison"}</strong>
              <small>
                {report().profiles.length} target{report().profiles.length === 1 ? "" : "s"} ·{" "}
                {report().total} evidence run{report().total === 1 ? "" : "s"}
              </small>
            </div>
            <span class="relay-compatibility-report__proof">Same test setup</span>
          </header>
          <div class="relay-compatibility-report__grid">
            <For each={report().profiles}>
              {(profile) => (
                <article class={cn(profile.profile.id === props.selectedProfileId && "is-current")}>
                  <header>
                    <div>
                      <strong>{profile.profile.name}</strong>
                      <small>
                        {profile.profile.platform}
                        {profile.profile.osVersion ? ` · ${profile.profile.osVersion}` : ""}
                      </small>
                    </div>
                    <span class={cn("relay-status", profile.passRate === 1 ? "is-ok" : "is-error")}>
                      {profile.passRate == null
                        ? "Pending"
                        : `${Math.round(profile.passRate * 100)}%`}
                    </span>
                  </header>
                  <div class="relay-compatibility-report__metrics">
                    <span>
                      <b>Pass rate</b>
                      <strong>
                        {profile.passRate == null
                          ? "No product verdict yet"
                          : `${Math.round(profile.passRate * 100)}%`}
                      </strong>
                    </span>
                    <span>
                      <b>Median duration</b>
                      <strong>
                        {profile.medianDurationMs == null
                          ? "—"
                          : `${(profile.medianDurationMs / 1000).toFixed(1)}s`}
                      </strong>
                    </span>
                  </div>
                  <p>
                    {profile.passed} passed · {profile.productFailures} product ·{" "}
                    {profile.harnessFailures} harness
                    {profile.uncertain ? ` · ${profile.uncertain} uncertain` : ""}
                    {profile.pending ? ` · ${profile.pending} pending` : ""}
                  </p>
                  <Show when={profile.baseline}>
                    {(baseline) => (
                      <footer>
                        Versus {baseline().total} earlier run{baseline().total === 1 ? "" : "s"}:{" "}
                        {formatPassDelta(baseline().passRateDelta)} ·{" "}
                        {formatDurationDelta(baseline().durationDeltaMs)}
                      </footer>
                    )}
                  </Show>
                </article>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}

function formatPassDelta(value: number | null): string {
  if (value == null) return "no pass-rate baseline";
  const points = Math.round(value * 100);
  return `${points > 0 ? "+" : ""}${points} pts`;
}

function formatDurationDelta(value: number | null): string {
  if (value == null) return "no duration baseline";
  const seconds = value / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}

type RunCanvasState = "passed" | "failed" | "running" | "planned" | "cancelled";

type RunCanvasNode = {
  index: number;
  title: string;
  state: RunCanvasState;
  durationMs?: number;
  frame?: NonNullable<JobInfo["steps"]>[number]["frames"][number];
  observed: boolean;
};

function runCanvasNodes(job: JobInfo, recipes: RecipeInfo[]): RunCanvasNode[] {
  const recipe = job.recipeSnapshot ?? recipes.find((item) => item.id === job.action);
  const observed = job.steps ?? [];
  const count = Math.max(observed.length, recipe?.steps.length ?? 0, 1);

  return Array.from({ length: count }, (_, index) => {
    const trace = observed[index];
    const planned = recipe?.steps[index];
    let state: RunCanvasState = "planned";
    if (trace) {
      if (trace.status === "error" || trace.tone === "danger") state = "failed";
      else if (job.status === "running" && index === observed.length - 1) state = "running";
      else if (job.status === "cancelled" && index === observed.length - 1) state = "cancelled";
      else state = "passed";
    }
    return {
      index,
      title: trace?.title ?? (planned ? sentenceForStep(planned, recipes) : "Run started"),
      state,
      durationMs: trace?.durationMs,
      frame: trace?.frames?.at(-1),
      observed: Boolean(trace),
    };
  });
}

function formatStepDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function RunExecutionCanvas(props: {
  job: JobInfo;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const server = useServer();
  const [zoom, setZoom] = createSignal(0.88);
  const nodes = createMemo(() => runCanvasNodes(props.job, server.recipes()));
  const worldWidth = () => Math.max(700, nodes().length * 248 + 120);
  const markerId = () => `run-arrow-${props.job.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const frameSource = (node: RunCanvasNode) => {
    const frame = node.frame;
    if (!frame) return null;
    if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
    if (props.job.persisted || props.job.runDir) {
      return server.frameUrlForPersisted(props.job as unknown as PersistedRun, frame);
    }
    return null;
  };

  return (
    <div class="relay-run-canvas">
      <div class="relay-run-canvas__hud">
        <div class="relay-run-canvas__legend" aria-label="Canvas legend">
          <span>
            <i class="is-observed" /> Observed
          </span>
          <span>
            <i class="is-planned" /> Planned
          </span>
          <span>
            <i class="is-stopped" /> Stopped
          </span>
        </div>
        <div class="relay-run-canvas__zoom" aria-label="Canvas zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.62, Number((zoom() - 0.1).toFixed(2))))}
          >
            <span aria-hidden="true">−</span>
          </button>
          <button type="button" onClick={() => setZoom(0.88)}>
            {Math.round(zoom() * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(1.18, Number((zoom() + 0.1).toFixed(2))))}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </div>
      <div class="relay-run-canvas__viewport">
        <div
          class="relay-run-canvas__world"
          style={{ width: `${worldWidth()}px`, transform: `scale(${zoom()})` }}
        >
          <svg
            class="relay-run-canvas__edges"
            width={worldWidth()}
            height="420"
            viewBox={`0 0 ${worldWidth()} 420`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={markerId()}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" />
              </marker>
            </defs>
            <For each={nodes().slice(0, -1)}>
              {(node, index) => (
                <path
                  class={cn(
                    "relay-run-canvas__edge",
                    node.state === "failed" && "is-stopped",
                    !nodes()[index() + 1]?.observed && "is-planned",
                  )}
                  d={`M ${236 + index() * 248} 239 C ${255 + index() * 248} 239, ${265 + index() * 248} 239, ${282 + index() * 248} 239`}
                  marker-end={`url(#${markerId()})`}
                />
              )}
            </For>
          </svg>
          <For each={nodes()}>
            {(node, index) => {
              const image = () => frameSource(node);
              return (
                <button
                  type="button"
                  class={cn(
                    "relay-run-state",
                    `is-${node.state}`,
                    props.selectedIndex === index() && "is-selected",
                  )}
                  style={{ left: `${48 + index() * 248}px` }}
                  aria-pressed={props.selectedIndex === index()}
                  onClick={() => props.onSelect(index())}
                >
                  <span class="relay-run-state__label">
                    <i /> State {String(index() + 1).padStart(2, "0")}
                  </span>
                  <span class="relay-run-state__screen">
                    <Show
                      when={image()}
                      fallback={
                        <span class="relay-run-state__placeholder">
                          <Icon name={node.state === "failed" ? "alert" : "camera"} size={21} />
                          <small>{node.observed ? "State observed" : "Not reached"}</small>
                        </span>
                      }
                    >
                      {(source) => <img src={source()} alt="" />}
                    </Show>
                    <span class="relay-run-state__chrome" />
                  </span>
                  <span class="relay-run-state__copy">
                    <strong>{node.title}</strong>
                    <small>
                      {node.state === "passed"
                        ? "Observed"
                        : node.state === "failed"
                          ? "Stopped here"
                          : node.state === "running"
                            ? "In progress"
                            : node.state === "cancelled"
                              ? "Cancelled here"
                              : "Planned · not reached"}
                      {node.durationMs ? ` · ${formatStepDuration(node.durationMs)}` : ""}
                    </small>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
      <div class="relay-run-canvas__minimap" aria-hidden="true">
        <For each={nodes()}>{(node) => <i class={`is-${node.state}`} />}</For>
      </div>
    </div>
  );
}

function RunStateInspector(props: { job: JobInfo; index: number; items: FrameCanvasItem[] }) {
  const server = useServer();
  const nodes = createMemo(() => runCanvasNodes(props.job, server.recipes()));
  const node = createMemo(() => nodes()[props.index]);
  const item = createMemo(() => props.items[props.index]);
  const inspectorTitle = () => item()?.caption ?? node()?.title ?? "Run state";
  const inspectorStatus = () => {
    const status = item()?.status;
    if (status === "fail") return "failed";
    if (status === "pass") return "passed";
    if (status === "heal") return "passed";
    return node()?.state ?? "planned";
  };
  const count = () => (props.items.length > 0 ? props.items.length : nodes().length);
  return (
    <Show when={node() || item()}>
      <div class={cn("relay-run-state-inspector", item()?.src && "has-preview")}>
        <Show when={item()?.src}>
          {(source) => (
            <div class="relay-run-state-inspector__preview">
              <img src={source()} alt={inspectorTitle()} />
              <span>
                <Icon name="camera" size={12} /> Captured evidence
              </span>
            </div>
          )}
        </Show>
        <div class="relay-run-state-inspector__copy">
          <span class={`relay-run-state-inspector__status is-${inspectorStatus()}`}>
            <i /> {inspectorStatus() === "failed" ? "Stopped" : titleize(inspectorStatus())}
          </span>
          <strong>{inspectorTitle()}</strong>
          <small>
            State {props.index + 1} of {count()}
            {node()?.durationMs ? ` · ${formatStepDuration(node()!.durationMs!)}` : ""}
          </small>
        </div>
      </div>
    </Show>
  );
}

function RunReplay(props: { job: JobInfo; workspace?: boolean }) {
  const server = useServer();
  let video: HTMLVideoElement | undefined;
  const files = createMemo(() => {
    const artifact = props.job.artifacts?.find((item) => item.kind === "video");
    if (!artifact || typeof artifact.data !== "object" || artifact.data === null) return [];
    const raw = Reflect.get(artifact.data, "files");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const path = Reflect.get(entry, "path");
      return typeof path === "string" ? [path] : [];
    });
  });
  const firstVideo = () => files()[0];
  const seekToStep = (startedAt: number) => {
    if (!video || !props.job.startedAt) return;
    video.currentTime = Math.max(0, (startedAt - props.job.startedAt) / 1000);
    void video.play();
  };

  return (
    <div class={cn("relay-replay", props.workspace && "is-workspace")}>
      <Show
        when={firstVideo()}
        fallback={
          <div class="relay-replay__empty">
            <div class="relay-replay__empty-device" aria-hidden="true">
              <span />
              <Icon name={props.job.status === "error" ? "alert" : "camera"} size={22} />
            </div>
            <div>
              <strong>
                {props.job.status === "error" ? "This run stopped before replay" : "No replay yet"}
              </strong>
              <span>
                {props.job.status === "error"
                  ? "Review the diagnosis to fix the setup, then run the test again."
                  : "Run this test again with recording enabled to keep the complete interaction."}
              </span>
            </div>
          </div>
        }
      >
        {(path) => (
          <div class="relay-replay__player">
            <video
              ref={(element) => {
                video = element;
              }}
              controls
              playsinline
              preload="metadata"
              src={server.videoUrlForRun(props.job.id, path())}
            >
              Video replay is not supported by this browser.
            </video>
            <div>
              <span class="relay-eyebrow">Device replay</span>
              <strong>Every action stays aligned with its evidence</strong>
            </div>
          </div>
        )}
      </Show>
      <div class="relay-replay-list" aria-label="Run steps">
        <Show when={(props.job.steps?.length ?? 0) > 0}>
          <div class="relay-replay-list__heading">
            <span>Timeline</span>
            <small>{props.job.steps!.length} steps</small>
          </div>
        </Show>
        <For
          each={props.job.steps ?? []}
          fallback={<div class="relay-table-empty">No replay steps captured.</div>}
        >
          {(step, i) => (
            <button type="button" onClick={() => seekToStep(step.startedAt)}>
              <span>{i() + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <small>
                  {step.status ?? "recorded"} · {step.durationMs ? `${step.durationMs}ms` : "—"}
                </small>
              </div>
              <Icon name={step.frames?.[0] ? "camera" : "play"} size={14} />
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function EvidenceList(props: {
  items: { kind: string; capturedAt: number; data: unknown }[];
  empty: string;
}) {
  return (
    <div class="relay-evidence-list">
      <For each={props.items} fallback={<div class="relay-table-empty">{props.empty}</div>}>
        {(item) => (
          <details>
            <summary>
              <span>{new Date(item.capturedAt).toLocaleTimeString()}</span>
              <strong>{item.kind}</strong>
              <Icon name="chevron-down" size={13} />
            </summary>
            <pre>{JSON.stringify(item.data, null, 2)}</pre>
          </details>
        )}
      </For>
    </div>
  );
}

function RunRow(props: { job: JobInfo; selected: boolean; onOpen: () => void }) {
  const server = useServer();
  const recipe = () => server.recipes().find((item) => item.id === props.job.action);
  const targetName = () => {
    if (props.job.targetProfile?.name) return props.job.targetProfile.name;
    const target = server.devices().find((device) => device.serial === props.job.serial);
    return target
      ? presentTarget(target).displayName
      : props.job.serial
        ? "Unavailable target"
        : "—";
  };
  const status = () =>
    props.job.outcome
      ? titleize(props.job.outcome)
      : props.job.status === "ok"
        ? "Passed"
        : props.job.status === "error"
          ? "Failed"
          : titleize(props.job.status);
  return (
    <button
      type="button"
      class={cn(
        "grid min-h-14.5 w-full grid-cols-[minmax(0,1.5fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.6fr)] items-center gap-4 border-b border-border-weak-base px-4 text-left text-[11px]/[1.35] text-text-weak transition-colors last:border-b-0 hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus [&>span]:min-w-0 [&>span]:truncate",
        props.selected && "bg-surface-base-active",
      )}
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onOpen}
    >
      <span class="min-w-0">
        <strong class="block truncate text-[12px]/[1.25] font-[550] text-text-base">
          {recipe()?.title ?? props.job.action}
        </strong>
        <Show when={props.job.appVersion}>
          <small class="mt-1 block truncate font-mono text-[9px]/[1.25] text-text-weaker">
            Build {props.job.appVersion}
          </small>
        </Show>
      </span>
      <span class={cn("relay-status", `is-${props.job.status}`)}>{status()}</span>
      <span>{targetName()}</span>
      <span>{fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "now"}</span>
      <span>{fmtDur(props.job, server.clock()) || "—"}</span>
    </button>
  );
}

function RunNavigatorRow(props: { job: JobInfo; selected: boolean; onOpen: () => void }) {
  const server = useServer();
  const recipe = () => server.recipes().find((item) => item.id === props.job.action);
  const passed = () => props.job.status === "ok" || props.job.status === "healed";
  return (
    <button
      type="button"
      class={cn(
        "grid min-h-14 w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-2.5 border-b border-border-weak-base px-3 text-left transition-colors last:border-b-0 hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
        props.selected && "bg-surface-base-active",
      )}
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onOpen}
    >
      <span
        class={cn(
          "size-2 rounded-full bg-text-weaker",
          passed() && "bg-text-success-base",
          props.job.status === "error" && "bg-text-critical-base",
        )}
        aria-hidden="true"
      />
      <span class="grid min-w-0 gap-1">
        <strong class="truncate text-[11px]/[1.25] font-[550] text-text-base">
          {recipe()?.title ?? props.job.title ?? props.job.action}
        </strong>
        <small class="truncate text-[9px]/[1.25] text-text-weaker">
          {fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "now"} ·{" "}
          {fmtDur(props.job, server.clock()) || "—"}
        </small>
      </span>
    </button>
  );
}

function Metric(props: {
  label: string;
  value: number;
  detail: string;
  tone?: "success" | "danger";
}) {
  return (
    <div class="grid min-w-0 grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5 px-3.5 py-2.5">
      <span class="col-start-2 row-start-1 text-[11px]/[1.25] text-text-weak">{props.label}</span>
      <strong
        class={cn(
          "col-start-1 row-span-2 row-start-1 self-center text-[20px]/none font-semibold tracking-[-0.04em] text-text-base",
          props.tone === "success" && "text-text-success-base",
          props.tone === "danger" && "text-text-critical-base",
        )}
      >
        {props.value}
      </strong>
      <small class="col-start-2 row-start-2 text-[10px]/[1.25] text-text-weaker">
        {props.detail}
      </small>
    </div>
  );
}

/** Inputs make a recorded recipe an attachable reusable flow. The UI keeps the
 * declaration deliberately small: names are Git-visible, defaults are safe
 * data, and callers bind actual frozen values at the attachment point. */
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

  return (
    <div class="relay-flow-inputs">
      <header>
        <div>
          <span class="relay-eyebrow">Reusable flow</span>
          <h3>Inputs</h3>
          <p>
            Optional values callers can provide when they use this flow, such as{" "}
            <code>{"{{login_email}}"}</code>.
          </p>
        </div>
        <button type="button" class="relay-secondary relay-flow-inputs__add" onClick={add}>
          <Icon name="plus" size={14} /> Add input
        </button>
      </header>
      <Show
        when={draft.parameters().length > 0}
        fallback={
          <div class="relay-flow-inputs__empty">
            <span class="relay-flow-inputs__empty-mark" aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
            <div>
              <strong>No inputs yet</strong>
              <span>
                This flow is ready to attach. Add an input only when a caller needs to provide a
                value.
              </span>
            </div>
          </div>
        }
      >
        <div class="relay-flow-inputs__list">
          <Index each={draft.parameters()}>
            {(parameter, index) => (
              <article>
                <div class="relay-flow-inputs__row">
                  <label>
                    <span>Variable name</span>
                    <input
                      class="font-mono"
                      value={parameter().name}
                      placeholder="login_email"
                      onInput={(event) => patch(index, { name: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    <span>Label</span>
                    <input
                      value={parameter().label ?? ""}
                      placeholder="Login email"
                      onInput={(event) =>
                        patch(index, { label: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label class="relay-flow-inputs__required">
                    <input
                      type="checkbox"
                      checked={parameter().required === true}
                      onChange={(event) => patch(index, { required: event.currentTarget.checked })}
                    />
                    <span>Required</span>
                  </label>
                  <button
                    type="button"
                    class="relay-icon-button relay-icon-button--danger"
                    aria-label={`Remove ${parameter().label || parameter().name}`}
                    onClick={() => remove(index)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                <div class="relay-flow-inputs__row relay-flow-inputs__row--detail">
                  <label>
                    <span>Default</span>
                    <input
                      class="font-mono"
                      value={parameter().default ?? ""}
                      placeholder="Optional safe default"
                      onInput={(event) =>
                        patch(index, { default: event.currentTarget.value || undefined })
                      }
                    />
                  </label>
                  <label>
                    <span>Guidance</span>
                    <input
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
          <p class="relay-flow-inputs__error" role="alert">
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
