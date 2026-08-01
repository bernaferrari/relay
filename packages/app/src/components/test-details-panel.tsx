import { For, Show, createEffect, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { cn } from "../lib/cn";
import { productIconButton, tabUnderline, tabUnderlineActive } from "../lib/ui";
import { shellAsideDrawer, shellSteps, shellStepsBody } from "../lib/shell-layout";
import { FlowParametersEditor } from "./flow-parameters-editor";
import { Icon } from "./icon";

type DetailsTab = "properties" | "source";

export function TestSettingsPanel(props: {
  onClose: () => void;
  onOpenVariables: () => void;
  presentation?: "drawer" | "floating";
}) {
  const server = useServer();
  const draft = useRecipeDraft();
  const [tab, setTab] = createSignal<DetailsTab>("properties");
  const [yamlSource, setYamlSource] = createSignal<string | null>(null);
  const [yamlDraft, setYamlDraft] = createSignal("");
  const [yamlEditing, setYamlEditing] = createSignal(false);
  const [yamlSaving, setYamlSaving] = createSignal(false);
  const [yamlMessage, setYamlMessage] = createSignal<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  let yamlRequest = 0;
  createEffect(() => {
    const recipe = server.selectedRecipe();
    const updatedAt = recipe?.updatedAt;
    if (tab() !== "source" || !recipe) return;
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

  const saveYaml = async () => {
    const recipe = server.selectedRecipe();
    const source = yamlDraft().trim();
    if (!recipe || !source || yamlSaving()) return;
    setYamlSaving(true);
    setYamlMessage(null);
    try {
      const preview = await server.previewRecipeYaml(source);
      if (preview.recipe.id !== recipe.id) {
        throw new Error("The map id cannot change here. Duplicate the map to create a new id.");
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

  return (
    <aside
      class={cn(
        shellSteps,
        props.presentation === "floating"
          ? "absolute top-4 right-4 bottom-4 z-50 w-[min(360px,calc(100%-32px))] overflow-hidden rounded-[16px] border border-[var(--v2-border-border-strong)] shadow-[0_24px_72px_rgb(0_0_0/40%)]"
          : shellAsideDrawer,
      )}
      aria-label="Map details"
    >
      <header class="flex h-12 shrink-0 items-end justify-between border-b border-[var(--v2-border-border-muted)] px-3">
        <div class="flex h-full items-end" role="tablist" aria-label="Map detail panels">
          <For each={["properties", "source"] as const}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === item}
                class={cn(tabUnderline, "h-full", tab() === item && tabUnderlineActive)}
                onClick={() => setTab(item)}
              >
                {item === "properties" ? "Properties" : "Source"}
              </button>
            )}
          </For>
        </div>
        <div class="flex h-full items-center">
          <button
            type="button"
            class={productIconButton}
            aria-label="Close map details"
            onClick={props.onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </header>

      <div class={shellStepsBody} data-editor-tab={tab()}>
        <Show when={tab() === "properties"}>
          <div class="h-full overflow-y-auto divide-y divide-[var(--v2-border-border-muted)]">
            <section class="p-4">
              <label class="grid gap-1.5">
                <span class="text-[10.5px] font-medium text-[var(--text-base)]">Description</span>
                <textarea
                  class="min-h-[72px] w-full resize-none rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 py-2.5 text-[12px]/[1.45] text-[var(--text-strong)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--text-weak)] focus:border-[var(--v2-border-border-strong)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--text-base)_12%,transparent)]"
                  value={draft.description()}
                  placeholder="What this map verifies"
                  onInput={(event) => draft.setDescription(event.currentTarget.value)}
                />
              </label>
            </section>
            <section class="p-4">
              <FlowParametersEditor />
            </section>
            <section class="p-3">
              <button
                type="button"
                class="group flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-150 hover:bg-[var(--v2-background-bg-layer-02)]"
                onClick={props.onOpenVariables}
              >
                <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_10%,var(--v2-background-bg-layer-01))] text-[var(--text-interactive-base)]">
                  <Icon name="sparkle" size={14} />
                </span>
                <span class="min-w-0 flex-1">
                  <strong class="block text-[11.5px] font-medium text-[var(--text-base)]">
                    Workspace variables
                  </strong>
                  <small class="mt-0.5 block text-[10px] text-[var(--text-weak)]">
                    Reusable values written as {"{{variable_name}}"}
                  </small>
                </span>
                <Icon
                  name="chevron-right"
                  size={13}
                  class="shrink-0 text-[var(--text-weak)] transition-transform duration-150 group-hover:translate-x-0.5"
                />
              </button>
            </section>
          </div>
        </Show>

        <Show when={tab() === "source"}>
          <div class="flex h-full min-h-0 flex-col overflow-hidden">
            <header class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--v2-border-border-muted)] px-3">
              <span class="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
                Source file
              </span>
              <div class="flex items-center gap-1">
                <Show when={!yamlEditing()}>
                  <button
                    type="button"
                    class="relative inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-base)] before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-40"
                    disabled={!yamlSource()}
                    onClick={() => void navigator.clipboard?.writeText(yamlSource() ?? "")}
                  >
                    <Icon name="copy" size={13} /> Copy
                  </button>
                  <button
                    type="button"
                    class="relative inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-base)] before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-40"
                    disabled={!yamlSource()}
                    onClick={() => {
                      setYamlDraft(yamlSource() ?? "");
                      setYamlMessage(null);
                      setYamlEditing(true);
                    }}
                  >
                    <Icon name="edit" size={13} /> Edit
                  </button>
                </Show>
                <Show when={yamlEditing()}>
                  <button
                    type="button"
                    class="relative inline-flex h-8 items-center rounded-md px-2 text-[11px] text-[var(--text-base)] before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[var(--v2-background-bg-layer-02)]"
                    disabled={yamlSaving()}
                    onClick={() => {
                      setYamlDraft(yamlSource() ?? "");
                      setYamlMessage(null);
                      setYamlEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="relative inline-flex h-8 items-center rounded-md px-2 text-[11px] font-semibold text-[var(--text-strong)] before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-40"
                    disabled={yamlSaving()}
                    onClick={() => void saveYaml()}
                  >
                    {yamlSaving() ? "Saving…" : "Save YAML"}
                  </button>
                </Show>
              </div>
            </header>
            <Show
              when={yamlSource()}
              fallback={
                <div class="grid flex-1 place-items-center text-[12px] text-[var(--text-weak)]">
                  Loading YAML…
                </div>
              }
            >
              <Show
                when={yamlEditing()}
                fallback={
                  <pre class="m-0 min-h-0 flex-1 overflow-auto bg-[var(--v2-background-bg-deep)] p-3 font-mono text-[11px]/[1.5] text-[var(--text-base)]">
                    {yamlSource()}
                  </pre>
                }
              >
                <textarea
                  class="min-h-0 flex-1 resize-none border-0 bg-[var(--v2-background-bg-deep)] p-3 font-mono text-[11px]/[1.5] text-[var(--text-strong)] outline-none"
                  aria-label="App Map YAML"
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
                      "m-0 border-t border-[var(--v2-border-border-muted)] px-3 py-2 text-[11px]",
                      message().tone === "success"
                        ? "text-[var(--icon-success-base)]"
                        : "text-[var(--icon-critical-base)]",
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
