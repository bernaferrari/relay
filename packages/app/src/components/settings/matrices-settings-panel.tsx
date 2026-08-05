import { For, Show, createSignal } from "solid-js";
import type {
  CompatibilityMatrix,
  TargetCapability,
  TargetProfile,
  TargetSelector,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { IconButton } from "@relay/ui/icon-button";
import { useServer } from "../../context/server";
import { Icon } from "../icon";
import { cn } from "../../lib/cn";
import { platformLabel } from "../../lib/target-presentation";
import {
  MatrixSelectorEditor,
  matrixCapabilities,
  matrixPlatforms,
  matrixSummary,
  readableCapability,
  selectorDraftFrom,
  selectorFromDraft,
  type MatrixSelectorDraft,
} from "../matrix-selector-editor";
import { inputCls, rowTitleCls } from "./settings-styles";

export function MatricesSettingsPanel() {
  const server = useServer();
  let matrixFileInput: HTMLInputElement | undefined;

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

  return (
    <section class="flex flex-col gap-4">
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 class="m-0 text-14-medium text-text-strong">Test environments</h3>
          <p class="mt-1 mb-0 max-w-[34rem] text-12-regular leading-relaxed text-text-weak">
            Save the devices and OS versions you test together, then run any test across the full
            set.
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
                Choose specific devices or let Relay match compatible ones automatically.
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
                        current.map((item, itemIndex) => (itemIndex === index() ? next : item)),
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
              {matrixBusy() ? "Saving…" : editingMatrixId() ? "Save changes" : "Save environment"}
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
                    <Button variant="ghost" size="sm" onClick={() => editMatrix(matrix)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void previewMatrix(matrix.id)}>
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
                  <p class="mt-2 mb-0 text-11-regular leading-relaxed text-text-weak" role="status">
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
  );
}
