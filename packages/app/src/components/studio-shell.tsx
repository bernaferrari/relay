import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { TestVariable } from "@relay/protocol";
import { useServer, type JobInfo, type RecipeInfo, type RecipeStep } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { DeviceStage } from "./stage";
import { RecipeStepsEditor } from "./step-list";
import { JourneyWorkspace } from "./journey-workspace";
import { DevicePicker } from "./device-picker";
import { LibraryPanel } from "./studio-library";
import { AgentTestComposer } from "./agent-test-composer";
import { Icon, type IconName } from "./icon";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur, displayTitle, titleize } from "../lib/job";
import { toast } from "../context/toast";

type ProductArea = "tests" | "workflows" | "runs" | "data";
type StudioView = "live" | "journey";

const AREA_ITEMS: { id: ProductArea; label: string; icon: IconName }[] = [
  { id: "tests", label: "Tests", icon: "grid" },
  { id: "workflows", label: "Flows", icon: "move" },
  { id: "runs", label: "Runs", icon: "wave" },
  { id: "data", label: "Data", icon: "sparkle" },
];

export function StudioShell(props: { onOpenSettings: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const recorder = useRecorder();
  const [area, setArea] = createSignal<ProductArea>(
    new URLSearchParams(window.location.search).has("run") ? "runs" : "tests",
  );
  const [studioView, setStudioView] = createSignal<StudioView>("live");
  const [query, setQuery] = createSignal("");
  const [libraryOpen, setLibraryOpen] = createSignal(true);

  const selected = () => server.selectedRecipe();
  const recordBlockedReason = () => {
    if (server.health() !== "online") return "Start the device server before recording";
    if (server.isEmptyDevices() || !server.selectedDevice()) {
      return "Connect or select a device before recording";
    }
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
  async function createTest(record = false): Promise<void> {
    const saved = await server.saveRecipeRemote({
      title: nextUntitledTitle(server.recipes()),
      description: "",
      steps: [],
    });
    if (!saved) return;
    server.setSelectedRecipeId(saved.id);
    setArea("tests");
    setStudioView("live");
    if (record) recorder.enterRecordMode();
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
            {(item) => (
              <button
                type="button"
                class={cn("relay-rail__item", area() === item.id && "is-active")}
                aria-current={area() === item.id ? "page" : undefined}
                onClick={() => setArea(item.id)}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </nav>
        <div class="relay-rail__foot">
          <button
            type="button"
            class="relay-rail__item relay-rail__settings"
            aria-label="Open settings"
            onClick={props.onOpenSettings}
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
          onCreate={() => void createTest(false)}
        />
      </Show>

      <main class="relay-main">
        <header class="relay-topbar">
          <div class="relay-topbar__context">
            <Show when={area() === "tests"}>
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
                {area() === "tests"
                  ? selected()
                    ? displayTitle(selected()!.title)
                    : "Test studio"
                  : area() === "runs"
                    ? "Run history"
                    : area() === "workflows"
                      ? "Reusable flows"
                      : "Test data"}
              </strong>
            </div>
          </div>
          <div class="relay-topbar__actions">
            <DevicePicker />
            <Show when={area() === "tests"}>
              <button
                type="button"
                class={cn("relay-record", recorder.recording() && "is-recording")}
                disabled={!recorder.recording() && Boolean(recordBlockedReason())}
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
          <Show
            when={selected()}
            fallback={
              <TestWelcome
                onCreate={() => void createTest(false)}
                onRecord={() => void createTest(true)}
              />
            }
          >
            <section class="relay-studio">
              <div class="relay-studio__bar">
                <div class="relay-view-tabs" role="tablist" aria-label="Test view">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studioView() === "live"}
                    class={cn(studioView() === "live" && "is-active")}
                    onClick={() => setStudioView("live")}
                  >
                    <Icon name="smartphone" size={15} /> Live device
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={studioView() === "journey"}
                    class={cn(studioView() === "journey" && "is-active")}
                    disabled={draft.steps().length === 0 && server.frames().length === 0}
                    onClick={() => setStudioView("journey")}
                  >
                    <Icon name="move" size={15} /> Journey
                    <span class="relay-count">
                      {server.frames().length || draft.steps().length}
                    </span>
                  </button>
                </div>
                <div class="relay-studio__tools">
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
                    aria-label="Duplicate test"
                    data-tip="Duplicate test"
                    onClick={() => void duplicateSelected()}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                  <button
                    class="relay-icon-button relay-icon-button--danger"
                    type="button"
                    aria-label="Delete test"
                    data-tip="Delete test"
                    onClick={() => void deleteSelected()}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
              <div class="relay-studio__body">
                <div class="relay-stage-wrap">
                  <Show
                    when={studioView() === "live"}
                    fallback={<JourneyWorkspace onLive={() => setStudioView("live")} />}
                  >
                    <DeviceStage onExpandBoard={() => setStudioView("journey")} />
                  </Show>
                </div>
                <StepDocument onOpenData={() => setArea("data")} />
              </div>
            </section>
          </Show>
        </Show>

        <Show when={area() === "runs"}>
          <RunsWorkspace onOpenRecipe={openRecipe} onOpenTests={() => setArea("tests")} />
        </Show>
        <Show when={area() === "workflows"}>
          <WorkflowsWorkspace onOpenRecipe={openRecipe} />
        </Show>
        <Show when={area() === "data"}>
          <DataWorkspace onConfigureProvider={props.onOpenSettings} />
        </Show>
      </main>
    </div>
  );
}

function StepDocument(props: { onOpenData: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const [tab, setTab] = createSignal<"steps" | "variables" | "yaml" | "logs">("steps");
  const selected = () => server.selectedRecipe();
  const canRun = () =>
    server.health() === "online" &&
    !server.isEmptyDevices() &&
    draft.invalidCount() === 0 &&
    draft.steps().length > 0;
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
          <button
            type="button"
            class="relay-run"
            disabled={!canRun()}
            onClick={() => selected() && void server.runRecipeRemote(selected()!.id)}
          >
            <Icon name="play" size={13} /> Run
          </button>
        </div>
        <textarea
          aria-label="Test description"
          value={draft.description()}
          placeholder="Add a short description…"
          rows={1}
          spellcheck={false}
          onInput={(event) => draft.setDescription(event.currentTarget.value)}
        />
        <div class="relay-editor-tabs" role="tablist" aria-label="Test editor panels">
          <For each={["steps", "variables", "yaml", "logs"] as const}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === item}
                class={cn(tab() === item && "is-active")}
                onClick={() => setTab(item)}
              >
                {item === "steps" ? "Steps" : item === "yaml" ? "YAML" : titleize(item)}
                <Show when={item === "steps"}>
                  <span>{draft.steps().length}</span>
                </Show>
                <Show when={item === "logs" && server.logs().length > 0}>
                  <span>{Math.min(server.logs().length, 99)}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="relay-steps__body" data-editor-tab={tab()}>
        <Show when={tab() === "steps"}>
          <div class="relay-steps-editor-stack">
            <AgentTestComposer />
            <RecipeStepsEditor />
          </div>
        </Show>
        <Show when={tab() === "variables"}>
          <div class="relay-editor-empty">
            <span>
              <Icon name="sparkle" size={20} />
            </span>
            <strong>Use test data in any step</strong>
            <p>
              Reference resolved values with <code>{"{{variable_name}}"}</code>. Every run stores
              the exact value it used.
            </p>
            <button type="button" class="relay-secondary" onClick={props.onOpenData}>
              Manage variables
            </button>
          </div>
        </Show>
        <Show when={tab() === "yaml"}>
          <div class="relay-code-panel">
            <header>
              <span>Exportable test definition</span>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard?.writeText(recipeToYaml(draft.title(), draft.steps()))
                }
              >
                <Icon name="copy" size={13} /> Copy
              </button>
            </header>
            <pre>{recipeToYaml(draft.title(), draft.steps())}</pre>
          </div>
        </Show>
        <Show when={tab() === "logs"}>
          <div class="relay-code-panel relay-code-panel--logs">
            <header>
              <span>Device and execution log</span>
              <button type="button" onClick={() => server.clearLogs()}>
                Clear
              </button>
            </header>
            <Show
              when={server.logs().length > 0}
              fallback={
                <div class="relay-log-empty">
                  Logs will stream here while you drive or run the device.
                </div>
              }
            >
              <pre>
                <For each={server.logs()}>
                  {(line) => (
                    <span data-level={line.level}>
                      {new Date(line.at).toLocaleTimeString()} {line.text}
                      {"\n"}
                    </span>
                  )}
                </For>
              </pre>
            </Show>
          </div>
        </Show>
      </div>
    </aside>
  );
}

function TestWelcome(props: { onCreate: () => void; onRecord: () => void }) {
  return (
    <section class="relay-welcome">
      <div class="relay-welcome__visual" aria-hidden="true">
        <div class="relay-welcome__phone">
          <span />
          <span />
          <span />
        </div>
        <div class="relay-pointer-demo">
          <svg width="24" height="28" viewBox="0 0 24 28" aria-hidden="true">
            <path
              d="M2 2.2v20.5l5.3-5.1 3.5 8.1 4.2-1.9-3.5-7.8h7.2L2 2.2Z"
              fill="#111318"
              stroke="#fff"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
          </svg>
          <i />
        </div>
        <div class="relay-welcome__step">
          01 <strong>Tap “Continue”</strong>
        </div>
      </div>
      <div class="relay-welcome__copy">
        <span class="relay-eyebrow">Test studio</span>
        <h2>Turn a manual flow into a repeatable test.</h2>
        <p>
          Connect a device, press record, and use the app normally. Every tap, swipe, and typed
          value becomes an editable step with evidence.
        </p>
        <div>
          <button class="relay-primary" type="button" onClick={props.onRecord}>
            <span class="relay-record__dot" /> Record your first test
          </button>
          <button class="relay-secondary" type="button" onClick={props.onCreate}>
            Build manually
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkflowsWorkspace(props: { onOpenRecipe: (id: string) => void }) {
  const server = useServer();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal("");
  const workflows = createMemo(() =>
    server
      .recipes()
      .filter(
        (recipe) =>
          recipe.description?.startsWith("Workflow ·") ||
          (recipe.steps.length > 0 && recipe.steps.every((step) => step.kind === "module")),
      ),
  );
  const selected = () =>
    workflows().find((item) => item.id === selectedId()) ?? workflows()[0] ?? null;

  createEffect(() => {
    if (!selectedId() && workflows()[0]) setSelectedId(workflows()[0]!.id);
  });

  async function createWorkflow(): Promise<void> {
    const saved = await server.saveRecipeRemote({
      title: `Workflow ${workflows().length + 1}`,
      description: "Workflow · Run reusable tests in order",
      steps: [],
    });
    if (saved) setSelectedId(saved.id);
  }

  async function replaceSteps(recipe: RecipeInfo, steps: RecipeStep[]): Promise<void> {
    await server.saveRecipeRemote({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      steps,
    });
  }

  async function duplicateWorkflow(recipe: RecipeInfo): Promise<void> {
    const saved = await server.saveRecipeRemote({
      title: `${recipe.title} copy`,
      description: recipe.description,
      steps: recipe.steps,
    });
    if (saved) setSelectedId(saved.id);
  }

  async function deleteWorkflow(recipe: RecipeInfo): Promise<void> {
    if (!window.confirm(`Delete “${recipe.title}”? This cannot be undone.`)) return;
    await server.deleteRecipeRemote(recipe.id);
    setSelectedId(null);
  }

  return (
    <section class="relay-page relay-workflows">
      <div class="relay-page__hero relay-workflow-hero">
        <div>
          <h2>Reusable flows</h2>
          <p>Chain tests into reliable journeys without duplicating a single step.</p>
        </div>
        <Show when={workflows().length > 0}>
          <button type="button" class="relay-primary" onClick={() => void createWorkflow()}>
            <Icon name="plus" size={15} /> New workflow
          </button>
        </Show>
      </div>
      <div class={cn("relay-workflow-layout", workflows().length === 0 && "is-empty")}>
        <aside class="relay-workflow-list">
          <For each={workflows()} fallback={<div class="relay-table-empty">No workflows yet.</div>}>
            {(workflow) => (
              <button
                type="button"
                class={cn(selected()?.id === workflow.id && "is-active")}
                onClick={() => setSelectedId(workflow.id)}
              >
                <span>
                  <strong>{workflow.title}</strong>
                  <small>
                    {workflow.steps.length} test{workflow.steps.length === 1 ? "" : "s"}
                  </small>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            )}
          </For>
        </aside>
        <Show
          when={selected()}
          fallback={
            <div class="relay-workflow-empty relay-workflow-onboarding">
              <div class="relay-workflow-onboarding__visual" aria-hidden="true">
                <span>
                  <Icon name="login" size={17} />
                  <b>Sign in</b>
                </span>
                <Icon name="arrow-right" size={15} />
                <span>
                  <Icon name="bag" size={17} />
                  <b>Checkout</b>
                </span>
                <Icon name="arrow-right" size={15} />
                <span>
                  <Icon name="check" size={17} />
                  <b>Verify</b>
                </span>
              </div>
              <span class="relay-eyebrow">Reusable building blocks</span>
              <h3>Turn trusted tests into complete journeys</h3>
              <p>
                Add existing tests, arrange their order, and run the whole sequence. Edit a test
                once and every flow automatically stays current.
              </p>
              <button type="button" class="relay-primary" onClick={() => void createWorkflow()}>
                <Icon name="plus" size={15} /> Create your first flow
              </button>
            </div>
          }
        >
          {(workflow) => (
            <div class="relay-workflow-builder">
              <header>
                <div>
                  <span class="relay-eyebrow">Workflow</span>
                  <input
                    aria-label="Workflow title"
                    value={workflow().title}
                    onChange={(e) =>
                      void server.saveRecipeRemote({
                        id: workflow().id,
                        title: e.currentTarget.value,
                        description: workflow().description,
                        steps: workflow().steps,
                      })
                    }
                  />
                </div>
                <div>
                  <button
                    type="button"
                    class="relay-icon-button"
                    aria-label="Duplicate workflow"
                    data-tip="Duplicate workflow"
                    onClick={() => void duplicateWorkflow(workflow())}
                  >
                    <Icon name="copy" size={14} />
                  </button>
                  <button
                    type="button"
                    class="relay-icon-button relay-icon-button--danger"
                    aria-label="Delete workflow"
                    data-tip="Delete workflow"
                    onClick={() => void deleteWorkflow(workflow())}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                  <button
                    type="button"
                    class="relay-secondary"
                    onClick={() => props.onOpenRecipe(workflow().id)}
                  >
                    Open as test
                  </button>
                  <button
                    type="button"
                    class="relay-primary"
                    onClick={() => void server.runRecipeRemote(workflow().id)}
                  >
                    <Icon name="play" size={13} /> Run sequence
                  </button>
                </div>
              </header>
              <div class="relay-workflow-steps">
                <For
                  each={workflow().steps}
                  fallback={
                    <div class="relay-workflow-empty">
                      <strong>No tests in this workflow</strong>
                      <p>Add tests below; they run top to bottom.</p>
                    </div>
                  }
                >
                  {(step, index) => (
                    <Show when={step.kind === "module" ? step : null}>
                      {(module) => {
                        const child = () =>
                          server.recipes().find((r) => r.id === module().recipeId);
                        return (
                          <div class="relay-workflow-step">
                            <span>{index() + 1}</span>
                            <Icon name="bolt" size={15} />
                            <div>
                              <strong>{child()?.title ?? module().recipeId}</strong>
                              <small>{child()?.steps.length ?? 0} steps</small>
                            </div>
                            <div class="relay-workflow-step__actions">
                              <button
                                type="button"
                                aria-label="Move up"
                                disabled={index() === 0}
                                onClick={() => {
                                  const next = [...workflow().steps];
                                  [next[index() - 1], next[index()]] = [
                                    next[index()]!,
                                    next[index() - 1]!,
                                  ];
                                  void replaceSteps(workflow(), next);
                                }}
                              >
                                <Icon name="chevron-up" size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label="Move down"
                                disabled={index() === workflow().steps.length - 1}
                                onClick={() => {
                                  const next = [...workflow().steps];
                                  [next[index()], next[index() + 1]] = [
                                    next[index() + 1]!,
                                    next[index()]!,
                                  ];
                                  void replaceSteps(workflow(), next);
                                }}
                              >
                                <Icon name="chevron-down" size={13} />
                              </button>
                              <button
                                type="button"
                                aria-label="Remove from workflow"
                                onClick={() =>
                                  void replaceSteps(
                                    workflow(),
                                    workflow().steps.filter((_, i) => i !== index()),
                                  )
                                }
                              >
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      }}
                    </Show>
                  )}
                </For>
              </div>
              <footer>
                <select
                  aria-label="Test to add"
                  value={adding()}
                  onChange={(e) => setAdding(e.currentTarget.value)}
                >
                  <option value="">Choose a test…</option>
                  <For
                    each={server
                      .recipes()
                      .filter(
                        (recipe) =>
                          recipe.id !== workflow().id &&
                          !workflows().some((flow) => flow.id === recipe.id),
                      )}
                  >
                    {(recipe) => <option value={recipe.id}>{recipe.title}</option>}
                  </For>
                </select>
                <button
                  type="button"
                  class="relay-secondary"
                  disabled={!adding()}
                  onClick={() => {
                    if (!adding()) return;
                    void replaceSteps(workflow(), [
                      ...workflow().steps,
                      { kind: "module", recipeId: adding() },
                    ]);
                    setAdding("");
                  }}
                >
                  <Icon name="plus" size={14} /> Add test
                </button>
              </footer>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}

function RunsWorkspace(props: { onOpenRecipe: (id: string) => void; onOpenTests: () => void }) {
  const server = useServer();
  const linkedRun = new URLSearchParams(window.location.search).get("run");
  const [selectedId, setSelectedId] = createSignal<string | null>(linkedRun);
  const [tab, setTab] = createSignal<"summary" | "replay" | "network" | "logs">("summary");
  const rows = createMemo(() =>
    [...server.jobs()].sort((a, b) => (b.startedAt ?? b.queuedAt) - (a.startedAt ?? a.queuedAt)),
  );
  const selected = () => rows().find((row) => row.id === selectedId()) ?? null;
  return (
    <section class={cn("relay-page", rows().length === 0 && "relay-runs-empty")}>
      <div class="relay-page__hero">
        <div>
          <span class="relay-eyebrow">Execution</span>
          <h2>Run history</h2>
          <p>Every result, device, duration, and recovery attempt in one place.</p>
        </div>
        <Show when={rows().length > 0}>
          <button type="button" class="relay-secondary" onClick={() => void server.refreshJobs()}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </Show>
      </div>
      <div class="relay-metrics">
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
      <div class={cn("relay-run-layout", selected() && "has-detail")}>
        <div class="relay-run-table">
          <div class="relay-run-table__head">
            <span>Test</span>
            <span>Status</span>
            <span>Device</span>
            <span>Started</span>
            <span>Duration</span>
          </div>
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
                      <b>Immutable</b>
                    </span>
                  </div>
                </div>
                <span class="relay-eyebrow">Replayable evidence</span>
                <h3>Every run becomes proof</h3>
                <p>
                  Execute a test to preserve its steps, screenshots, logs, network activity, and
                  resolved data in one immutable report.
                </p>
                <button type="button" class="relay-primary" onClick={props.onOpenTests}>
                  Run your first test <Icon name="arrow-right" size={14} />
                </button>
              </div>
            }
          >
            {(job) => (
              <RunRow
                job={job}
                selected={selectedId() === job.id}
                onOpen={() => {
                  setSelectedId(job.id);
                  setTab("summary");
                }}
              />
            )}
          </For>
        </div>
        <Show when={selected()}>
          {(job) => (
            <aside class="relay-run-detail">
              <header>
                <div>
                  <span class="relay-eyebrow">Immutable report</span>
                  <strong>
                    {server.recipes().find((r) => r.id === job().action)?.title ??
                      job().title ??
                      job().action}
                  </strong>
                  <small>{job().id}</small>
                </div>
                <div class="relay-run-detail__actions">
                  <button
                    type="button"
                    aria-label="Copy report link"
                    data-tip="Copy report link"
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.set("run", job().id);
                      void navigator.clipboard?.writeText(url.toString());
                      window.history.replaceState({}, "", url);
                      toast("Report link copied", "success");
                    }}
                  >
                    <Icon name="copy" size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Close report"
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
              <nav role="tablist" aria-label="Run evidence">
                {(
                  [
                    ["summary", "Summary"],
                    ["replay", "Replay"],
                    ["network", "Network"],
                    ["logs", "Logs"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === id}
                    class={cn(tab() === id && "is-active")}
                    onClick={() => setTab(id)}
                  >
                    {label}
                    {id === "network" &&
                    (job().artifacts?.filter((a) => a.kind === "network").length ?? 0) > 0 ? (
                      <span>{job().artifacts!.filter((a) => a.kind === "network").length}</span>
                    ) : null}
                  </button>
                ))}
              </nav>
              <div class="relay-run-detail__body">
                <Show when={tab() === "summary"}>
                  <div class="relay-report-summary">
                    <div>
                      <span>Status</span>
                      <strong class={cn("relay-status", `is-${job().status}`)}>
                        {titleize(job().status)}
                      </strong>
                    </div>
                    <div>
                      <span>Duration</span>
                      <strong>{fmtDur(job(), server.clock()) || "—"}</strong>
                    </div>
                    <div>
                      <span>Device</span>
                      <strong>{job().serial ?? "—"}</strong>
                    </div>
                    <div>
                      <span>Attempts</span>
                      <strong>{job().attempts ?? 1}</strong>
                    </div>
                    <p>
                      Recipe, selected device, steps, logs, screenshots, and observability payloads
                      are frozen with this run.
                    </p>
                    <Show when={Object.keys(job().resolvedInputs ?? {}).length > 0}>
                      <div class="relay-report-inputs">
                        <span>Resolved inputs</span>
                        <For each={Object.entries(job().resolvedInputs ?? {})}>
                          {([name, value]) => (
                            <code>
                              <b>{name}</b>
                              {value}
                            </code>
                          )}
                        </For>
                      </div>
                    </Show>
                    <button
                      type="button"
                      class="relay-secondary"
                      onClick={() => props.onOpenRecipe(job().action)}
                    >
                      Open editable test
                    </button>
                  </div>
                </Show>
                <Show when={tab() === "replay"}>
                  <div class="relay-replay-list">
                    <For
                      each={job().steps ?? []}
                      fallback={<div class="relay-table-empty">No replay steps captured.</div>}
                    >
                      {(step, i) => (
                        <div>
                          <span>{i() + 1}</span>
                          <div>
                            <strong>{step.title}</strong>
                            <small>
                              {step.status ?? "recorded"} ·{" "}
                              {step.durationMs ? `${step.durationMs}ms` : "—"}
                            </small>
                          </div>
                          <Show when={step.frames?.[0]}>
                            <Icon name="camera" size={14} />
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={tab() === "network"}>
                  <EvidenceList
                    items={job().artifacts?.filter((item) => item.kind === "network") ?? []}
                    empty="No network evidence in this run. Add a Capture network step where the traffic matters."
                  />
                </Show>
                <Show when={tab() === "logs"}>
                  <pre class="relay-report-log">
                    {job().logs?.join("\n") || "No device logs captured."}
                  </pre>
                </Show>
              </div>
            </aside>
          )}
        </Show>
      </div>
    </section>
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
  const status = () =>
    props.job.status === "ok"
      ? "Passed"
      : props.job.status === "error"
        ? "Failed"
        : titleize(props.job.status);
  return (
    <button
      type="button"
      class={cn("relay-run-row", props.selected && "is-selected")}
      onClick={props.onOpen}
    >
      <span>
        <strong>{recipe()?.title ?? props.job.action}</strong>
        <small>{props.job.id.slice(0, 8)}</small>
      </span>
      <span class={cn("relay-status", `is-${props.job.status}`)}>{status()}</span>
      <span>
        {server.devices().find((d) => d.serial === props.job.serial)?.name ??
          props.job.serial ??
          "—"}
      </span>
      <span>{fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "now"}</span>
      <span>{fmtDur(props.job, server.clock()) || "—"}</span>
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
    <div class={cn("relay-metric", props.tone && `is-${props.tone}`)}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  );
}

type DataRow = {
  id: string;
  name: string;
  mode: "AI" | "List" | "Default";
  preview: string;
  fallback: string;
};
const INITIAL_DATA: DataRow[] = [
  {
    id: "daily-question",
    name: "daily_question",
    mode: "AI",
    preview: "Where is Paris located?",
    fallback: "What is the capital of France?",
  },
  {
    id: "image-prompt",
    name: "image_prompt",
    mode: "AI",
    preview: "A tram crossing Lisbon at dusk",
    fallback: "A red bicycle beside a lake",
  },
  { id: "account-tier", name: "account_tier", mode: "List", preview: "Pro", fallback: "Free" },
];

function DataWorkspace(props: { onConfigureProvider: () => void }) {
  const server = useServer();
  const [rows, setRows] = createSignal<DataRow[]>(INITIAL_DATA);
  const [hydrated, setHydrated] = createSignal(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const remote = server.projectVariables();
    if (remote.updatedAt <= 0 || hydrated()) return;
    setRows(remote.value.length ? remote.value.map(variableToDataRow) : INITIAL_DATA);
    setHydrated(true);
  });

  createEffect(() => {
    const value = rows();
    if (!hydrated()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void server
        .saveProjectVariables(value.map(dataRowToVariable))
        .catch((error: unknown) =>
          toast(error instanceof Error ? error.message : String(error), "error"),
        );
    }, 450);
  });
  onCleanup(() => clearTimeout(saveTimer));

  function addRow(): void {
    const index = rows().length + 1;
    setRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `variable_${index}`,
        mode: "Default",
        preview: "Sample value",
        fallback: "Fallback value",
      },
    ]);
  }
  return (
    <section class="relay-page">
      <div class="relay-page__hero">
        <div>
          <span class="relay-eyebrow">Variables</span>
          <h2>Test data</h2>
          <p>
            Prepare fresh inputs before a run while keeping every test deterministic and debuggable.
          </p>
        </div>
        <button type="button" class="relay-primary" onClick={addRow}>
          <Icon name="plus" size={15} /> New variable
        </button>
      </div>
      <div class="relay-data-banner">
        <span class="relay-data-banner__icon">
          <Icon name="sparkle" size={26} />
        </span>
        <div>
          <strong>Generate once, replay exactly.</strong>
          <p>
            AI values are resolved before execution, stored with the run, and replaced by the
            fallback when generation is unavailable.
          </p>
        </div>
        <div class="relay-data-banner__actions">
          <button type="button" onClick={props.onConfigureProvider}>
            Configure provider
          </button>
        </div>
      </div>
      <div class="relay-data-table">
        <div class="relay-data-table__head">
          <span>Variable</span>
          <span>Source</span>
          <span>Today’s preview</span>
          <span>Fallback</span>
          <span />
        </div>
        <For each={rows()}>
          {(row) => (
            <div class="relay-data-row">
              <input
                value={row.name}
                aria-label="Variable name"
                onInput={(e) =>
                  setRows((items) =>
                    items.map((item) =>
                      item.id === row.id ? { ...item, name: e.currentTarget.value } : item,
                    ),
                  )
                }
              />
              <select
                value={row.mode}
                aria-label="Variable source"
                onChange={(e) =>
                  setRows((items) =>
                    items.map((item) =>
                      item.id === row.id
                        ? { ...item, mode: e.currentTarget.value as DataRow["mode"] }
                        : item,
                    ),
                  )
                }
              >
                <option>AI</option>
                <option>List</option>
                <option>Default</option>
              </select>
              <input
                value={row.preview}
                aria-label="Preview value"
                onInput={(e) =>
                  setRows((items) =>
                    items.map((item) =>
                      item.id === row.id ? { ...item, preview: e.currentTarget.value } : item,
                    ),
                  )
                }
              />
              <input
                value={row.fallback}
                aria-label="Fallback value"
                onInput={(e) =>
                  setRows((items) =>
                    items.map((item) =>
                      item.id === row.id ? { ...item, fallback: e.currentTarget.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                class="relay-icon-button relay-icon-button--danger"
                aria-label={`Delete ${row.name}`}
                onClick={() => setRows((items) => items.filter((item) => item.id !== row.id))}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

function nextUntitledTitle(recipes: RecipeInfo[]): string {
  const used = new Set(recipes.map((recipe) => recipe.title));
  if (!used.has("Untitled test")) return "Untitled test";
  let index = 2;
  while (used.has(`Untitled test ${index}`)) index++;
  return `Untitled test ${index}`;
}

function variableToDataRow(variable: TestVariable): DataRow {
  return {
    id: variable.id,
    name: variable.name,
    mode: variable.source === "generated" ? "AI" : variable.source === "list" ? "List" : "Default",
    preview: variable.values?.[0] ?? variable.prompt ?? variable.fallback,
    fallback: variable.fallback,
  };
}

function dataRowToVariable(row: DataRow): TestVariable {
  return {
    id: row.id,
    name: row.name,
    source: row.mode === "AI" ? "generated" : row.mode === "List" ? "list" : "static",
    prompt: row.mode === "AI" ? row.preview : undefined,
    values: row.mode === "AI" ? undefined : [row.preview],
    fallback: row.fallback,
  };
}

function recipeToYaml(title: string, steps: RecipeStep[]): string {
  const quote = (value: unknown) => JSON.stringify(value ?? "");
  const lines = [`name: ${quote(title)}`, "steps:"];
  for (const step of steps) {
    lines.push(`  - type: ${step.kind}`);
    if (step.kind === "tap") lines.push(`    target: ${quote(step.target)}`);
    if (step.kind === "type") lines.push(`    text: ${quote(step.text)}`);
    if (step.kind === "expect") {
      lines.push(`    condition: ${step.condition}`);
      lines.push(`    target: ${quote(step.target)}`);
    }
    if (step.kind === "wait-for") lines.push(`    target: ${quote(step.target)}`);
    if (step.kind === "sleep") lines.push(`    milliseconds: ${step.ms}`);
    if (step.kind === "swipe") {
      lines.push(`    from: ${quote(step.from)}`);
      lines.push(`    to: ${quote(step.to)}`);
    }
    if (step.kind === "scroll") lines.push(`    direction: ${step.direction}`);
    if (step.kind === "key") lines.push(`    key: ${step.key}`);
    if (step.kind === "pause") lines.push(`    message: ${quote(step.message)}`);
    if (step.kind === "screenshot" && step.caption)
      lines.push(`    caption: ${quote(step.caption)}`);
    if (step.kind === "flow") lines.push(`    flow: ${quote(step.flow)}`);
    if (step.note) lines.push(`    note: ${quote(step.note)}`);
  }
  if (steps.length === 0) lines.push("  []");
  return lines.join("\n");
}
