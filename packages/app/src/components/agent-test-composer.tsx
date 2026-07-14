import { Show, createSignal } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { planTestPrompt } from "../lib/natural-language-plan";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { productPrimary } from "../lib/ui";

export function AgentTestComposer() {
  const draft = useRecipeDraft();
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [prompt, setPrompt] = createSignal("");
  const [generating, setGenerating] = createSignal(false);

  async function createSteps(): Promise<void> {
    if (!prompt().trim() || generating()) return;
    setGenerating(true);
    let plannedPrompt = prompt();
    try {
      const result = await server.generate({
        purpose: "test-plan",
        prompt: prompt(),
        count: 1,
      });
      plannedPrompt = result.values[0] || prompt();
    } catch (error) {
      toast(
        `AI provider unavailable—using the local planner. ${error instanceof Error ? error.message : ""}`,
        "warning",
      );
    } finally {
      setGenerating(false);
    }
    const steps = planTestPrompt(plannedPrompt).map((item) => item.step);
    if (steps.length === 0) return;
    draft.appendSteps(steps);
    setPrompt("");
    setOpen(false);
  }

  return (
    <section
      class={cn(
        "mx-3 mt-3 mb-0.5 shrink-0 overflow-hidden rounded-xl transition-colors",
        open()
          ? "bg-[var(--relay-panel)] ring-1 ring-[var(--relay-line-strong)]"
          : "hover:bg-white/[0.03]",
      )}
    >
      <button
        type="button"
        class="grid min-h-[44px] w-full grid-cols-[34px_minmax(0,1fr)_18px] items-center gap-3.5 px-3.5 py-2 text-left text-text-base focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="grid size-[34px] place-items-center rounded-[10px] text-[var(--relay-accent-2)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--relay-accent)_35%,transparent)]">
          <Icon name="sparkle" size={16} />
        </span>
        <span class="flex min-w-0 items-baseline gap-2">
          <strong class="text-[13.5px]/[1.25] font-medium text-[var(--relay-text-secondary)]">
            Build with AI
          </strong>
          <small class="truncate text-[12px]/[1.35] text-[var(--relay-text-tertiary)]">
            describe what you want to test
          </small>
        </span>
        <Icon
          name="chevron-down"
          size={14}
          class={cn(
            "text-[var(--relay-text-tertiary)] transition-transform duration-150",
            open() && "rotate-180",
          )}
        />
      </button>
      <Show when={open()}>
        <div class="grid gap-2.5 border-t border-[var(--relay-line)] px-3.5 pb-3">
          <label
            for="agent-test-prompt"
            class="pt-3 text-[11px]/[1.25] font-semibold tracking-[0.08em] text-text-weak uppercase"
          >
            What should happen?
          </label>
          <textarea
            id="agent-test-prompt"
            value={prompt()}
            rows={3}
            class="min-h-19 w-full resize-y rounded-lg border border-border-weak-base bg-background-base px-3 py-2.5 text-[13px]/[1.45] text-text-base outline-none focus:border-border-focus focus:ring-3 focus:ring-surface-info-weak"
            placeholder={"Tap “Sign in”, type {{email}}, then verify “Welcome” is visible"}
            onInput={(event) => {
              setPrompt(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void createSteps();
            }}
          />
          <footer class="flex min-h-10 items-center justify-between gap-3">
            <span />
            <button
              type="button"
              class={productPrimary}
              disabled={!prompt().trim() || generating()}
              onClick={() => void createSteps()}
            >
              <Icon name="sparkle" size={14} /> {generating() ? "Creating…" : "Create steps"}
            </button>
          </footer>
        </div>
      </Show>
    </section>
  );
}
