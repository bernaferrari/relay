import { For, Show, createEffect, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { cn } from "../lib/cn";
import { productIconButton, tabUnderline, tabUnderlineActive } from "../lib/ui";
import { shellSteps, shellStepsBody, shellStepsHead } from "../lib/shell-layout";
import { AgentTestComposer } from "./agent-test-composer";
import { FlowParametersEditor } from "./flow-parameters-editor";
import { Icon } from "./icon";
import { RecipeStepsEditor } from "./step-list";

type DetailsTab = "steps" | "inputs" | "yaml";

export function TestDetailsPanel(props: { onClose: () => void; onOpenData: () => void }) {
  const server = useServer();
  const draft = useRecipeDraft();
  const [tab, setTab] = createSignal<DetailsTab>("steps");
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

  const saveYaml = async () => {
    const recipe = server.selectedRecipe();
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

  return (
    <aside class={shellSteps} aria-label="Advanced test editor">
      <div class={shellStepsHead}>
        <div class="flex min-h-9 items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="block text-[10px] font-semibold tracking-[0.12em] text-[var(--text-weak)] uppercase">
              Advanced editor
            </span>
            <strong class="mt-0.5 block truncate text-[13px] font-semibold text-[var(--text-strong)]">
              {draft.title() || "Untitled test"}
            </strong>
          </div>
          <button
            type="button"
            class={productIconButton}
            aria-label="Close advanced editor"
            onClick={props.onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div class="mt-2 flex items-center" role="tablist" aria-label="Advanced test panels">
          <For each={["steps", "inputs", "yaml"] as const}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === item}
                class={cn(tabUnderline, tab() === item && tabUnderlineActive)}
                onClick={() => setTab(item)}
              >
                {item === "steps" ? "All steps" : item === "inputs" ? "Inputs" : "YAML"}
                <Show when={item === "steps"}>
                  <span class="min-w-4 rounded-full bg-surface-weak px-1 text-center text-[11px]/4 text-text-weak">
                    {draft.steps().length}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class={shellStepsBody} data-editor-tab={tab()}>
        <Show when={tab() === "steps"}>
          <div class="flex h-full min-h-0 flex-col">
            <AgentTestComposer />
            <RecipeStepsEditor />
          </div>
        </Show>

        <Show when={tab() === "inputs"}>
          <div class="grid content-start gap-4 p-4">
            <FlowParametersEditor />
            <div class="flex items-center justify-between gap-3 border-t border-[var(--v2-border-border-muted)] pt-3.5">
              <div class="flex min-w-0 items-center gap-2.5">
                <Icon
                  name="sparkle"
                  size={15}
                  class="shrink-0 text-[var(--text-interactive-base)]"
                />
                <span class="min-w-0">
                  <strong class="block text-[11.5px] font-medium text-[var(--text-base)]">
                    Values shared across tests
                  </strong>
                  <small class="mt-0.5 block text-[10px] text-[var(--text-weak)]">
                    Workspace variables use {"{{variable_name}}"}.
                  </small>
                </span>
              </div>
              <button
                type="button"
                class="shrink-0 text-[11px] font-semibold text-[var(--text-interactive-base)] hover:underline"
                onClick={props.onOpenData}
              >
                Open variables
              </button>
            </div>
          </div>
        </Show>

        <Show when={tab() === "yaml"}>
          <div class="flex h-full min-h-0 flex-col overflow-hidden">
            <header class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--v2-border-border-muted)] px-3">
              <span class="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
                Source file
              </span>
              <div class="flex items-center gap-1">
                <Show when={!yamlEditing()}>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-40"
                    disabled={!yamlSource()}
                    onClick={() => void navigator.clipboard?.writeText(yamlSource() ?? "")}
                  >
                    <Icon name="copy" size={13} /> Copy
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-40"
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
                    class="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-[var(--text-base)] hover:bg-[var(--v2-background-bg-layer-02)]"
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
                    class="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-semibold text-[var(--text-strong)] hover:bg-[var(--v2-background-bg-layer-02)] disabled:opacity-40"
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
