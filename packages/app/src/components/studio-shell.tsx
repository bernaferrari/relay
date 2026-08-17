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
import { useRecorder } from "../context/recorder";
import { DevicePicker } from "./device-picker";
import { AppMapPrimaryActionButton } from "./app-map-primary-action-button";
import { OfflineGate } from "./offline-gate";
import { MapPropertiesPanel } from "./test-details-panel";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { displayTitle } from "../lib/job";
import { deviceReadiness } from "../lib/device-readiness";
import type { CanvasCombineSection } from "../lib/app-map-combine-canvas";
import { toast } from "../context/toast";
import { confirmAction } from "./confirm-dialog";
import { trapFocus } from "../lib/modal";
import {
  chromeMenuItem,
  chromeMenuItemDanger,
  modalPanel,
  modalScrim,
  eyebrow,
  productIconButton,
} from "../lib/ui";
import { WorkspaceSkeleton } from "./workspace-skeleton";
import {
  shellRoot,
  shellRootNavVar,
  shellMain,
  shellTopbar,
  shellTopbarContext,
  shellTopbarTitle,
  shellTopbarActions,
  shellStudio,
  shellMapWrap,
  shellDragStrip,
} from "../lib/shell-layout";
import { appMapStartupDecision } from "../lib/app-map-startup";
import { appMapLibraryItem } from "../lib/app-map-library";
import { appMapPrimaryAction } from "../lib/app-map-primary-action";
import { matchLiveScreen } from "../lib/app-map-live-location";
import type { AppMapRunReadiness as GraphRunReadiness } from "../lib/app-map-run-readiness";
import type { SettingsSection } from "../pages/settings";
import { AuthoringSurfaceSwitch, type AuthoringSurface } from "./authoring-surface-switch";
import { StudioAuthoringWorkspace } from "./studio-authoring-workspace";
import { nextMapTitle, readRememberedDevicePanelPreference } from "../lib/studio-shell-preferences";

type ProductArea = "tests" | "runs";
type MapLibraryArea = ProductArea;
const DataWorkspace = lazy(() =>
  import("./workspaces/data-workspace").then((module) => ({ default: module.DataWorkspace })),
);
const RunsWorkspace = lazy(() =>
  import("./runs-workspace").then((module) => ({ default: module.RunsWorkspace })),
);
const EmptyAppMap = lazy(() =>
  import("./app-map-empty").then((module) => ({ default: module.EmptyAppMap })),
);
const MapLibrary = lazy(() =>
  import("./map-library").then((module) => ({ default: module.MapLibrary })),
);
const AppMapCombine = lazy(() =>
  import("./app-map-combine").then((module) => ({ default: module.AppMapCombine })),
);

export function StudioShell(props: { onOpenSettings: (section?: SettingsSection) => void }) {
  const server = useServer();
  const recorder = useRecorder();
  const [area, setArea] = createSignal<ProductArea>(
    new URLSearchParams(window.location.search).has("run") ? "runs" : "tests",
  );
  const [authoringSurface, setAuthoringSurface] = createSignal<AuthoringSurface>("test");
  // The App Map is the only authoring surface. Device remains one click away.
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [variablesOpen, setVariablesOpen] = createSignal(false);
  const [combineOpen, setCombineOpen] = createSignal(false);
  const [combineFocusId, setCombineFocusId] = createSignal<string>();
  const [combineFocusSection, setCombineFocusSection] = createSignal<CanvasCombineSection>();
  const [query, setQuery] = createSignal("");
  const [navOpen, setNavOpen] = createSignal(false);
  const [studioActionsOpen, setStudioActionsOpen] = createSignal(false);
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
  const [importReview, setImportReview] = createSignal<{
    yaml: string;
    appMap: AppMap;
    exists: boolean;
  } | null>(null);

  const selectedMap = createMemo(() => server.selectedAppMap());
  const [mapNameDraft, setMapNameDraft] = createSignal("");
  createEffect(() => setMapNameDraft(selectedMap()?.name ?? "My map"));
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
  const visibleStudioActionItems = () =>
    studioActionsMenu
      ? [...studioActionsMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(
          (item) => !item.disabled && item.offsetParent !== null,
        )
      : [];
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
    const openRunHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (detail?.jobId) server.setSelectedJobId(detail.jobId);
      setArea("runs");
    };
    window.addEventListener("relay:open-run-history", openRunHistory);
    onCleanup(() => window.removeEventListener("relay:open-run-history", openRunHistory));
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
  createEffect(() => {
    if (!studioActionsOpen()) return;
    queueMicrotask(() => visibleStudioActionItems()[0]?.focus());
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
      if (area() !== "tests") return;
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
    if (selectedMap()) {
      window.dispatchEvent(new CustomEvent("relay:toggle-device-panel"));
      return;
    }
    setDevicePanelOpen((open) => !open);
  };
  const toggleRunMatrix = (combineId?: string, section?: CanvasCombineSection) => {
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
    window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
    setCombineFocusId(requestedId);
    setCombineFocusSection(undefined);
    setCombineOpen(true);
    if (section) queueMicrotask(() => setCombineFocusSection(section));
  };
  const openDevicePicker = () => {
    if (area() === "tests" && !devicePanelOpen()) {
      window.dispatchEvent(new CustomEvent("relay:toggle-device-panel"));
    }
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("relay:open-device-picker")));
  };
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
      window.dispatchEvent(
        new CustomEvent("relay:open-run-history", { detail: { jobId: active?.id } }),
      );
      return;
    }
    if (action.kind === "record-path") {
      if (!devicePanelOpen()) toggleDevicePanel();
      window.dispatchEvent(new CustomEvent("relay:record-path"));
      return;
    }
    if (action.kind === "capture-screen") {
      if (!devicePanelOpen()) toggleDevicePanel();
      window.dispatchEvent(new CustomEvent("relay:capture-screen"));
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
    window.dispatchEvent(new CustomEvent("relay:run-app-map"));
  };
  const mapItems = createMemo(() => {
    const needle = query().trim().toLowerCase();
    const rows = server.appMaps().map(appMapLibraryItem);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return needle ? rows.filter((appMap) => appMap.name.toLowerCase().includes(needle)) : rows;
  });
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
      const title = nextMapTitle(server.appMaps());
      createdMap = await server.createAppMap(crypto.randomUUID(), title);
      const captured = await recorder.captureMapScreen(createdMap.id, { title: "Start" });
      if (!captured) throw new Error("Relay could not capture the current screen");
      await server.refreshAppMaps();
      server.setSelectedAppMapId(captured.appMap.id);
      setArea("tests");
      setAuthoringSurface("map");
      setSettingsOpen(false);
      setNavOpen(false);
      toast("Start screen saved · record a path or capture more screenshots", "success");
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

  function openMap(id: string): void {
    server.setSelectedAppMapId(id);
    setArea("tests");
    setAuthoringSurface("map");
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
      setArea("tests");
      setAuthoringSurface("test");
      setSettingsOpen(false);
      setNavOpen(false);
      return;
    }
    toast("This saved run is no longer attached to an editable map Test.", "warning");
  }

  /** New Map is a local blank canvas. It becomes durable only after its first
   * capture or note, so browsing and reopening Relay cannot create drafts. */
  function startNewMap(): void {
    setArea("tests");
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
            if (nextArea === "runs") setNavOpen(false);
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
          class="fixed inset-0 z-[70] cursor-default bg-black/10 backdrop-blur-[1px]"
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
              data-tip={navOpen() ? "Close library" : "Maps and runs"}
              onClick={() => setNavOpen((value) => !value)}
            >
              <Icon name="panel-left" size={17} />
            </button>
          </div>
          <div class={shellTopbarTitle}>
            <Show
              when={area() === "tests" && authoringSurface() === "map"}
              fallback={
                area() === "runs" ? (
                  <strong class="max-w-full truncate text-center text-body font-medium text-[var(--text-base)]">
                    Run history
                  </strong>
                ) : null
              }
            >
              <input
                type="text"
                size={Math.max(12, Math.min(34, displayTitle(mapNameDraft()).length + 1))}
                class="h-8 max-w-full min-w-[120px] cursor-text bg-transparent px-2 text-center font-medium text-[var(--text-base)] outline-none transition-[box-shadow,color] duration-150 placeholder:text-[var(--text-weak)] hover:text-[var(--text-strong)] focus:text-[var(--text-strong)] focus:shadow-[inset_0_-1px_0_var(--border-strong-base)] max-[680px]:min-w-0"
                aria-label="Map name"
                data-focus-contained
                data-tip="Rename map"
                value={displayTitle(mapNameDraft())}
                placeholder="My map"
                spellcheck={false}
                disabled={server.isOffline()}
                onFocus={() => {
                  titleBeforeEdit = mapNameDraft();
                }}
                onInput={(event) => setMapNameDraft(event.currentTarget.value)}
                onBlur={() => {
                  const name = mapNameDraft().trim() || "My map";
                  setMapNameDraft(name);
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
          <div
            class={shellTopbarActions}
            inert={server.isOffline()}
            aria-hidden={server.isOffline() ? "true" : undefined}
          >
            <Show when={area() === "tests"}>
              <Show when={selectedMap()}>
                <AuthoringSurfaceSwitch value={authoringSurface()} onChange={setAuthoringSurface} />
              </Show>
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
                      const items = visibleStudioActionItems();
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
                        window.dispatchEvent(new CustomEvent("relay:close-device-panel"));
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
                        window.dispatchEvent(
                          new CustomEvent("relay:undo-request", { detail: { redo: false } }),
                        );
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
                        window.dispatchEvent(
                          new CustomEvent("relay:undo-request", { detail: { redo: true } }),
                        );
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
                      aria-label="Re-layout map"
                      data-tip="Arrange screens to reduce connector crossings"
                      onClick={() => {
                        setStudioActionsOpen(false);
                        window.dispatchEvent(new CustomEvent("relay:tidy-map"));
                        queueMicrotask(() => studioActionsTrigger?.focus());
                      }}
                    >
                      <Icon name="grid" size={14} /> Re-layout map
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class={cn("flex", chromeMenuItem)}
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
                      role="menuitem"
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
              <Show when={authoringSurface() === "map" && graphRunReadiness().visible}>
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
                  aria-label={combineOpen() ? "Close run matrix" : "Open run matrix"}
                  aria-pressed={combineOpen()}
                  data-tip={
                    combineOpen()
                      ? "Close run matrix"
                      : "Multiply modifiers such as languages or models by reusable tests."
                  }
                  disabled={
                    server.isOffline() ||
                    !selectedMap() ||
                    Object.keys(selectedMap()!.screens).length === 0
                  }
                  onClick={() => toggleRunMatrix()}
                >
                  <Icon name="grid" size={13} />
                  <span class="max-[720px]:hidden">Run matrix</span>
                </Button>
              </Show>
            </Show>
          </div>
        </header>

        <OfflineGate overlay>
          <Show when={area() === "tests"}>
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
                        onCaptureFirstScreen={() => void captureFirstScreenFromBlankMap()}
                      />
                    </Suspense>
                  }
                >
                  <div class={cn(shellMapWrap, "flex flex-1")}>
                    <StudioAuthoringWorkspace
                      surface={authoringSurface()}
                      navigatorOpen={navOpen()}
                      onOpenSurface={setAuthoringSurface}
                      onOpenTargets={() => props.onOpenSettings("targets")}
                      onOpenVariables={() => setVariablesOpen(true)}
                      onOpenCombine={toggleRunMatrix}
                      onOpenRun={(id) => {
                        server.setSelectedJobId(id);
                        setArea("runs");
                      }}
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
                  <aside
                    class="relative z-[6] flex min-h-0 w-[clamp(420px,40vw,560px)] shrink-0 overflow-hidden border-l border-[var(--border-strong-base)] bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-[-12px_0_32px_rgb(0_0_0/10%)] max-[760px]:absolute max-[760px]:inset-y-2 max-[760px]:right-2 max-[760px]:w-[min(560px,calc(100%-16px))] max-[760px]:rounded-2xl max-[760px]:border"
                    aria-label="Run matrix"
                    onWheel={(event) => event.stopPropagation()}
                  >
                    <Suspense fallback={<WorkspaceSkeleton label="run matrix" />}>
                      <AppMapCombine
                        combineId={combineFocusId()}
                        focusSection={combineFocusSection()}
                        onOpenDevice={() => {
                          setCombineOpen(false);
                          setCombineFocusId(undefined);
                          setCombineFocusSection(undefined);
                          if (!devicePanelOpen()) {
                            window.dispatchEvent(new CustomEvent("relay:toggle-device-panel"));
                          }
                        }}
                        onClose={() => {
                          setCombineOpen(false);
                          setCombineFocusId(undefined);
                          setCombineFocusSection(undefined);
                        }}
                      />
                    </Suspense>
                  </aside>
                </Show>
              </div>
            </section>
          </Show>

          <Show when={area() === "runs"}>
            <Suspense fallback={<WorkspaceSkeleton label="runs" />}>
              <RunsWorkspace
                onOpenMap={openMap}
                onOpenTest={openTest}
                onOpenTests={() => setArea("tests")}
              />
            </Suspense>
          </Show>
        </OfflineGate>
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
            aria-label="Modifiers"
            tabindex={-1}
          >
            <Suspense fallback={<WorkspaceSkeleton label="modifiers" />}>
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
              <header class="flex items-start justify-between gap-3 border-b border-[var(--border-weak-base)] px-4 py-3.5">
                <div>
                  <span class={eyebrow}>Map file</span>
                  <h3
                    id="import-review-title"
                    class="mt-1 text-title font-semibold text-[var(--text-strong)]"
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
              <div class="mx-4 mt-3.5 flex items-center gap-3 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3">
                <span class="grid size-9 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] text-[var(--icon-success-base)]">
                  <Icon name="check" size={16} />
                </span>
                <div class="min-w-0">
                  <strong class="block text-body text-[var(--text-strong)]">
                    {review().appMap.name}
                  </strong>
                  <small class="block text-caption text-[var(--text-weak)]">
                    {review().appMap.id} · {Object.keys(review().appMap.screens).length} screen
                    {Object.keys(review().appMap.screens).length === 1 ? "" : "s"} ·{" "}
                    {Object.keys(review().appMap.connections).length} connection
                    {Object.keys(review().appMap.connections).length === 1 ? "" : "s"}
                  </small>
                </div>
              </div>
              <details class="mx-4 my-3 rounded-lg border border-[var(--border-weak-base)] bg-[var(--background-deep)] px-3 py-2">
                <summary class="cursor-pointer text-caption text-[var(--text-base)]">
                  Preview portable YAML
                </summary>
                <pre class="mt-2 max-h-48 overflow-auto font-mono text-caption/[1.5] text-[var(--text-weak)]">
                  {review().yaml}
                </pre>
              </details>
              <footer class="flex items-center justify-between gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
                <p class="m-0 max-w-[28ch] text-caption/[1.45] text-[var(--text-weak)]">
                  {review().exists
                    ? "Replace this map, or import a separate copy with the same screens and paths."
                    : "Relay will add this portable map to the current project."}
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
