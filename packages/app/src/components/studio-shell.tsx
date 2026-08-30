import {
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { useRecorder } from "../context/recorder";
import { DevicePicker } from "./device-picker";
import { AppMapPrimaryActionButton } from "./app-map-primary-action-button";
import { OfflineGate } from "./offline-gate";
import { MapPropertiesPanel } from "./test-details-panel";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { displayTitle } from "../lib/job";
import { humanError } from "../lib/human-error";
import { deviceReadiness } from "../lib/device-readiness";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { toast } from "../context/toast";
import { confirmAction } from "./confirm-dialog";
import { trapFocus } from "../lib/modal";
import { chromeMenuItem, chromeMenuItemDanger, productIconButton } from "../lib/ui";
import { WorkspaceSkeleton } from "./workspace-skeleton";
import {
  shellRoot,
  shellRootNavVar,
  shellMain,
  shellTopbar,
  shellTopbarContext,
  shellTopbarModes,
  shellTopbarActions,
  shellStudio,
  shellMapWrap,
  shellDragStrip,
} from "../lib/shell-layout";
import { appMapOpeningMode, appMapStartupDecision } from "../lib/app-map-startup";
import { appMapLibraryItem } from "../lib/app-map-library";
import { normalizeMapLibraryArea, type MapLibraryArea } from "../lib/map-library-area";
import { appMapPrimaryAction } from "../lib/app-map-primary-action";
import { matchLiveScreen } from "../lib/app-map-live-location";
import type { AppMapRunReadiness as GraphRunReadiness } from "../lib/app-map-run-readiness";
import type { SettingsSection } from "../pages/settings";
import { MapModeSwitch, type MapMode } from "./map-mode-switch";
import { ShellTopbarTitle } from "./studio-shell-topbar-title";
import { StudioImportReviewDialog, type ImportReview } from "./studio-import-review-dialog";
import { StudioAuthoringWorkspace } from "./studio-authoring-workspace";
import { StudioShellShortcutsSheet } from "./studio-shell-shortcuts-sheet";
import { StudioShellCombineRail } from "./studio-shell-combine-rail";
import { StudioShellVariablesDialog } from "./studio-shell-variables-dialog";
import { readRememberedDevicePanelPreference } from "../lib/studio-shell-preferences";
import { createStudioActionMenuBehavior } from "../lib/studio-action-menu-behavior";
import { createStudioBlankMapActions } from "../lib/studio-blank-map-actions";
import {
  ChangesWorkspace,
  EmptyAppMap,
  MapLibrary,
  RunsWorkspace,
} from "./studio-shell-workspaces";
import type { WorkspaceController } from "../lib/workspace-controller";
import { useStudioWorkspaceController } from "../lib/use-studio-workspace-controller";

export function StudioShell(props: {
  onOpenSettings: (section?: SettingsSection) => void;
  workspaceController: WorkspaceController;
}) {
  const server = useServer();
  const recorder = useRecorder();
  const workspaceController = props.workspaceController;
  const [area, setArea] = createSignal<MapLibraryArea>(
    normalizeMapLibraryArea(
      new URLSearchParams(window.location.search).has("run") ? "runs" : "maps",
    ),
  );
  const [mapMode, setMapMode] = createSignal<MapMode>("map");
  const authoringMap = () => mapMode() !== "test";
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [variablesOpen, setVariablesOpen] = createSignal(false);
  const [combineOpen, setCombineOpen] = createSignal(false);
  // Collapse rather than unmount so in-progress Combine drafts survive.
  const [combineCollapsed, setCombineCollapsed] = createSignal(false);
  const [combineFocusId, setCombineFocusId] = createSignal<string>();
  const [combineFocusSection, setCombineFocusSection] = createSignal<CanvasCombineSection>();
  const [query, setQuery] = createSignal("");
  const [navOpen, setNavOpen] = createSignal(false);
  const [studioActionsOpen, setStudioActionsOpen] = createSignal(false);
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [devicePanelOpen, setDevicePanelOpen] = createSignal(readRememberedDevicePanelPreference());
  const [creatingBlankMap, setCreatingBlankMap] = createSignal(false);
  const [graphRunReadiness, setGraphRunReadiness] = createSignal<GraphRunReadiness>({
    visible: true,
    ready: false,
    reason: "Save the first screen to start your map",
    next: "capture",
    label: "Save first screen",
    transitionPath: null,
  });
  const [activeTargetSetId, setActiveTargetSetId] = createSignal<string>();
  const [importReview, setImportReview] = createSignal<ImportReview | null>(null);
  const selectedMap = createMemo(() => server.selectedAppMap());
  const [mapNameDraft, setMapNameDraft] = createSignal("");
  createEffect(() => setMapNameDraft(selectedMap()?.name ?? "My map"));
  createEffect(() => {
    server.selectedAppMapId();
    setActiveTargetSetId();
  });
  // Restore persisted work before recipes paint; the selected id stays authoritative.
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
      setMapMode(decision.mode);
      restoredInitialMap = true;
      return;
    }
    if (decision.kind === "select") {
      setMapMode(decision.mode);
      restoredInitialMap = true;
      server.setSelectedAppMapId(decision.id);
      return;
    }
    // Keep the unsaved canvas renderer-owned until its first capture or edit.
    setMapMode("test");
    restoredInitialMap = true;
    server.setSelectedAppMapId(null);
  });
  const libraryArea = createMemo<MapLibraryArea>(() => area());
  let variablesDialog: HTMLElement | undefined;
  let importReviewDialog: HTMLElement | undefined;
  let libraryTrigger: HTMLButtonElement | undefined;
  let studioActionsTrigger: HTMLButtonElement | undefined;
  let studioActionsMenu: HTMLDivElement | undefined;
  const studioActionMenu = createStudioActionMenuBehavior({
    open: studioActionsOpen,
    setOpen: setStudioActionsOpen,
    trigger: () => studioActionsTrigger,
    menu: () => studioActionsMenu,
  });
  const closeLibrary = (restoreFocus = true) => {
    setNavOpen(false);
    if (restoreFocus) queueMicrotask(() => libraryTrigger?.focus());
  };
  createEffect(() => {
    try {
      localStorage.setItem("relay:device-panel-open", devicePanelOpen() ? "true" : "false");
    } catch {
      // A host can disable storage; panel state is still valid for this session.
    }
  });
  createEffect(() => {
    if (!combineOpen()) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCombineOpen(false);
    };
    window.addEventListener("keydown", close);
    onCleanup(() => {
      window.removeEventListener("keydown", close);
    });
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
    const onWorkspaceShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (area() !== "maps") return;
      const key = event.key.toLowerCase();
      if (key === "d") {
        event.preventDefault();
        toggleDevicePanel();
        return;
      }
      if (key === "r" && !selectedMap()) {
        event.preventDefault();
        void blankMapActions.record();
      }
    };
    window.addEventListener("keydown", onWorkspaceShortcut);
    onCleanup(() => window.removeEventListener("keydown", onWorkspaceShortcut));
  });
  // Navigator, Device, and Properties are contextual side surfaces. Showing
  // more than one boxes in the canvas and obscures which context is active.
  createEffect(() => {
    if (!navOpen()) return;
    setSettingsOpen(false);
    workspaceController.request({ kind: "device.hide" });
  });
  // An App Map is authored on its canvas. The live device remains available
  // inside that workspace, but merely connecting hardware must never change
  // what the user is editing or reopen yesterday's draft on launch.
  let openedAppMapId: string | null | undefined;
  createEffect(() => {
    const id = server.selectedAppMapId();
    if (openedAppMapId === id) return;
    openedAppMapId = id;
    setSettingsOpen(false);
    setVariablesOpen(false);
    if (id) setNavOpen(false);
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
  const selectedMapLiveLocation = createMemo(() => {
    const map = selectedMap();
    if (!map) return { kind: "none" as const };
    return matchLiveScreen(Object.values(map.screens), [
      server.snapshot()?.screenIdentity?.fingerprint,
      server.liveFrame()?.visualFingerprint,
      server.liveFrame()?.fingerprint,
    ]);
  });
  const toggleDevicePanel = () => {
    setSettingsOpen(false);
    workspaceController.request({ kind: "device.toggle" });
  };
  const toggleCombine = (combineId?: string, section?: CanvasCombineSection) => {
    const requestedId = combineId?.trim() || undefined;
    if (!section && combineOpen() && (!requestedId || requestedId === combineFocusId())) {
      setCombineOpen(false);
      setCombineFocusId(undefined);
      setCombineFocusSection(undefined);
      return;
    }
    setSettingsOpen(false);
    setVariablesOpen(false);
    setNavOpen(false);
    workspaceController.request({ kind: "device.hide" });
    setCombineFocusId(requestedId);
    setCombineFocusSection(undefined);
    setCombineOpen(true);
    setCombineCollapsed(false);
    if (section) queueMicrotask(() => setCombineFocusSection(section));
  };
  const openDevicePicker = () => {
    if (area() === "maps" && authoringMap() && !devicePanelOpen()) {
      workspaceController.request({ kind: "device.show" });
    }
    requestAnimationFrame(() => workspaceController.request({ kind: "target.choose" }));
  };
  useStudioWorkspaceController({
    controller: workspaceController,
    ownsDevicePanel: () => area() !== "maps" || !selectedMap(),
    ownsRecording: () => !authoringMap(),
    toggleDevice: () => setDevicePanelOpen((open) => !open),
    showDevice: () => {
      setSettingsOpen(false);
      setDevicePanelOpen(true);
    },
    hideDevice: () => setDevicePanelOpen(false),
    recordTest: () => void recorder.enterRecordMode(),
    deviceStateChanged: setDevicePanelOpen,
    openRun: (runId) => {
      if (runId) server.setSelectedJobId(runId);
      setArea("runs");
    },
    runReadinessChanged: setGraphRunReadiness,
    mapTargetSetChanged: setActiveTargetSetId,
  });
  const graphPrimaryAction = createMemo(() =>
    appMapPrimaryAction({
      saveState: "saved",
      run: graphRunReadiness(),
      serverOnline: server.health() === "online",
      device: selectedDeviceReadiness(),
      liveLocation: selectedMapLiveLocation().kind,
      running: server.running(),
    }),
  );
  const runSelectedTest = () => {
    const action = graphPrimaryAction();
    if (action.kind === "choose-device") {
      openDevicePicker();
      return;
    }
    if (action.kind === "open-device") {
      if (!devicePanelOpen()) toggleDevicePanel();
      return;
    }
    if (action.kind === "view-run") {
      const active = server.activeJob();
      workspaceController.request({ kind: "run.open", runId: active?.id });
      return;
    }
    if (action.kind === "record-path") {
      if (!devicePanelOpen()) toggleDevicePanel();
      workspaceController.request({ kind: "test.record" });
      return;
    }
    if (action.kind === "capture-screen") {
      if (!devicePanelOpen()) toggleDevicePanel();
      workspaceController.request({ kind: "screen.capture" });
      return;
    }
    if (action.kind === "keep-path") {
      toast(action.reason || "Try the path on the device, then keep it", "info");
      if (!devicePanelOpen()) toggleDevicePanel();
      return;
    }
    if (action.kind === "blocked") {
      toast(action.reason, "warning");
      return;
    }
    workspaceController.request({ kind: "test.run" });
  };
  const mapItems = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const rows = server.appMaps().map(appMapLibraryItem);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return needle ? rows.filter((appMap) => appMap.name.toLowerCase().includes(needle)) : rows;
  });
  const blankMapActions = createStudioBlankMapActions({
    server,
    recorder,
    creating: creatingBlankMap,
    setCreating: setCreatingBlankMap,
    targetReady: selectedTargetIsReady,
    openDevicePicker,
    openWorkspace: (mapId, mode) => {
      server.setSelectedAppMapId(mapId);
      setArea("maps");
      setMapMode(mode);
      setSettingsOpen(false);
      setNavOpen(false);
    },
    clearWorkspace: () => server.setSelectedAppMapId(null),
  });
  async function importTestYaml(yaml: string): Promise<void> {
    try {
      const preview = await server.runAction("app-map.import", { yaml, dryRun: true });
      setImportReview({
        yaml,
        appMap: preview.appMap,
        exists: server.appMaps().some((candidate) => candidate.id === preview.appMap.id),
      });
    } catch (error) {
      toast(humanError(error, "Could not read that file as a map"), "error");
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
      setArea("maps");
      setNavOpen(false);
      toast(`Imported ${displayTitle(result.appMap.name)}`, "success");
    } catch (error) {
      toast(humanError(error, "Could not import this map"), "error");
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
      toast(humanError(error, "Could not export this map"), "error");
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
      toast(humanError(error, "Could not duplicate this map"), "error");
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
      toast(humanError(error, "Could not rename this map"), "error");
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

  function openMap(id: string): void {
    server.setSelectedAppMapId(id);
    setArea("maps");
    setMapMode(appMapOpeningMode(server.appMaps().find((candidate) => candidate.id === id)));
    setSettingsOpen(false);
    // The library is for choosing work. Once chosen, give the graph and live
    // device the room; the toolbar button keeps the library one click away.
    setNavOpen(false);
  }

  function openTest(id: string): void {
    const map = server
      .appMaps()
      .find(
        (candidate) =>
          candidate.id === id ||
          Boolean(candidate.tests[id]) ||
          Boolean(candidate.flows[id]) ||
          Boolean(candidate.routines[id]),
      );
    if (map) {
      server.setSelectedAppMapId(map.id);
      setArea("maps");
      setMapMode("test");
      setSettingsOpen(false);
      setNavOpen(false);
      return;
    }
    toast("This saved run is no longer attached to an editable map Test.", "warning");
  }

  /** A blank Map becomes durable only after its first capture or note. */
  function startNewMap(): void {
    setArea("maps");
    server.setSelectedAppMapId(null);
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
            // Run history / tree crawl already own the main pane. Keeping the
            // navigator's second copy open makes the same work compete in two
            // columns, so the report surface takes focus immediately.
            if (nextArea === "changes" || nextArea === "runs") setNavOpen(false);
          }}
          query={query()}
          onQuery={setQuery}
          items={mapItems()}
          selectedId={server.selectedAppMapId()}
          onSelect={openMap}
          onDelete={deleteMap}
          onCreate={startNewMap}
          onOpenRun={(id) => server.setSelectedJobId(id)}
          onImport={importTestYaml}
          onOpenSettings={() => props.onOpenSettings()}
        />
        <button
          type="button"
          class="fixed inset-0 z-[var(--z-shell-header)] cursor-default bg-black/10 backdrop-blur-[1px]"
          aria-label="Close navigator"
          onClick={() => closeLibrary()}
        />
      </Show>

      <main class={shellMain}>
        <header class={cn(shellTopbar, !navOpen() && "pl-[calc(var(--traffic-pad,12px)+18px)]")}>
          <div class={shellTopbarContext}>
            <button
              ref={(element) => (libraryTrigger = element)}
              type="button"
              class={productIconButton}
              aria-label={navOpen() ? "Close library" : "Open library"}
              data-tip={navOpen() ? "Close library" : "Changes, maps, and runs"}
              onClick={() => setNavOpen((value) => !value)}
            >
              <Icon name="panel-left" size={17} />
            </button>
            <ShellTopbarTitle
              area={area()}
              name={mapNameDraft()}
              disabled={server.isOffline()}
              onNameInput={setMapNameDraft}
              onCommit={(name) => {
                setMapNameDraft(name);
                void renameCanonicalMap(name);
              }}
            />
          </div>
          <div
            class={shellTopbarModes}
            inert={server.isOffline()}
            aria-hidden={server.isOffline() ? "true" : undefined}
          >
            <Show when={area() === "maps" && selectedMap()}>
              <MapModeSwitch value={mapMode()} onChange={setMapMode} />
            </Show>
          </div>
          <div
            class={shellTopbarActions}
            inert={server.isOffline()}
            aria-hidden={server.isOffline() ? "true" : undefined}
          >
            <Show when={area() === "maps"}>
              <DevicePicker
                workspaceController={workspaceController}
                liveOpen={devicePanelOpen()}
                targetSets={server.matrices()}
                activeTargetSetId={activeTargetSetId()}
                onOpenLive={toggleDevicePanel}
                onChooseTargetSet={(targetSetId) => {
                  if (targetSetId) workspaceController.request({ kind: "device.hide" });
                  workspaceController.request({
                    kind: "map.target-set.choose",
                    ...(targetSetId !== undefined ? { targetSetId } : {}),
                  });
                }}
                onManageTargets={() => props.onOpenSettings("targets")}
              />
            </Show>
            <Show when={area() === "maps" && selectedMap()}>
              <div class="relative flex items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={settingsOpen()}
                  class={cn(
                    productIconButton,
                    "max-[760px]:hidden",
                    settingsOpen() && "bg-surface-base-active",
                  )}
                  aria-label="Map properties"
                  data-tip="Map properties"
                  onClick={() => {
                    const opening = !settingsOpen();
                    if (opening) workspaceController.request({ kind: "device.hide" });
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
                  aria-haspopup="menu"
                  aria-expanded={studioActionsOpen()}
                  aria-controls="app-map-options-menu"
                  data-tip="More map options"
                  onClick={() => setStudioActionsOpen((open) => !open)}
                >
                  <Icon name="more" size={16} />
                </button>
                <Show when={studioActionsOpen()}>
                  <div
                    ref={(element) => (studioActionsMenu = element)}
                    id="app-map-options-menu"
                    class="ui-pop absolute top-[calc(100%+6px)] right-0 z-40 grid w-[200px] gap-0.5 rounded-xl border border-[var(--border-strong-base)] bg-surface-raised-stronger-non-alpha p-1 shadow-[var(--shadow-lg)]"
                    role="menu"
                    aria-label="Map options"
                    onFocusOut={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && event.currentTarget.contains(next)) return;
                      setStudioActionsOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                      const items = studioActionMenu.visibleItems();
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
                      class={cn("hidden max-[760px]:flex", chromeMenuItem)}
                      onClick={() => {
                        setStudioActionsOpen(false);
                        workspaceController.request({ kind: "device.hide" });
                        setSettingsOpen(true);
                      }}
                    >
                      <Icon name="sliders" size={14} /> Map properties
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class={cn("flex", chromeMenuItem)}
                      onClick={() => {
                        setStudioActionsOpen(false);
                        workspaceController.request({ kind: "map.undo" });
                      }}
                    >
                      <Icon name="undo" size={14} />
                      <span class="flex-1">Undo</span>
                      <kbd class="text-micro font-normal text-[var(--text-weaker)]">⌘Z</kbd>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class={cn("flex", chromeMenuItem)}
                      onClick={() => {
                        setStudioActionsOpen(false);
                        workspaceController.request({ kind: "map.redo" });
                      }}
                    >
                      <Icon name="redo" size={14} />
                      <span class="flex-1">Redo</span>
                      <kbd class="text-micro font-normal text-[var(--text-weaker)]">⇧⌘Z</kbd>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class={cn("flex", chromeMenuItem)}
                      aria-label="Tidy map"
                      data-tip="Arrange every screen into a compact path"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        workspaceController.request({ kind: "map.tidy" });
                        queueMicrotask(() => studioActionsTrigger?.focus());
                      }}
                    >
                      <Icon name="grid" size={14} /> Tidy map
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class={cn("flex", chromeMenuItem)}
                      onClick={() => {
                        setStudioActionsOpen(false);
                        workspaceController.request({ kind: "map.history.toggle" });
                      }}
                    >
                      <Icon name="clock" size={14} /> Version history
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class={cn("flex", chromeMenuItem)}
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
                      class={cn("flex", chromeMenuItem)}
                      onClick={() => {
                        setStudioActionsOpen(false);
                        void exportSelected();
                      }}
                    >
                      <Icon name="download" size={14} /> Export map
                    </button>
                    <button
                      type="button"
                      class={cn("flex", chromeMenuItem)}
                      onClick={() => {
                        setStudioActionsOpen(false);
                        studioActionsTrigger?.focus({ preventScroll: true });
                        setHelpOpen(true);
                      }}
                    >
                      <Icon name="info" size={14} /> Help
                      <kbd class="ml-auto text-micro font-normal text-[var(--text-weaker)]">⌘K</kbd>
                    </button>
                    <button
                      type="button"
                      class={cn("flex", chromeMenuItemDanger)}
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
              <Show when={authoringMap() && graphRunReadiness().visible}>
                <AppMapPrimaryActionButton
                  action={graphPrimaryAction()}
                  fallbackTip={graphRunReadiness().label}
                  onActivate={runSelectedTest}
                />
                <Button
                  variant="secondary"
                  size="lg"
                  class={cn(
                    "text-caption",
                    combineOpen() && "bg-[var(--surface-base)] text-[var(--text-strong)]",
                  )}
                  aria-label={combineOpen() ? "Close Repeat" : "Open Repeat"}
                  aria-pressed={combineOpen()}
                  data-tip={
                    combineOpen()
                      ? "Close Repeat"
                      : "Repeat Tests over languages, devices, or other selected values."
                  }
                  disabled={
                    server.isOffline() ||
                    !selectedMap() ||
                    Object.keys(selectedMap()!.screens).length === 0
                  }
                  onClick={() => toggleCombine()}
                >
                  <Icon name="grid" size={13} />
                  <span class="max-[720px]:hidden">Repeat</span>
                </Button>
              </Show>
            </Show>
          </div>
        </header>

        <OfflineGate overlay>
          <Show when={area() === "maps"}>
            <section class={shellStudio}>
              <div
                class={
                  selectedMap()
                    ? "relative flex min-h-0 min-w-0 flex-1"
                    : "grid min-h-0 min-w-0 flex-1 grid-cols-1"
                }
              >
                <Show
                  when={selectedMap()}
                  fallback={
                    <Suspense fallback={<WorkspaceSkeleton label="canvas" />}>
                      <EmptyAppMap
                        deviceOpen={devicePanelOpen()}
                        creating={creatingBlankMap()}
                        onToggleDevice={toggleDevicePanel}
                        onOpenTargets={() => props.onOpenSettings("targets")}
                        onCaptureFirstScreen={() => void blankMapActions.capture()}
                        onRecordFirstTest={() => void blankMapActions.record()}
                        onImportYaml={importTestYaml}
                        onExportYaml={() => void exportSelected()}
                      />
                    </Suspense>
                  }
                >
                  <div class={cn(shellMapWrap, "flex flex-1")}>
                    <StudioAuthoringWorkspace
                      workspaceController={workspaceController}
                      mode={mapMode()}
                      navigatorOpen={navOpen()}
                      onMode={setMapMode}
                      onOpenTargets={() => props.onOpenSettings("targets")}
                      onOpenVariables={() => setVariablesOpen(true)}
                      onOpenCombine={toggleCombine}
                      onOpenRun={(id) => {
                        server.setSelectedJobId(id);
                        setArea("runs");
                      }}
                      onImportYaml={importTestYaml}
                      onExportYaml={() => void exportSelected()}
                    />
                  </div>
                  <Show when={settingsOpen()}>
                    <MapPropertiesPanel
                      presentation="floating"
                      onClose={() => setSettingsOpen(false)}
                      onOpenVariables={() => setVariablesOpen(true)}
                    />
                  </Show>
                </Show>
                <Show when={combineOpen()}>
                  <StudioShellCombineRail
                    onOpenRun={(runId) => workspaceController.request({ kind: "run.open", runId })}
                    combineId={combineFocusId()}
                    focusSection={combineFocusSection()}
                    collapsed={combineCollapsed()}
                    onOpenDevice={() => {
                      setCombineCollapsed(true);
                      if (!devicePanelOpen()) workspaceController.request({ kind: "device.show" });
                    }}
                    onExpand={() => setCombineCollapsed(false)}
                    onClose={() => {
                      setCombineOpen(false);
                      setCombineFocusId(undefined);
                      setCombineFocusSection(undefined);
                    }}
                  />
                </Show>
              </div>
            </section>
          </Show>

          <Show when={area() === "runs"}>
            <Suspense fallback={<WorkspaceSkeleton label="runs" />}>
              <RunsWorkspace
                onOpenMap={openMap}
                onOpenTest={openTest}
                onOpenTests={() => setArea("maps")}
              />
            </Suspense>
          </Show>

          <Show when={area() === "changes"}>
            <Suspense fallback={<WorkspaceSkeleton label="changes" />}>
              <ChangesWorkspace
                onOpenRun={(runId) => {
                  server.setSelectedJobId(runId);
                  setArea("runs");
                }}
                onOpenMap={openMap}
              />
            </Suspense>
          </Show>
        </OfflineGate>
      </main>
      <Show when={variablesOpen()}>
        <StudioShellVariablesDialog
          ref={(element) => {
            variablesDialog = element;
          }}
          onClose={() => setVariablesOpen(false)}
          onConfigureProvider={() => {
            setVariablesOpen(false);
            props.onOpenSettings();
          }}
        />
      </Show>
      <Show when={importReview()}>
        {(review) => (
          <StudioImportReviewDialog
            review={review()}
            ref={(element) => {
              importReviewDialog = element;
            }}
            onCancel={() => setImportReview(null)}
            onConfirm={(conflict) => void confirmImport(conflict)}
          />
        )}
      </Show>
      <Show when={helpOpen()}>
        <StudioShellShortcutsSheet onClose={() => setHelpOpen(false)} />
      </Show>
    </div>
  );
}
