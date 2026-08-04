import {
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from "solid-js";
import type { AppMap } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useRecorder } from "../context/recorder";
import { DevicePicker } from "./device-picker";
import { TestSettingsPanel } from "./test-details-panel";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { displayTitle } from "../lib/job";
import { deviceReadiness } from "../lib/device-readiness";
import { toast } from "../context/toast";
import { confirmAction } from "./confirm-dialog";
import { trapFocus } from "../lib/modal";
import { modalPanel, modalScrim, eyebrow, productIconButton } from "../lib/ui";
import {
  shellRoot,
  shellRootNavVar,
  shellMain,
  shellTopbar,
  shellTopbarContext,
  shellTopbarTitle,
  shellTopbarActions,
  shellStudio,
  shellSaveState,
  shellStudioBodyWorkbench,
  shellStageWrap,
  shellDragStrip,
} from "../lib/shell-layout";
import { blockerIsDeviceRelated, testRunBlocker } from "../lib/test-run-readiness";
import { appMapStartupDecision } from "../lib/app-map-startup";
import { appMapLibraryItem } from "../lib/app-map-library";
import { appMapPrimaryAction } from "../lib/app-map-primary-action";
import type { AppMapRunReadiness as GraphRunReadiness } from "../lib/app-map-run-readiness";
import type { SettingsSection } from "../pages/settings";

type ProductArea = "tests" | "runs";
type MapLibraryArea = ProductArea;
type StudioView = "workbench" | "map";
const DataWorkspace = lazy(() =>
  import("./workspaces/data-workspace").then((module) => ({ default: module.DataWorkspace })),
);
const RunsWorkspace = lazy(() =>
  import("./runs-workspace").then((module) => ({ default: module.RunsWorkspace })),
);
const TestWorkbench = lazy(() =>
  import("./test-workbench").then((module) => ({ default: module.TestWorkbench })),
);
const AppMapWorkspace = lazy(() =>
  import("./app-map-workspace").then((module) => ({ default: module.AppMapWorkspace })),
);
const EmptyAppMap = lazy(() =>
  import("./app-map-empty").then((module) => ({ default: module.EmptyAppMap })),
);
const MapLibrary = lazy(() =>
  import("./map-library").then((module) => ({ default: module.MapLibrary })),
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
  // The App Map is the source of truth. Device remains one click away
  // for direct editing, while the graph keeps each captured screen and its
  // outgoing actions visible as the map grows.
  const [studioView, setStudioView] = createSignal<StudioView>("map");
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [variablesOpen, setVariablesOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [navOpen, setNavOpen] = createSignal(false);
  const [studioActionsOpen, setStudioActionsOpen] = createSignal(false);
  const [devicePanelOpen, setDevicePanelOpen] = createSignal(readRememberedDevicePanelPreference());
  const [creatingBlankMap, setCreatingBlankMap] = createSignal(false);
  const [addNoteOnReady, setAddNoteOnReady] = createSignal(false);
  const [graphRunReadiness, setGraphRunReadiness] = createSignal<GraphRunReadiness>({
    visible: false,
    ready: false,
    reason: "Record a connection before running this flow",
    label: "Run flow",
    transitionPath: null,
  });
  const [activeTargetSetId, setActiveTargetSetId] = createSignal<string>();
  const [importReview, setImportReview] = createSignal<{
    yaml: string;
    appMap: AppMap;
    exists: boolean;
  } | null>(null);

  const selectedMap = createMemo(() => server.selectedAppMap());
  const selectedRecipe = createMemo(() => server.selectedRecipe());
  const [mapNameDraft, setMapNameDraft] = createSignal("");
  createEffect(() => setMapNameDraft(selectedMap()?.name ?? ""));
  createEffect(() => {
    server.selectedAppMapId();
    setActiveTargetSetId();
  });
  // Opening Relay should feel like reopening a design file, not entering a
  // creation wizard. The provider restores the persisted id during startup;
  // this reactive fallback closes the small renderer race where recipes can
  // become visible before that asynchronous restore has selected a canvas.
  // It also gives browser-only sessions (with empty storage) the most recent
  // authored map immediately.
  let restoredInitialMap = false;
  createEffect(() => {
    if (restoredInitialMap) return;
    const decision = appMapStartupDecision({
      online: server.health() === "online",
      loaded: server.appMapsLoaded(),
      selectedId: server.selectedAppMapId(),
      maps: server.appMaps(),
    });
    if (decision.kind === "wait") return;
    if (decision.kind === "keep") {
      restoredInitialMap = true;
      return;
    }
    if (decision.kind === "select") {
      restoredInitialMap = true;
      server.setSelectedAppMapId(decision.id);
      return;
    }
    // No saved maps yet. The renderer now owns an unsaved canvas until the
    // first capture/edit, so launching Relay never manufactures an empty file.
    restoredInitialMap = true;
    server.setSelectedAppMapId(null);
  });
  createEffect(() => {
    const updateTargetSet = (event: Event) => {
      const detail = (event as CustomEvent<{ targetSetId?: string }>).detail;
      setActiveTargetSetId(detail?.targetSetId);
    };
    window.addEventListener("relay:target-set-state", updateTargetSet);
    onCleanup(() => window.removeEventListener("relay:target-set-state", updateTargetSet));
  });
  const libraryArea = createMemo<MapLibraryArea>(() => area());
  let titleBeforeEdit = "";
  let variablesDialog: HTMLElement | undefined;
  let importReviewDialog: HTMLElement | undefined;
  let libraryTrigger: HTMLButtonElement | undefined;
  let studioActionsTrigger: HTMLButtonElement | undefined;
  let studioActionsMenu: HTMLDivElement | undefined;
  const closeLibrary = (restoreFocus = true) => {
    setNavOpen(false);
    if (restoreFocus) queueMicrotask(() => libraryTrigger?.focus());
  };
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
    try {
      localStorage.setItem("relay:device-panel-open", devicePanelOpen() ? "true" : "false");
    } catch {
      // A host can disable storage; panel state is still valid for this session.
    }
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
    let releaseFocus: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      if (variablesDialog) releaseFocus = trapFocus(variablesDialog);
    });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", close);
      releaseFocus?.();
    });
  });
  createEffect(() => {
    if (!importReview()) return;
    let releaseFocus: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      if (importReviewDialog) releaseFocus = trapFocus(importReviewDialog);
    });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      releaseFocus?.();
    });
  });
  createEffect(() => {
    if (!studioActionsOpen()) return;
    queueMicrotask(() =>
      studioActionsMenu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
    );
  });
  onMount(() => {
    const closeNavigator = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !navOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      closeLibrary();
    };
    window.addEventListener("keydown", closeNavigator, true);
    onCleanup(() => window.removeEventListener("keydown", closeNavigator, true));
  });
  onMount(() => {
    const dismissStudioActions = (event: MouseEvent) => {
      if (
        studioActionsOpen() &&
        !studioActionsMenu?.contains(event.target as Node) &&
        !studioActionsTrigger?.contains(event.target as Node)
      ) {
        setStudioActionsOpen(false);
      }
    };
    const closeStudioActions = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !studioActionsOpen()) return;
      event.stopPropagation();
      setStudioActionsOpen(false);
      queueMicrotask(() => studioActionsTrigger?.focus());
    };
    document.addEventListener("mousedown", dismissStudioActions);
    window.addEventListener("keydown", closeStudioActions, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", dismissStudioActions);
      window.removeEventListener("keydown", closeStudioActions, true);
    });
  });
  onMount(() => {
    const onWorkspaceShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (area() !== "tests" || studioView() !== "map") return;
      const key = event.key.toLowerCase();
      if (key === "d") {
        event.preventDefault();
        toggleDevicePanel();
        return;
      }
      if (key === "r" && !selectedMap()) {
        event.preventDefault();
        void captureFirstScreenFromBlankMap();
      }
    };
    window.addEventListener("keydown", onWorkspaceShortcut);
    onCleanup(() => window.removeEventListener("keydown", onWorkspaceShortcut));
  });
  // Navigator, Device, and Properties are three contextual side surfaces.
  // Showing more than one at once makes the canvas feel boxed in and leaves
  // no obvious answer to which context is active.
  createEffect(() => {
    if (!navOpen()) return;
    setSettingsOpen(false);
    window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
  });
  // An App Map is authored on its canvas. The live device remains available
  // inside that workspace, but merely connecting hardware must never change
  // what the user is editing or reopen yesterday's draft on launch.
  let openedAppMapId: string | null | undefined;
  createEffect(() => {
    const id = server.selectedAppMapId();
    if (openedAppMapId === id) return;
    openedAppMapId = id;
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
  const toggleDevicePanel = () => {
    setSettingsOpen(false);
    if (selectedMap()) {
      window.dispatchEvent(new CustomEvent("relay:toggle-device-panel"));
      return;
    }
    setDevicePanelOpen((open) => !open);
  };
  const openDevicePicker = () => {
    if (area() === "tests" && studioView() === "map" && !devicePanelOpen()) {
      window.dispatchEvent(new CustomEvent("relay:toggle-device-panel"));
    }
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("relay:open-device-picker")));
  };
  const testBlockedReason = () => testRunBlocker(readinessState());
  const graphPrimaryAction = createMemo(() =>
    appMapPrimaryAction({
      saveState: draft.saveState(),
      run: graphRunReadiness(),
      serverOnline: server.health() === "online",
      device: selectedDeviceReadiness(),
      running: server.running(),
    }),
  );
  const graphBlockedReason = () => {
    const action = graphPrimaryAction();
    return action.kind === "run" ? "" : action.reason;
  };
  const runSelectedTest = () => {
    if (studioView() === "map") {
      const action = graphPrimaryAction();
      if (action.kind === "choose-device") {
        openDevicePicker();
        return;
      }
      if (action.kind === "open-device") {
        if (!devicePanelOpen()) toggleDevicePanel();
        return;
      }
      if (action.kind === "cancel") {
        const active = server.activeJob();
        // The running summary can briefly arrive before the detailed jobs
        // list. The server's active-cancel operation remains authoritative in
        // that gap, so Stop must never turn into a no-op.
        void server.cancelJob(active?.id);
        return;
      }
      if (action.kind === "blocked") {
        toast(action.reason, "warning");
        return;
      }
      window.dispatchEvent(new CustomEvent("relay:run-app-map"));
      return;
    }
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
    const recipe = selectedRecipe();
    if (!recipe) return;
    void server.runRecipeRemote(recipe.id);
  };
  const mapItems = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const rows = server.appMaps().map(appMapLibraryItem);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return needle ? rows.filter((appMap) => appMap.name.toLowerCase().includes(needle)) : rows;
  });
  async function createCanonicalMap(record = false): Promise<AppMap | null> {
    if (record && !selectedTargetIsReady()) {
      openDevicePicker();
      return null;
    }
    const title = nextUntitledMapTitle(server.appMaps());
    try {
      const appMap = await server.createAppMap(crypto.randomUUID(), title);
      server.setSelectedAppMapId(appMap.id);
      setArea("tests");
      setStudioView("map");
      setSettingsOpen(false);
      setNavOpen(false);
      if (record) recorder.enterRecordMode();
      return appMap;
    } catch (error) {
      toast(
        `The App Map could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return null;
    }
  }

  async function captureFirstScreenFromBlankMap(): Promise<void> {
    const canCapture =
      selectedTargetIsReady() && Boolean(server.selectedLeaseId()) && !server.controlIssue();
    if (creatingBlankMap() || !canCapture) {
      if (!canCapture) openDevicePicker();
      return;
    }
    setCreatingBlankMap(true);
    let createdMap: AppMap | null = null;
    try {
      const title = nextUntitledMapTitle(server.appMaps());
      createdMap = await server.createAppMap(crypto.randomUUID(), title);
      const captured = await recorder.captureMapScreen(createdMap.id, { title: "Start" });
      if (!captured) throw new Error("Relay could not capture the current screen");
      await server.refreshAppMaps();
      server.setSelectedAppMapId(captured.appMap.id);
      setArea("tests");
      setStudioView("map");
      setSettingsOpen(false);
      setNavOpen(false);
      toast("Start screen added", "success");
    } catch (error) {
      if (createdMap) {
        await server
          .runAction("app-map.remove", { appMapId: createdMap.id })
          .catch(() => undefined);
        await server.refreshAppMaps().catch(() => undefined);
      }
      toast(error instanceof Error ? error.message : String(error), "warning");
    } finally {
      setCreatingBlankMap(false);
    }
  }

  async function addFirstNoteToBlankMap(): Promise<void> {
    if (creatingBlankMap()) return;
    setCreatingBlankMap(true);
    setAddNoteOnReady(true);
    const saved = await createCanonicalMap(false);
    if (saved) return;
    setAddNoteOnReady(false);
    setCreatingBlankMap(false);
  }

  async function importTestYaml(yaml: string): Promise<void> {
    try {
      const preview = await server.runAction("app-map.import", { yaml, dryRun: true });
      setImportReview({
        yaml,
        appMap: preview.appMap,
        exists: server.appMaps().some((candidate) => candidate.id === preview.appMap.id),
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function confirmImport(conflict: "replace" | "copy"): Promise<void> {
    const review = importReview();
    if (!review) return;
    try {
      const result = await server.runAction("app-map.import", {
        yaml: review.yaml,
        conflict: review.exists ? conflict : "reject",
      });
      await server.refreshAppMaps();
      server.setSelectedAppMapId(result.appMap.id);
      setImportReview(null);
      setArea("tests");
      setStudioView("map");
      setNavOpen(false);
      toast(`Imported ${displayTitle(result.appMap.name)}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function exportSelected(): Promise<void> {
    const appMap = selectedMap();
    if (!appMap) return;
    try {
      const result = await server.runAction("app-map.export", { appMapId: appMap.id });
      const url = URL.createObjectURL(
        new Blob([result.yaml], { type: "application/yaml;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${displayTitle(appMap.name)}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function duplicateSelected(): Promise<void> {
    const appMap = selectedMap();
    if (!appMap) return;
    // Copies of copies get "(copy 2)", never "… (copy) copy".
    const base = displayTitle(appMap.name).replace(/\s*\((copy)(?:\s+\d+)?\)\s*$/i, "");
    const titles = new Set(server.appMaps().map((item) => displayTitle(item.name)));
    let title = `${base} (copy)`;
    for (let index = 2; titles.has(title); index++) title = `${base} (copy ${index})`;
    const duplicateId = crypto.randomUUID();
    try {
      await server.runAction("app-map.duplicate", {
        sourceAppMapId: appMap.id,
        appMapId: duplicateId,
        name: title,
      });
      await server.refreshAppMaps();
      server.setSelectedAppMapId(duplicateId);
      toast(`Duplicated ${displayTitle(appMap.name)}`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function renameCanonicalMap(name: string): Promise<void> {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return;
    const map = server.appMaps().find((candidate) => candidate.id === appMapId);
    if (!map || map.name === name) return;
    try {
      await server.runAction("app-map.update", {
        appMapId,
        expectedRevision: map.revision,
        patch: { name },
      });
      await server.refreshAppMaps();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function confirmDeleteMap(appMapId: string): void {
    const appMap = server.appMaps().find((candidate) => candidate.id === appMapId);
    if (!appMap) return;
    confirmAction({
      title: "Delete map?",
      body: `“${appMap.name}” and its version history will be removed. This cannot be undone.`,
      confirmLabel: "Delete map",
      onConfirm: async () => {
        await server.runAction("app-map.remove", { appMapId });
        await server.refreshAppMaps();
        if (server.selectedAppMapId() === appMapId) server.setSelectedAppMapId(null);
      },
    });
  }

  function deleteSelected(): void {
    const appMapId = server.selectedAppMapId();
    if (appMapId) confirmDeleteMap(appMapId);
  }

  function deleteMap(id: string): void {
    confirmDeleteMap(id);
  }

  function openRecipe(id: string): void {
    server.setSelectedAppMapId(id);
    setArea("tests");
    setStudioView("map");
    setSettingsOpen(false);
    // The library is for choosing work. Once chosen, give the graph and live
    // device the room; the toolbar button keeps the library one click away.
    setNavOpen(false);
  }

  /** New Map is a local blank canvas. It becomes durable only after its first
   * capture or note, so browsing and reopening Relay cannot create drafts. */
  function startNewMap(): void {
    setArea("tests");
    server.setSelectedAppMapId(null);
    setStudioView("map");
    setSettingsOpen(false);
    setNavOpen(false);
  }

  return (
    <div
      class={shellRoot}
      style={shellRootNavVar(navOpen())}
      data-selected-app-map-id={server.selectedAppMapId() ?? ""}
    >
      <div class={shellDragStrip} aria-hidden="true" />

      <Show when={navOpen()}>
        <MapLibrary
          open
          onClose={closeLibrary}
          area={libraryArea()}
          onArea={(nextArea) => {
            setArea(nextArea);
            // Run history already owns its own filters and result list. Keeping
            // the navigator's second copy open makes the same runs compete in
            // two columns, so the report surface takes focus immediately.
            if (nextArea === "runs") setNavOpen(false);
          }}
          query={query()}
          onQuery={setQuery}
          items={mapItems()}
          selectedId={server.selectedAppMapId()}
          onSelect={openRecipe}
          onDelete={deleteMap}
          onCreate={startNewMap}
          onOpenRun={(id) => server.setSelectedJobId(id)}
          onImport={importTestYaml}
          onOpenSettings={() => props.onOpenSettings()}
        />
        <button
          type="button"
          class="fixed inset-0 z-[70] cursor-default bg-black/10 backdrop-blur-[1px]"
          aria-label="Close navigator"
          onClick={() => closeLibrary()}
        />
      </Show>

      <main class={shellMain}>
        {/* One toolbar. The map's name, its view, and its actions used to
            be split across two stacked bars for no reason a user could name. */}
        <header class={cn(shellTopbar, !navOpen() && "pl-[calc(var(--traffic-pad,12px)+18px)]")}>
          <div class={shellTopbarContext}>
            <button
              ref={(element) => (libraryTrigger = element)}
              type="button"
              class={productIconButton}
              aria-label={navOpen() ? "Close library" : "Open library"}
              data-tip={navOpen() ? "Close library" : "Maps and flows"}
              onClick={() => setNavOpen((value) => !value)}
            >
              <Icon name="panel-left" size={17} />
            </button>
          </div>
          <div class={shellTopbarTitle}>
            <Show
              when={area() === "tests" && selectedMap()}
              fallback={
                <strong class="max-w-full truncate text-center text-[13px] font-medium text-[var(--text-base)]">
                  {area() === "runs" ? "Run history" : "Untitled"}
                </strong>
              }
            >
              <input
                type="text"
                size={Math.max(12, Math.min(34, displayTitle(mapNameDraft()).length + 1))}
                class="h-8 max-w-full min-w-[120px] rounded-md bg-transparent px-2 text-center font-medium text-[var(--text-base)] outline-none transition-[background-color,box-shadow,color] duration-150 placeholder:text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-01)] focus:bg-[var(--v2-background-bg-layer-01)] focus:text-[var(--text-strong)] focus:shadow-[inset_0_0_0_1px_var(--v2-border-border-strong)] max-[680px]:min-w-0"
                aria-label="Map name"
                data-tip="Rename map"
                value={displayTitle(mapNameDraft())}
                placeholder="Untitled"
                spellcheck={false}
                onFocus={() => {
                  titleBeforeEdit = mapNameDraft();
                }}
                onInput={(event) => setMapNameDraft(event.currentTarget.value)}
                onBlur={() => {
                  const name = mapNameDraft().trim() || "Untitled";
                  setMapNameDraft(name);
                  draft.setTitle(name);
                  void renameCanonicalMap(name);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setMapNameDraft(titleBeforeEdit);
                    event.currentTarget.blur();
                  }
                }}
              />
            </Show>
          </div>
          <div class={shellTopbarActions}>
            <Show when={area() === "tests" && studioView() === "map"}>
              <DevicePicker
                liveOpen={devicePanelOpen()}
                targetSets={server.matrices()}
                activeTargetSetId={activeTargetSetId()}
                onOpenLive={toggleDevicePanel}
                onChooseTargetSet={(targetSetId) => {
                  if (targetSetId)
                    window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
                  window.dispatchEvent(
                    new CustomEvent("relay:choose-target-set", { detail: { targetSetId } }),
                  );
                }}
                onManageTargets={() => props.onOpenSettings("targets")}
              />
            </Show>
            <Show when={area() === "tests" && selectedMap()}>
              <Show when={draft.saveState() === "saving" || draft.saveState() === "invalid"}>
                <span class={shellSaveState}>
                  {draft.saveState() === "saving"
                    ? "Saving…"
                    : `${draft.invalidCount()} incomplete`}
                </span>
              </Show>
              <Show when={studioView() === "workbench"}>
                <Button
                  variant="secondary"
                  size="sm"
                  class="gap-1.5 text-[12px]"
                  onClick={() => {
                    setSettingsOpen(false);
                    setStudioView("map");
                  }}
                >
                  <Icon name="chevron-left" size={13} /> Back to map
                </Button>
              </Show>
            </Show>
            <Show when={area() === "tests" && selectedMap()}>
              <div class="relative flex items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={settingsOpen()}
                  class={cn(
                    productIconButton,
                    "max-[680px]:hidden",
                    settingsOpen() && "bg-surface-base-active",
                  )}
                  aria-label="Map properties"
                  data-tip="Map properties"
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
                  ref={(element) => (studioActionsTrigger = element)}
                  class={productIconButton}
                  type="button"
                  aria-label="More map options"
                  aria-expanded={studioActionsOpen()}
                  onClick={() => setStudioActionsOpen((open) => !open)}
                >
                  <Icon name="more" size={16} />
                </button>
                <Show when={studioActionsOpen()}>
                  <div
                    ref={(element) => (studioActionsMenu = element)}
                    class="ui-pop absolute top-[calc(100%+6px)] right-0 z-40 grid w-[200px] gap-0.5 rounded-[10px] border border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--v2-elevation-overlay)]"
                    role="menu"
                    aria-label="Map options"
                    onFocusOut={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && event.currentTarget.contains(next)) return;
                      setStudioActionsOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                      const items = [
                        ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          '[role="menuitem"]:not([disabled])',
                        ),
                      ];
                      if (!items.length) return;
                      event.preventDefault();
                      const current = items.indexOf(document.activeElement as HTMLButtonElement);
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? items.length - 1
                            : event.key === "ArrowDown"
                              ? (current + 1 + items.length) % items.length
                              : (current - 1 + items.length) % items.length;
                      items[next]?.focus();
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      class="hidden min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)] max-[680px]:flex"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
                        setSettingsOpen(true);
                      }}
                    >
                      <Icon name="sliders" size={14} /> Map properties
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        window.dispatchEvent(new CustomEvent("relay:toggle-map-history"));
                      }}
                    >
                      <Icon name="clock" size={14} /> Version history
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        void duplicateSelected();
                      }}
                    >
                      <Icon name="copy" size={14} /> Duplicate map
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] hover:text-[var(--text-strong)]"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        void exportSelected();
                      }}
                    >
                      <Icon name="download" size={14} /> Export map
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[12px] text-[var(--icon-critical-base)] hover:bg-[var(--v2-background-bg-layer-02)]"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        void deleteSelected();
                      }}
                    >
                      <Icon name="trash" size={14} /> Delete map
                    </button>
                  </div>
                </Show>
              </div>
              <Show
                when={
                  studioView() === "map" ? graphRunReadiness().visible : draft.steps().length > 0
                }
              >
                <Button
                  variant="primary"
                  size="lg"
                  class="text-[12px]"
                  aria-describedby={
                    (studioView() === "map" ? graphBlockedReason() : testBlockedReason())
                      ? "app-map-run-blocker"
                      : undefined
                  }
                  disabled={
                    studioView() === "map"
                      ? graphPrimaryAction().kind === "blocked"
                      : Boolean(testBlockedReason())
                  }
                  data-tip={
                    (studioView() === "map" ? graphBlockedReason() : testBlockedReason()) ||
                    graphRunReadiness().label
                  }
                  aria-label={studioView() === "map" ? graphPrimaryAction().label : "Run flow"}
                  onClick={runSelectedTest}
                >
                  <Icon
                    name={studioView() === "map" ? graphPrimaryAction().icon : "play"}
                    size={13}
                    class={cn(
                      studioView() === "map" &&
                        graphPrimaryAction().icon === "refresh" &&
                        "ui-refresh-spin motion-reduce:opacity-70",
                    )}
                  />
                  <span class="max-[620px]:hidden">
                    {studioView() === "map" ? graphPrimaryAction().label : "Run"}
                  </span>
                </Button>
                <Show when={studioView() === "map" ? graphBlockedReason() : testBlockedReason()}>
                  {(reason) => (
                    <span id="app-map-run-blocker" class="sr-only">
                      {reason()}
                    </span>
                  )}
                </Show>
              </Show>
            </Show>
          </div>
        </header>

        <Show when={area() === "tests"}>
          <section class={shellStudio}>
            <div
              class={
                selectedMap()
                  ? studioView() === "map"
                    ? "relative flex min-h-0 min-w-0 flex-1"
                    : shellStudioBodyWorkbench
                  : "grid min-h-0 min-w-0 flex-1 grid-cols-1"
              }
            >
              <Show
                when={selectedMap()}
                fallback={
                  <Suspense fallback={<WorkspaceLoading label="canvas" />}>
                    <EmptyAppMap
                      deviceOpen={devicePanelOpen()}
                      creating={creatingBlankMap()}
                      onToggleDevice={toggleDevicePanel}
                      onOpenTargets={() => props.onOpenSettings("targets")}
                      onCaptureFirstScreen={() => void captureFirstScreenFromBlankMap()}
                      onAddFirstNote={() => void addFirstNoteToBlankMap()}
                    />
                  </Suspense>
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
                    <Suspense fallback={<WorkspaceLoading label="map" />}>
                      <AppMapWorkspace
                        navigatorOpen={navOpen()}
                        addNoteOnReady={addNoteOnReady()}
                        onAddNoteHandled={() => {
                          setAddNoteOnReady(false);
                          setCreatingBlankMap(false);
                        }}
                        onOpenTargets={() => props.onOpenSettings("targets")}
                        onOpenActions={() => setStudioView("workbench")}
                        onOpenVariables={() => setVariablesOpen(true)}
                        onOpenRun={(id) => {
                          server.setSelectedJobId(id);
                          setArea("runs");
                        }}
                      />
                    </Suspense>
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
          <div
            class={cn(modalScrim, "z-[120] flex items-center justify-center p-5")}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setImportReview(null);
            }}
          >
            <section
              ref={(element) => {
                importReviewDialog = element;
              }}
              class={cn(modalPanel, "grid w-[min(100%,480px)] gap-0 overflow-hidden rounded-xl")}
              role="dialog"
              aria-modal="true"
              aria-labelledby="import-review-title"
              onKeyDown={(event) => {
                if (event.key === "Escape") setImportReview(null);
              }}
            >
              <header class="flex items-start justify-between gap-3 border-b border-[var(--v2-border-border-muted)] px-4 py-3.5">
                <div>
                  <span class={eyebrow}>App Map YAML</span>
                  <h3
                    id="import-review-title"
                    class="mt-1 text-[16px] font-semibold text-[var(--text-strong)]"
                  >
                    {review().exists ? "This map already exists" : "Import this map?"}
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
                    {review().appMap.name}
                  </strong>
                  <small class="block text-[11px] text-[var(--text-weak)]">
                    {review().appMap.id} · {Object.keys(review().appMap.screens).length} screen
                    {Object.keys(review().appMap.screens).length === 1 ? "" : "s"} ·{" "}
                    {Object.keys(review().appMap.connections).length} connection
                    {Object.keys(review().appMap.connections).length === 1 ? "" : "s"}
                  </small>
                </div>
              </div>
              <details class="mx-4 my-3 rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-3 py-2">
                <summary class="cursor-pointer text-[11px] text-[var(--text-base)]">
                  Preview portable YAML
                </summary>
                <pre class="mt-2 max-h-48 overflow-auto font-mono text-[11px]/[1.5] text-[var(--text-weak)]">
                  {review().yaml}
                </pre>
              </details>
              <footer class="flex items-center justify-between gap-3 border-t border-[var(--v2-border-border-muted)] px-4 py-3">
                <p class="m-0 max-w-[28ch] text-[11px]/[1.45] text-[var(--text-weak)]">
                  {review().exists
                    ? "Replace this map, or import a separate copy with the same screens and connections."
                    : "Relay will add this portable App Map to the current project."}
                </p>
                <div class="flex shrink-0 flex-wrap justify-end gap-2">
                  <Button variant="secondary" size="lg" onClick={() => setImportReview(null)}>
                    Cancel
                  </Button>
                  <Show when={review().exists}>
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => void confirmImport("copy")}
                    >
                      Import copy
                    </Button>
                  </Show>
                  <Button variant="primary" size="lg" onClick={() => void confirmImport("replace")}>
                    {review().exists ? "Replace map" : "Import map"}
                  </Button>
                </div>
              </footer>
            </section>
          </div>
        )}
      </Show>
    </div>
  );
}

function nextUntitledMapTitle(maps: Array<{ name: string }>): string {
  const used = new Set(maps.map((map) => map.name));
  if (!used.has("Untitled")) return "Untitled";
  let index = 2;
  while (used.has(`Untitled ${index}`)) index++;
  return `Untitled ${index}`;
}

function readRememberedDevicePanelPreference(): boolean {
  try {
    return localStorage.getItem("relay:device-panel-open") !== "false";
  } catch {
    return true;
  }
}
