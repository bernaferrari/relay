import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import type {
  CompatibilityMatrix,
  TargetCapability,
  TargetProfile,
  TargetSelector,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useTheme } from "@relay/ui/theme/context";
import { usePlatform, type DesktopUpdateState } from "../context/platform";
import { useServer } from "../context/server";
import { useCommand } from "../context/command";
import { Icon } from "../components/icon";
import { IconButton } from "@relay/ui/icon-button";
import { trapFocus } from "../lib/modal";
import { cn } from "../lib/cn";
import { mono, modalPanel, modalScrim } from "../lib/ui";
import { platformLabel } from "../lib/target-presentation";
import { EmptyState } from "../components/empty-state";
import { PrivacySettingsPanel } from "../components/privacy-settings-panel";
import { AppearanceSettingsPanel } from "../components/appearance-settings-panel";
import {
  MatrixSelectorEditor,
  matrixCapabilities,
  matrixPlatforms,
  matrixSummary,
  readableCapability,
  selectorDraftFrom,
  selectorFromDraft,
  type MatrixSelectorDraft,
} from "../components/matrix-selector-editor";

const rowCls =
  "flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-b-0";
const rowCopyCls = "flex min-w-0 flex-col gap-0.5";
const rowTitleCls = "text-12-medium text-text-strong";
const rowDescCls = "text-12-regular leading-snug text-text-weak";
const inputCls =
  "h-8 w-full rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-regular text-text-strong focus:border-border-focus focus:outline-none";

export type SettingsSection =
  | "appearance"
  | "targets"
  | "matrices"
  | "devices"
  | "privacy"
  | "server"
  | "recipes"
  | "about";

export function SettingsPage(props: { onClose: () => void; initialSection?: SettingsSection }) {
  const theme = useTheme();
  const platform = usePlatform();
  const server = useServer();
  const cmd = useCommand();
  let dialogRef: HTMLDivElement | undefined;
  let matrixFileInput: HTMLInputElement | undefined;

  const [section, setSection] = createSignal<SettingsSection>(props.initialSection ?? "appearance");
  const [urlDraft, setUrlDraft] = createSignal("");
  const [prodDraft, setProdDraft] = createSignal("");
  const [serverSaved, setServerSaved] = createSignal(false);
  const [prodSaved, setProdSaved] = createSignal(false);
  const [targetName, setTargetName] = createSignal("Chat app");
  const [targetUrl, setTargetUrl] = createSignal("");
  const [targetBusy, setTargetBusy] = createSignal(false);
  const [openingTargetId, setOpeningTargetId] = createSignal<string | null>(null);
  const [targetError, setTargetError] = createSignal("");
  const [preflight, setPreflight] = createSignal<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);
  const [matrixName, setMatrixName] = createSignal("");
  const [matrixTargets, setMatrixTargets] = createSignal<string[]>([]);
  const [matrixMode, setMatrixMode] = createSignal<"targets" | "rules">("targets");
  const [matrixPlatformsSelected, setMatrixPlatformsSelected] = createSignal<
    TargetProfile["platform"][]
  >([]);
  const [matrixOsPrefix, setMatrixOsPrefix] = createSignal("");
  const [matrixNameIncludes, setMatrixNameIncludes] = createSignal("");
  const [matrixCapabilitiesSelected, setMatrixCapabilitiesSelected] = createSignal<
    TargetCapability[]
  >([]);
  const [matrixAdditionalDrafts, setMatrixAdditionalDrafts] = createSignal<MatrixSelectorDraft[]>(
    [],
  );
  const [editingMatrixId, setEditingMatrixId] = createSignal<string | null>(null);
  const [matrixComposerOpen, setMatrixComposerOpen] = createSignal(false);
  const [matrixBusy, setMatrixBusy] = createSignal(false);
  const [matrixError, setMatrixError] = createSignal("");
  const [matrixPreview, setMatrixPreview] = createSignal<{
    id: string;
    included: string[];
    excluded: string[];
  } | null>(null);
  const [updateState, setUpdateState] = createSignal<DesktopUpdateState | null>(null);
  const [checkingUpdates, setCheckingUpdates] = createSignal(false);
  const [appleTeamId, setAppleTeamId] = createSignal("");
  const [appleBundleId, setAppleBundleId] = createSignal("");
  const [appleSigningIdentity, setAppleSigningIdentity] = createSignal("");
  const [appleProvisioningProfile, setAppleProvisioningProfile] = createSignal("");
  const [appleSetupBusy, setAppleSetupBusy] = createSignal(false);
  const [appleSetupError, setAppleSetupError] = createSignal("");
  const [appleSetupSaved, setAppleSetupSaved] = createSignal(false);
  const [appleAdvancedOpen, setAppleAdvancedOpen] = createSignal(false);

  onMount(() => {
    setSection(props.initialSection ?? "appearance");
    setUrlDraft(server.serverUrl());
    setProdDraft(server.prodAccountMatch());
    void server.refreshTargets();
    void server.refreshTargetProfiles();
    void server.refreshMatrices();
    void server
      .refreshAppleDeviceSetup()
      .then((status) => {
        const setup = status.setup.ios ?? status.suggestion;
        if (!setup) return;
        setAppleTeamId(setup.teamId);
        setAppleBundleId(setup.bundleId);
        setAppleSigningIdentity(setup.signingIdentity ?? "");
        setAppleProvisioningProfile(setup.provisioningProfile ?? "");
      })
      .catch(() => undefined);
    void server.refreshAndroidDeviceSetup().catch(() => undefined);
    if (platform.updates) {
      void platform.updates
        .getState()
        .then(setUpdateState)
        .catch(() => undefined);
      onCleanup(platform.updates.subscribe(setUpdateState));
    }
    onCleanup(cmd.pushModal());
    if (dialogRef) onCleanup(trapFocus(dialogRef));
  });

  async function saveServerUrl() {
    await server.setServerUrl(urlDraft().trim());
    await server.retryConnection();
    setServerSaved(true);
    setTimeout(() => setServerSaved(false), 1500);
  }
  async function saveProdMatch() {
    await server.setProdAccountMatch(prodDraft().trim());
    setProdSaved(true);
    setTimeout(() => setProdSaved(false), 1500);
  }

  async function saveAppleSetup(event?: SubmitEvent) {
    event?.preventDefault();
    setAppleSetupBusy(true);
    setAppleSetupError("");
    try {
      await server.saveAppleDeviceSetup({
        teamId: appleTeamId(),
        bundleId: appleBundleId(),
        signingIdentity: appleSigningIdentity(),
        provisioningProfile: appleProvisioningProfile(),
      });
      setAppleSetupSaved(true);
      setTimeout(() => setAppleSetupSaved(false), 1_500);
    } catch (error) {
      setAppleSetupError(error instanceof Error ? error.message : String(error));
    } finally {
      setAppleSetupBusy(false);
    }
  }

  async function createBrowserTarget(event: SubmitEvent) {
    event.preventDefault();
    setTargetError("");
    setTargetBusy(true);
    try {
      await server.saveBrowserTarget({
        name: targetName().trim(),
        startUrl: targetUrl().trim(),
        headless: false,
      });
      setTargetUrl("");
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : String(error));
    } finally {
      setTargetBusy(false);
    }
  }

  async function checkTarget(id: string) {
    setPreflight({ id, ok: false, message: "Checking browser and isolated profile…" });
    try {
      const result = await server.preflightTarget(id);
      setPreflight({
        id,
        ok: result.ok,
        message: result.checks.map((check) => check.message).join(" · "),
      });
    } catch (error) {
      setPreflight({
        id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function openTarget(id: string) {
    setTargetError("");
    setOpeningTargetId(id);
    try {
      await server.openBrowserTarget(id);
    } catch (error) {
      setTargetError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningTargetId(null);
    }
  }

  function toggleMatrixTarget(id: string): void {
    setMatrixTargets((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleMatrixPlatform(platform: TargetProfile["platform"]): void {
    setMatrixPlatformsSelected((current) =>
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform],
    );
  }

  function toggleMatrixCapability(capability: TargetCapability): void {
    setMatrixCapabilitiesSelected((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  }

  function resetMatrixForm(): void {
    setMatrixName("");
    setMatrixTargets([]);
    setMatrixMode("targets");
    setMatrixPlatformsSelected([]);
    setMatrixOsPrefix("");
    setMatrixNameIncludes("");
    setMatrixCapabilitiesSelected([]);
    setMatrixAdditionalDrafts([]);
    setEditingMatrixId(null);
    setMatrixComposerOpen(false);
    setMatrixError("");
  }

  function editMatrix(matrix: CompatibilityMatrix): void {
    const selector = matrix.selectors[0] ?? {};
    setMatrixAdditionalDrafts(matrix.selectors.slice(1).map(selectorDraftFrom));
    setEditingMatrixId(matrix.id);
    setMatrixComposerOpen(true);
    setMatrixName(matrix.name);
    if (selector.targetIds?.length) {
      setMatrixMode("targets");
      setMatrixTargets([...selector.targetIds]);
    } else {
      setMatrixMode("rules");
      setMatrixTargets([]);
    }
    setMatrixPlatformsSelected([...(selector.platforms ?? [])]);
    setMatrixOsPrefix(selector.osVersionPrefixes?.join(", ") ?? "");
    setMatrixNameIncludes(selector.nameIncludes?.join(", ") ?? "");
    setMatrixCapabilitiesSelected([...(selector.requiredCapabilities ?? [])]);
    setSection("matrices");
  }

  function addMatrixRule(): void {
    setMatrixAdditionalDrafts((current) => [
      ...current,
      {
        mode: "rules",
        targetIds: [],
        platforms: [],
        osVersionPrefixes: "",
        nameIncludes: "",
        capabilities: [],
      },
    ]);
  }

  function matrixSelectorsFromForm(): TargetSelector[] {
    if (matrixMode() === "targets") {
      return [{ targetIds: matrixTargets() }, ...matrixAdditionalDrafts().map(selectorFromDraft)];
    }
    const osPrefixes = matrixOsPrefix()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const names = matrixNameIncludes()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const selector: TargetSelector = {};
    if (matrixPlatformsSelected().length) selector.platforms = matrixPlatformsSelected();
    if (osPrefixes.length) selector.osVersionPrefixes = osPrefixes;
    if (names.length) selector.nameIncludes = names;
    if (matrixCapabilitiesSelected().length) {
      selector.requiredCapabilities = matrixCapabilitiesSelected();
    }
    return [selector, ...matrixAdditionalDrafts().map(selectorFromDraft)];
  }

  function selectorDraftValid(draft: MatrixSelectorDraft): boolean {
    if (draft.mode === "targets") return draft.targetIds.length > 0;
    return (
      draft.platforms.length > 0 ||
      draft.osVersionPrefixes.split(",").some((value) => value.trim()) ||
      draft.nameIncludes.split(",").some((value) => value.trim()) ||
      draft.capabilities.length > 0
    );
  }

  const matrixFormValid = () => {
    if (!matrixName().trim()) return false;
    const primaryValid =
      matrixMode() === "targets"
        ? matrixTargets().length > 0
        : matrixPlatformsSelected().length > 0 ||
          matrixOsPrefix()
            .split(",")
            .some((value) => value.trim()) ||
          matrixNameIncludes()
            .split(",")
            .some((value) => value.trim()) ||
          matrixCapabilitiesSelected().length > 0;
    return primaryValid && matrixAdditionalDrafts().every(selectorDraftValid);
  };

  const matrixComposerVisible = () =>
    matrixComposerOpen() || editingMatrixId() !== null || server.matrices().length === 0;

  async function createMatrix(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = matrixName().trim();
    const selectors = matrixSelectorsFromForm();
    if (!matrixFormValid()) return;
    const id =
      editingMatrixId() ??
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 96);
    if (!id) return;
    setMatrixError("");
    setMatrixBusy(true);
    try {
      await server.saveCompatibilityMatrix({
        id,
        name,
        selectors,
      });
      resetMatrixForm();
    } catch (error) {
      setMatrixError(
        error instanceof Error ? error.message : "Could not save this test environment.",
      );
    } finally {
      setMatrixBusy(false);
    }
  }

  async function previewMatrix(id: string): Promise<void> {
    setMatrixError("");
    try {
      const expansion = await server.resolveCompatibilityMatrix(id);
      setMatrixPreview({
        id,
        included: expansion.profiles.map((profile) => profile.name),
        excluded: expansion.excluded.map((item) => `${item.profile.name}: ${item.reason}`),
      });
    } catch (error) {
      setMatrixError(error instanceof Error ? error.message : "Could not preview these devices.");
    }
  }

  async function downloadMatrixYaml(id: string): Promise<void> {
    setMatrixError("");
    try {
      const yaml = await server.loadCompatibilityMatrixYaml(id);
      if (!yaml) throw new Error("This environment could not be exported.");
      const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${id}.relay.matrix.yaml`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setMatrixError(error instanceof Error ? error.message : "Could not export this environment.");
    }
  }

  async function importMatrixYaml(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setMatrixError("");
    try {
      await server.importCompatibilityMatrixYaml(await file.text());
    } catch (error) {
      setMatrixError(error instanceof Error ? error.message : "Could not import this YAML file.");
    }
  }

  async function checkForUpdates(): Promise<void> {
    if (!platform.updates) return;
    setCheckingUpdates(true);
    try {
      await platform.updates.check();
      setUpdateState(await platform.updates.getState());
    } finally {
      setCheckingUpdates(false);
    }
  }

  const healthText = () =>
    server.health() === "online"
      ? "Connected"
      : server.health() === "offline"
        ? "Offline"
        : "Connecting…";

  const healthTone = () => {
    if (server.health() === "online") return "text-icon-success-base";
    if (server.health() === "offline") return "text-icon-critical-base";
    return "text-text-weak";
  };

  const SECTIONS = [
    ["targets", "Browser targets"],
    ["matrices", "Test environments"],
    ["devices", "Mobile devices"],
    ["recipes", "Providers & accounts"],
    ["privacy", "Privacy & evidence"],
    ["server", "Connection"],
    ["appearance", "Appearance"],
    ["about", "About"],
  ] as const;

  return (
    <div
      class={cn(modalScrim, "flex items-start justify-center px-5 pt-[5vh] pb-5")}
      style={{ background: "rgb(0 0 0 / 0.48)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <div
        class={cn(
          modalPanel,
          "flex max-h-[90vh] w-[min(920px,100%)] flex-col overflow-hidden rounded-2xl",
        )}
        ref={(el) => {
          dialogRef = el;
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-border-weak-base px-[18px] pt-4 pb-3.5">
          <h2 class="m-0 text-16-medium tracking-tight text-text-strong">Settings</h2>
          <IconButton
            variant="ghost"
            size="normal"
            class="rounded-md"
            aria-label="Close settings"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={14} />
          </IconButton>
        </div>
        <main class="grid min-h-0 flex-1 grid-cols-[210px_1fr]">
          <nav
            class="flex flex-col gap-px border-r border-border-weak-base bg-background-base p-2 text-text-strong"
            aria-label="Settings sections"
          >
            <For each={SECTIONS}>
              {([id, label]) => (
                <button
                  type="button"
                  class={cn(
                    "rounded-md px-2.5 py-[7px] text-left text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong",
                    section() === id && "bg-surface-base-active text-text-strong",
                  )}
                  onClick={() => setSection(id)}
                >
                  {label}
                </button>
              )}
            </For>
          </nav>
          <div class="flex flex-col gap-1 overflow-y-auto bg-surface-raised-stronger-non-alpha px-5 pt-[18px] pb-6 text-12-regular text-text-strong">
            <Show when={section() === "appearance"}>
              <AppearanceSettingsPanel />
            </Show>

            <Show when={section() === "targets" || section() === "matrices"}>
              <Show when={section() === "targets"}>
                <div class="mb-4">
                  <h3 class="m-0 text-14-medium text-text-strong">Browser targets</h3>
                  <p class="mt-1 mb-0 text-12-regular leading-relaxed text-text-weak">
                    Give each website a private browser. Sign in once, then record and replay the
                    same tests you use on iOS and Android.
                  </p>
                </div>

                <form class="flex flex-col gap-3" onSubmit={createBrowserTarget}>
                  <label class="flex flex-col gap-1.5">
                    <span class={rowTitleCls}>Name</span>
                    <input
                      class={inputCls}
                      name="target-name"
                      autocomplete="off"
                      value={targetName()}
                      onInput={(event) => setTargetName(event.currentTarget.value)}
                      required
                    />
                  </label>
                  <label class="flex flex-col gap-1.5">
                    <span class={rowTitleCls}>Start URL</span>
                    <input
                      class={inputCls}
                      name="target-url"
                      type="url"
                      inputmode="url"
                      autocomplete="url"
                      spellcheck={false}
                      placeholder="https://chat.example.com"
                      value={targetUrl()}
                      onInput={(event) => setTargetUrl(event.currentTarget.value)}
                      aria-describedby="target-url-help"
                      required
                    />
                    <span id="target-url-help" class={rowDescCls}>
                      Relay opens this page in a dedicated profile for recording and replay.
                    </span>
                  </label>
                  <Show when={targetError()}>
                    <p class="m-0 text-12-regular text-icon-critical-base" role="alert">
                      {targetError()}
                    </p>
                  </Show>
                  <div>
                    <Button variant="primary" size="sm" type="submit" disabled={targetBusy()}>
                      {targetBusy() ? "Adding…" : "Add browser target"}
                    </Button>
                  </div>
                </form>

                <div class="mt-5 flex flex-col gap-2 border-t border-border-weak-base pt-4">
                  <Show
                    when={server.targets().length > 0}
                    fallback={
                      <EmptyState
                        size="sm"
                        align="start"
                        icon="server"
                        title="No browser targets yet"
                        description="Add a site above to record and replay web tests."
                        class="px-0"
                      />
                    }
                  >
                    <For each={server.targets()}>
                      {(target) => (
                        <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <strong class="block truncate text-12-medium text-text-strong">
                                {target.name}
                              </strong>
                              <span class="mt-0.5 block truncate text-12-regular text-text-weak">
                                {target.browser?.startUrl}
                              </span>
                            </div>
                            <div class="flex shrink-0 gap-1.5">
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={openingTargetId() === target.id}
                                onClick={() => void openTarget(target.id)}
                              >
                                {openingTargetId() === target.id ? "Opening…" : "Open & sign in"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void checkTarget(target.id)}
                              >
                                Preflight
                              </Button>
                              <IconButton
                                variant="ghost"
                                size="normal"
                                aria-label={`Delete ${target.name}`}
                                onClick={() => void server.deleteTarget(target.id)}
                              >
                                <Icon name="trash" size={14} />
                              </IconButton>
                            </div>
                          </div>
                          <Show when={preflight()?.id === target.id}>
                            <p
                              class={cn(
                                "mt-2 mb-0 text-12-regular leading-relaxed",
                                preflight()?.ok ? "text-icon-success-base" : "text-text-weak",
                              )}
                              role="status"
                            >
                              {preflight()?.message}
                            </p>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>

              <Show when={section() === "matrices"}>
                <section class="flex flex-col gap-4">
                  <header class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <h3 class="m-0 text-14-medium text-text-strong">Test environments</h3>
                      <p class="mt-1 mb-0 max-w-[34rem] text-12-regular leading-relaxed text-text-weak">
                        Save the devices and OS versions you test together, then run any test across
                        the full set.
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      <input
                        ref={(element) => (matrixFileInput = element)}
                        class="sr-only"
                        type="file"
                        accept=".yaml,.yml,text/yaml,application/yaml"
                        onChange={(event) => void importMatrixYaml(event)}
                      />
                      <Button variant="ghost" size="sm" onClick={() => matrixFileInput?.click()}>
                        Import YAML
                      </Button>
                      <Show when={!matrixComposerVisible()}>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            resetMatrixForm();
                            setMatrixComposerOpen(true);
                          }}
                        >
                          New environment
                        </Button>
                      </Show>
                    </div>
                  </header>

                  <Show when={matrixError()}>
                    <p
                      class="m-0 rounded-md bg-surface-critical-weak px-3 py-2 text-11-regular text-icon-critical-base"
                      role="alert"
                    >
                      {matrixError()}
                    </p>
                  </Show>

                  <Show when={matrixComposerVisible()}>
                    <form
                      class="flex flex-col gap-3 rounded-lg border border-border-weak-base bg-background-base p-3.5"
                      onSubmit={createMatrix}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <strong class="block text-12-medium text-text-strong">
                            {editingMatrixId() ? "Edit environment" : "New environment"}
                          </strong>
                          <span class="mt-0.5 block text-11-regular text-text-weak">
                            Choose specific devices or let Relay match compatible ones
                            automatically.
                          </span>
                        </div>
                        <Show when={server.matrices().length > 0 || editingMatrixId()}>
                          <IconButton
                            variant="ghost"
                            size="normal"
                            type="button"
                            aria-label="Close environment editor"
                            onClick={resetMatrixForm}
                          >
                            <Icon name="x" size={14} />
                          </IconButton>
                        </Show>
                      </div>
                      <label class="flex flex-col gap-1.5">
                        <span class={rowTitleCls}>Name</span>
                        <input
                          class={inputCls}
                          value={matrixName()}
                          placeholder="Release smoke"
                          autocomplete="off"
                          onInput={(event) => setMatrixName(event.currentTarget.value)}
                        />
                      </label>
                      <div
                        class="grid grid-cols-2 gap-1 rounded-lg bg-surface-raised-stronger-non-alpha p-1"
                        role="group"
                        aria-label="How this environment finds devices"
                      >
                        <button
                          type="button"
                          aria-pressed={matrixMode() === "targets"}
                          class={cn(
                            "h-8 rounded-md text-11-medium transition-colors",
                            matrixMode() === "targets"
                              ? "bg-surface-base text-text-strong shadow-sm"
                              : "text-text-weak hover:text-text-strong",
                          )}
                          onClick={() => setMatrixMode("targets")}
                        >
                          Choose devices
                        </button>
                        <button
                          type="button"
                          aria-pressed={matrixMode() === "rules"}
                          class={cn(
                            "h-8 rounded-md text-11-medium transition-colors",
                            matrixMode() === "rules"
                              ? "bg-surface-base text-text-strong shadow-sm"
                              : "text-text-weak hover:text-text-strong",
                          )}
                          onClick={() => setMatrixMode("rules")}
                        >
                          Match automatically
                        </button>
                      </div>
                      <Show when={matrixMode() === "targets"}>
                        <div class="max-h-56 overflow-y-auto rounded-lg border border-border-weak-base bg-background-base p-2">
                          <Show
                            when={server.targetProfiles().length > 0}
                            fallback={
                              <p class="m-2 text-12-regular text-text-weak">
                                Connect a device or add a browser target first.
                              </p>
                            }
                          >
                            <For each={server.targetProfiles()}>
                              {(profile) => (
                                <label class="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-12-regular text-text-strong hover:bg-surface-raised-stronger-non-alpha">
                                  <input
                                    type="checkbox"
                                    checked={matrixTargets().includes(profile.targetId)}
                                    onChange={() => toggleMatrixTarget(profile.targetId)}
                                  />
                                  <span class="min-w-0 flex-1 truncate">{profile.name}</span>
                                  <span class="text-10-regular text-text-weak">
                                    {platformLabel(profile.platform)}
                                  </span>
                                </label>
                              )}
                            </For>
                          </Show>
                        </div>
                      </Show>
                      <Show when={matrixMode() === "rules"}>
                        <div class="grid gap-3 rounded-lg border border-border-weak-base bg-background-base p-3">
                          <div>
                            <span class={rowTitleCls}>Platform</span>
                            <div class="mt-2 flex flex-wrap gap-1.5">
                              <For each={matrixPlatforms}>
                                {(platformName) => (
                                  <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-weak-base px-2.5 py-1 text-11-regular text-text-weak hover:border-border-strong-base hover:text-text-strong has-[:checked]:border-border-focus has-[:checked]:bg-surface-interactive-weak has-[:checked]:text-text-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2">
                                    <input
                                      class="sr-only"
                                      type="checkbox"
                                      checked={matrixPlatformsSelected().includes(platformName)}
                                      onChange={() => toggleMatrixPlatform(platformName)}
                                    />
                                    {platformLabel(platformName)}
                                  </label>
                                )}
                              </For>
                            </div>
                          </div>
                          <label class="flex flex-col gap-1.5">
                            <span class={rowTitleCls}>OS version starts with</span>
                            <input
                              class={inputCls}
                              value={matrixOsPrefix()}
                              placeholder="18, 19 (optional)"
                              onInput={(event) => setMatrixOsPrefix(event.currentTarget.value)}
                            />
                            <span class="text-10-regular text-text-weak">
                              Use commas for more than one version prefix.
                            </span>
                          </label>
                          <label class="flex flex-col gap-1.5">
                            <span class={rowTitleCls}>Name or model contains</span>
                            <input
                              class={inputCls}
                              value={matrixNameIncludes()}
                              placeholder="iPhone, Pixel, Chrome (optional)"
                              onInput={(event) => setMatrixNameIncludes(event.currentTarget.value)}
                            />
                          </label>
                          <div>
                            <span class={rowTitleCls}>Required capabilities</span>
                            <div class="mt-2 flex flex-wrap gap-1.5">
                              <For each={matrixCapabilities}>
                                {(capability) => (
                                  <label class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-weak-base px-2.5 py-1 text-11-regular text-text-weak hover:border-border-strong-base hover:text-text-strong has-[:checked]:border-border-focus has-[:checked]:bg-surface-interactive-weak has-[:checked]:text-text-strong has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2">
                                    <input
                                      class="sr-only"
                                      type="checkbox"
                                      checked={matrixCapabilitiesSelected().includes(capability)}
                                      onChange={() => toggleMatrixCapability(capability)}
                                    />
                                    {readableCapability(capability)}
                                  </label>
                                )}
                              </For>
                            </div>
                          </div>
                        </div>
                      </Show>
                      <Show when={matrixAdditionalDrafts().length > 0}>
                        <div class="grid gap-2.5">
                          <div class="flex items-center justify-between gap-3">
                            <div class="min-w-0">
                              <span class={rowTitleCls}>More matches</span>
                              <p class="mt-0.5 mb-0 text-10-regular text-text-weak">
                                Devices are included when any of these matches apply.
                              </p>
                            </div>
                            <span class="shrink-0 text-10-regular tabular-nums text-text-weak">
                              {matrixAdditionalDrafts().length}{" "}
                              {matrixAdditionalDrafts().length === 1 ? "rule" : "rules"}
                            </span>
                          </div>
                          <For each={matrixAdditionalDrafts()}>
                            {(draft, index) => (
                              <MatrixSelectorEditor
                                index={index() + 2}
                                draft={draft}
                                profiles={server.targetProfiles()}
                                onChange={(next) =>
                                  setMatrixAdditionalDrafts((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index() ? next : item,
                                    ),
                                  )
                                }
                                onRemove={() =>
                                  setMatrixAdditionalDrafts((current) =>
                                    current.filter((_, itemIndex) => itemIndex !== index()),
                                  )
                                }
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                      <Show when={matrixMode() === "rules"}>
                        <Button variant="ghost" size="sm" type="button" onClick={addMatrixRule}>
                          Add another match
                        </Button>
                      </Show>
                      <div>
                        <Button
                          variant="primary"
                          size="sm"
                          type="submit"
                          disabled={!matrixFormValid() || matrixBusy()}
                        >
                          {matrixBusy()
                            ? "Saving…"
                            : editingMatrixId()
                              ? "Save changes"
                              : "Save environment"}
                        </Button>
                        <Show when={editingMatrixId()}>
                          <Button variant="ghost" size="sm" type="button" onClick={resetMatrixForm}>
                            Cancel
                          </Button>
                        </Show>
                      </div>
                    </form>
                  </Show>
                  <div class="flex flex-col gap-2">
                    <Show when={server.matrices().length > 0}>
                      <For each={server.matrices()}>
                        {(matrix) => (
                          <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
                            <div class="flex items-center justify-between gap-3">
                              <div class="min-w-0">
                                <strong class="block truncate text-12-medium text-text-strong">
                                  {matrix.name}
                                </strong>
                                <span class="mt-0.5 block truncate text-11-regular text-text-weak">
                                  {matrixSummary(matrix)}
                                </span>
                              </div>
                              <div class="flex shrink-0 gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => editMatrix(matrix)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void previewMatrix(matrix.id)}
                                >
                                  Preview devices
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void downloadMatrixYaml(matrix.id)}
                                >
                                  Export YAML
                                </Button>
                                <IconButton
                                  variant="ghost"
                                  size="normal"
                                  aria-label={`Delete ${matrix.name}`}
                                  onClick={() => void server.deleteCompatibilityMatrix(matrix.id)}
                                >
                                  <Icon name="trash" size={14} />
                                </IconButton>
                              </div>
                            </div>
                            <Show when={matrixPreview()?.id === matrix.id}>
                              <p
                                class="mt-2 mb-0 text-11-regular leading-relaxed text-text-weak"
                                role="status"
                              >
                                Includes: {matrixPreview()!.included.join(", ") || "none"}.
                                <Show when={matrixPreview()!.excluded.length > 0}>
                                  {" "}
                                  Excluded: {matrixPreview()!.excluded.join("; ")}.
                                </Show>
                              </p>
                            </Show>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                </section>
              </Show>
            </Show>

            <Show when={section() === "privacy"}>
              <PrivacySettingsPanel />
            </Show>

            <Show when={section() === "devices"}>
              <section class="flex max-w-[36rem] flex-col gap-4">
                <header>
                  <h3 class="m-0 text-14-medium text-text-strong">Mobile devices</h3>
                  <p class="mt-1 mb-0 text-12-regular leading-relaxed text-text-weak">
                    Check what Relay needs before you connect a phone or tablet.
                  </p>
                </header>

                <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <h4 class="m-0 text-12-medium text-text-strong">Android devices</h4>
                      <p class="mt-1 mb-0 text-11-regular leading-snug text-text-weak">
                        Relay bundles its streaming runtime. Android Platform Tools provides adb.
                      </p>
                    </div>
                    <Show when={server.androidDeviceSetup()?.checks[0]}>
                      {(check) => (
                        <span
                          class={cn(
                            "shrink-0 rounded-full px-2 py-1 text-10-medium",
                            check().status === "ready"
                              ? "bg-surface-success-weak text-icon-success-base"
                              : "bg-surface-warning-weak text-icon-warning-base",
                          )}
                        >
                          {check().status === "ready" ? "Ready" : "Needs setup"}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show when={server.androidDeviceSetup()?.checks[0]}>
                    {(check) => (
                      <p class="mt-2 mb-0 text-11-regular leading-snug text-text-weak">
                        {check().detail}
                      </p>
                    )}
                  </Show>
                  <Show when={server.androidDeviceSetup()?.checks[0]?.status === "needs-attention"}>
                    <p class="mt-3 mb-0 text-11-regular leading-snug text-text-weak">
                      In Android Studio, open SDK Manager → SDK Tools and install Android SDK
                      Platform-Tools. Then reopen Relay.
                    </p>
                    <div class="mt-3 flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        onClick={() =>
                          void platform.openExternal?.(
                            "https://developer.android.com/tools/releases/platform-tools",
                          )
                        }
                      >
                        Get Platform Tools
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => void server.refreshAndroidDeviceSetup()}
                      >
                        Check again
                      </Button>
                    </div>
                  </Show>
                </div>

                <div class="border-t border-border-weak-base pt-4">
                  <h4 class="m-0 text-12-medium text-text-strong">Apple devices</h4>
                  <p class="mt-1 mb-0 text-11-regular leading-snug text-text-weak">
                    Relay uses Xcode to sign a small local runner for your iPhone or iPad.
                  </p>
                </div>

                <Show
                  when={server.appleDeviceSetup()}
                  fallback={
                    <div class="flex min-h-[104px] items-start rounded-lg border border-border-weak-base bg-background-base px-3 py-3">
                      <div class="flex items-start gap-2.5">
                        <span
                          class="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-text-weak border-t-transparent motion-reduce:animate-none"
                          role="status"
                          aria-label="Checking Apple recording setup"
                        />
                        <div>
                          <p class="m-0 text-12-medium text-text-strong">
                            Checking Apple recording
                          </p>
                          <p class="mt-1 mb-0 text-11-regular leading-snug text-text-weak">
                            Looking for Xcode and a signing identity on this Mac.
                          </p>
                        </div>
                      </div>
                    </div>
                  }
                >
                  {(appleStatus) => (
                    <>
                      {(() => {
                        const accountReady = () =>
                          appleStatus().checks.some(
                            (check) => check.id === "account" && check.status === "ready",
                          );
                        return (
                          <Show
                            when={accountReady() ? appleStatus().setup.ios : undefined}
                            fallback={
                              <Show
                                when={accountReady() ? appleStatus().suggestion : undefined}
                                fallback={
                                  <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
                                    <div class="flex items-start gap-2.5">
                                      <span class="mt-1 size-1.5 shrink-0 rounded-full bg-icon-warning-base" />
                                      <div class="min-w-0">
                                        <p class="m-0 text-12-medium text-text-strong">
                                          Sign in to Xcode to enable Apple recording
                                        </p>
                                        <p class="mt-1 mb-0 text-11-regular leading-snug text-text-weak">
                                          Relay found a development certificate, but Xcode needs an
                                          account for that Apple team before it can provision the
                                          runner.
                                        </p>
                                      </div>
                                    </div>
                                    <div class="mt-3 flex items-center gap-2">
                                      <Show when={platform.openXcode}>
                                        <Button
                                          variant="primary"
                                          size="sm"
                                          type="button"
                                          onClick={() => void platform.openXcode?.()}
                                        >
                                          Open Xcode
                                        </Button>
                                      </Show>
                                      <Button
                                        variant={platform.openXcode ? "secondary" : "primary"}
                                        size="sm"
                                        type="button"
                                        onClick={() => void server.refreshAppleDeviceSetup()}
                                      >
                                        Check again
                                      </Button>
                                      <button
                                        class="text-12-medium text-text-weak transition-colors duration-150 hover:text-text-strong"
                                        type="button"
                                        onClick={() => setAppleAdvancedOpen((open) => !open)}
                                      >
                                        Enter details manually
                                      </button>
                                    </div>
                                  </div>
                                }
                              >
                                {(suggestion) => (
                                  <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-3 shadow-xs-border-base">
                                    <div class="flex items-start gap-2.5">
                                      <span class="mt-1 size-1.5 shrink-0 rounded-full bg-icon-success-base" />
                                      <div class="min-w-0">
                                        <p class="m-0 text-12-medium text-text-strong">
                                          Set up Apple recording
                                        </p>
                                        <p class="mt-1 mb-0 text-11-regular leading-snug text-text-weak">
                                          Use {suggestion().label} to create Relay's private local
                                          runner.
                                        </p>
                                      </div>
                                    </div>
                                    <div class="mt-3 flex items-center gap-2">
                                      <Button
                                        variant="primary"
                                        size="sm"
                                        type="button"
                                        disabled={appleSetupBusy()}
                                        onClick={() => {
                                          setAppleTeamId(suggestion().teamId);
                                          setAppleBundleId(suggestion().bundleId);
                                          // The detected certificate identifies the team, but is
                                          // intentionally not an override. Xcode must retain
                                          // automatic signing for normal Relay setup.
                                          setAppleSigningIdentity("");
                                          setAppleProvisioningProfile("");
                                          void saveAppleSetup();
                                        }}
                                      >
                                        {appleSetupBusy()
                                          ? "Setting up…"
                                          : "Set up Apple recording"}
                                      </Button>
                                      <button
                                        class="text-12-medium text-text-weak transition-colors duration-150 hover:text-text-strong"
                                        type="button"
                                        onClick={() => setAppleAdvancedOpen((open) => !open)}
                                      >
                                        Change details
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </Show>
                            }
                          >
                            {(setup) => (
                              <div class="rounded-lg border border-border-weak-base bg-background-base px-3 py-3">
                                <div class="flex items-start justify-between gap-3">
                                  <div class="flex min-w-0 items-start gap-2.5">
                                    <span class="mt-1 size-1.5 shrink-0 rounded-full bg-icon-success-base" />
                                    <div class="min-w-0">
                                      <p class="m-0 text-12-medium text-text-strong">
                                        Apple runner details saved
                                      </p>
                                      <p class="mt-1 mb-0 truncate text-11-regular text-text-weak">
                                        Relay will ask Xcode to sign {setup().bundleId} when you
                                        record.
                                      </p>
                                    </div>
                                  </div>
                                </div>
                                <div class="mt-3 flex items-center gap-3">
                                  <Button size="sm" type="button" onClick={props.onClose}>
                                    Close settings
                                  </Button>
                                  <span class="text-11-regular text-text-weak">
                                    Return to your iPad to start recording.
                                  </span>
                                  <button
                                    class="ml-auto shrink-0 text-12-medium text-text-weak transition-colors duration-150 hover:text-text-strong"
                                    type="button"
                                    onClick={() => setAppleAdvancedOpen((open) => !open)}
                                  >
                                    Change
                                  </button>
                                </div>
                              </div>
                            )}
                          </Show>
                        );
                      })()}

                      <Show when={appleAdvancedOpen()}>
                        <form class="flex flex-col gap-3" onSubmit={saveAppleSetup}>
                          <div class="grid grid-cols-2 gap-3">
                            <label class="flex flex-col gap-1.5">
                              <span class={rowTitleCls}>Apple Team ID</span>
                              <input
                                class={inputCls}
                                value={appleTeamId()}
                                placeholder="ABCDE12345"
                                autocomplete="off"
                                spellcheck={false}
                                onInput={(event) => setAppleTeamId(event.currentTarget.value)}
                                required
                              />
                            </label>
                            <label class="flex flex-col gap-1.5">
                              <span class={rowTitleCls}>Local runner ID</span>
                              <input
                                class={inputCls}
                                value={appleBundleId()}
                                placeholder="com.yourteam.relay.runner"
                                autocomplete="off"
                                spellcheck={false}
                                onInput={(event) => setAppleBundleId(event.currentTarget.value)}
                                required
                              />
                            </label>
                          </div>
                          <details class="rounded-lg border border-border-weak-base bg-background-base px-3 py-2.5">
                            <summary class="cursor-pointer text-12-medium text-text-strong">
                              More signing options
                            </summary>
                            <div class="mt-3 grid grid-cols-2 gap-3">
                              <label class="flex flex-col gap-1.5">
                                <span class={rowTitleCls}>Signing identity</span>
                                <input
                                  class={inputCls}
                                  value={appleSigningIdentity()}
                                  placeholder="Use Xcode automatically"
                                  autocomplete="off"
                                  onInput={(event) =>
                                    setAppleSigningIdentity(event.currentTarget.value)
                                  }
                                />
                              </label>
                              <label class="flex flex-col gap-1.5">
                                <span class={rowTitleCls}>Provisioning profile</span>
                                <input
                                  class={inputCls}
                                  value={appleProvisioningProfile()}
                                  placeholder="Use Xcode automatically"
                                  autocomplete="off"
                                  onInput={(event) =>
                                    setAppleProvisioningProfile(event.currentTarget.value)
                                  }
                                />
                              </label>
                            </div>
                          </details>
                          <div class="flex items-center gap-2.5">
                            <Button
                              variant="primary"
                              size="sm"
                              type="submit"
                              disabled={appleSetupBusy()}
                            >
                              {appleSetupBusy() ? "Saving…" : "Save changes"}
                            </Button>
                            <Show when={appleSetupSaved()}>
                              <span class="text-12-regular text-icon-success-base">Saved</span>
                            </Show>
                            <Show when={appleSetupError()}>
                              <span class="text-12-regular text-icon-critical-base" role="alert">
                                {appleSetupError()}
                              </span>
                            </Show>
                          </div>
                        </form>
                      </Show>

                      <details class="border-t border-border-weak-base pt-3">
                        <summary class="cursor-pointer text-11-medium text-text-weak">
                          Setup details
                        </summary>
                        <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                          <For each={appleStatus().checks}>
                            {(check) => (
                              <div class="flex min-w-0 items-center gap-1.5 text-11-regular text-text-weak">
                                <span
                                  class={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    check.status === "ready"
                                      ? "bg-icon-success-base"
                                      : "bg-icon-warning-base",
                                  )}
                                />
                                <span class="truncate">{check.label}</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </details>
                    </>
                  )}
                </Show>
              </section>
            </Show>

            <Show when={section() === "server"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Connection</span>
                  <span class={rowDescCls}>HTTP API for devices, actions, and runs.</span>
                </div>
                <div class="shrink-0">
                  <span
                    class={cn(
                      "inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-medium tracking-wide",
                      healthTone(),
                    )}
                  >
                    <span
                      class={cn(
                        "size-1.5 shrink-0 rounded-full bg-current",
                        server.health() === "online" && server.sseConnected() && "animate-pulse",
                      )}
                    />
                    {healthText()}
                  </span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Server URL</span>
                  <span class={rowDescCls}>HTTP API this app connects to.</span>
                </div>
                <div class="max-w-[240px] min-w-0 flex-1">
                  <input
                    class={inputCls}
                    type="url"
                    value={urlDraft()}
                    onInput={(e) => setUrlDraft(e.currentTarget.value)}
                    placeholder="http://localhost:8787"
                    spellcheck={false}
                  />
                </div>
              </div>
              <div class="flex items-center gap-2.5 pt-3">
                <Button variant="primary" size="sm" onClick={() => void saveServerUrl()}>
                  Save & reconnect
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void server.retryConnection()}>
                  Refresh
                </Button>
                <Show when={serverSaved()}>
                  <span class="text-12-regular text-icon-success-base">Saved</span>
                </Show>
              </div>
              <Show when={server.error() && !server.isOffline()}>
                <div
                  class="mt-3 flex items-center gap-2 rounded-md bg-surface-critical-weak px-3 py-2 text-12-regular text-icon-critical-base"
                  role="alert"
                >
                  <span class="min-w-0 flex-1">{server.error()}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="ml-auto"
                    onClick={() => server.dismissError()}
                  >
                    Dismiss
                  </Button>
                </div>
              </Show>
            </Show>

            <Show when={section() === "recipes"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Prod account match</span>
                  <span class={rowDescCls}>
                    The account the *-prod tests target (e.g. gmail.com).
                  </span>
                </div>
                <div class="max-w-[240px] min-w-0 flex-1">
                  <input
                    class={inputCls}
                    type="text"
                    value={prodDraft()}
                    onInput={(e) => setProdDraft(e.currentTarget.value)}
                    placeholder="gmail.com"
                    spellcheck={false}
                  />
                </div>
              </div>
              <div class="flex items-center gap-2.5 pt-3">
                <Button variant="primary" size="sm" onClick={() => void saveProdMatch()}>
                  Save
                </Button>
                <Show when={prodSaved()}>
                  <span class="text-12-regular text-icon-success-base">Saved</span>
                </Show>
              </div>
            </Show>

            <Show when={section() === "about"}>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Product</span>
                  <span class={rowDescCls}>Relay · 0.1.0</span>
                </div>
              </div>
              <Show when={platform.updates}>
                <div class={rowCls}>
                  <div class={rowCopyCls}>
                    <span class={rowTitleCls}>Updates</span>
                    <span class={rowDescCls}>
                      {updateState()?.phase === "checking"
                        ? "Checking for a signed release…"
                        : updateState()?.phase === "downloaded"
                          ? `${updateState()?.releaseName ?? updateState()?.version ?? "An update"} is ready to restart.`
                          : updateState()?.phase === "error"
                            ? "Couldn’t check right now. Try again later."
                            : "Checks automatically while Relay is running."}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={checkingUpdates() || updateState()?.phase === "checking"}
                    onClick={() => void checkForUpdates()}
                  >
                    {checkingUpdates() || updateState()?.phase === "checking"
                      ? "Checking…"
                      : "Check now"}
                  </Button>
                </div>
              </Show>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Platform</span>
                  <span class={rowDescCls}>
                    <strong class="font-medium text-text-strong">{platform.platform}</strong>
                    {platform.version ? ` · v${platform.version}` : ""}
                  </span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Theme</span>
                  <span class={cn(rowDescCls, mono)}>
                    {theme.themeId()} / {theme.mode()}
                  </span>
                </div>
              </div>
              <div class={rowCls}>
                <div class={rowCopyCls}>
                  <span class={rowTitleCls}>Command palette</span>
                  <span class={rowDescCls}>
                    Press <span class="font-mono">⌘K</span> anywhere to run commands, jump to tests,
                    or toggle appearance.
                  </span>
                </div>
                <div class="shrink-0">
                  <button
                    type="button"
                    class={cn(
                      "h-7 rounded-md px-2.5 text-12-medium text-text-strong hover:bg-surface-base-hover",
                    )}
                    onClick={() => cmd.setOpen(true)}
                  >
                    <Icon name="search" size={13} />
                    Open palette
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </main>
      </div>
    </div>
  );
}
