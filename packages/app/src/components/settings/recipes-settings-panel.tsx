import { Show, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer } from "../../context/server";
import { Icon } from "../icon";
import { inputCls, rowCls, rowCopyCls, rowDescCls, rowTitleCls } from "./settings-styles";

export function RecipesSettingsPanel() {
  const server = useServer();
  const [prodDraft, setProdDraft] = createSignal("");
  const [prodSaved, setProdSaved] = createSignal(false);

  onMount(() => {
    setProdDraft(server.prodAccountMatch());
  });

  async function saveProdMatch() {
    await server.setProdAccountMatch(prodDraft().trim());
    setProdSaved(true);
    setTimeout(() => setProdSaved(false), 1500);
  }

  return (
    <>
      <section class="mb-3 rounded-lg border border-border-weak-base bg-background-base p-3.5">
        <div class="flex items-start gap-3">
          <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-base-active text-text-interactive-base">
            <Icon name="sparkle" size={14} />
          </span>
          <div class="min-w-0">
            <h3 class="m-0 text-13-medium text-text-strong">Agent planner</h3>
            <p class="mt-1 mb-0 text-12-regular leading-relaxed text-text-weak">
              Relay can use OpenRouter to choose among safe controls while exploring. Without a key
              Relay can still turn plain language into steps.
            </p>
            <code class="mt-2.5 block overflow-x-auto rounded-md bg-surface-raised-stronger-non-alpha px-2.5 py-2 font-mono text-[10.5px] text-text-base">
              OPENROUTER_API_KEY=… pnpm dev:desktop
            </code>
            <p class="mt-2 mb-0 text-[10.5px] leading-relaxed text-text-weak">
              The key stays in the server process environment and is never saved in a map or
              evidence bundle.
            </p>
          </div>
        </div>
      </section>
      <div class={rowCls}>
        <div class={rowCopyCls}>
          <span class={rowTitleCls}>Production account domain</span>
          <span class={rowDescCls}>
            Use this domain when a test needs the production account set.
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
    </>
  );
}
