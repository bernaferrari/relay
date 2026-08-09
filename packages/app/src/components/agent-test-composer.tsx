import { Show, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { planTestPrompt } from "../lib/natural-language-plan";
import { Icon } from "./icon";
import { cn } from "../lib/cn";

export function AgentTestComposer(
  props: {
    variant?: "compact" | "canvas";
    defaultOpen?: boolean;
    onCreated?: () => void;
  } = {},
) {
  const draft = useRecipeDraft();
  const server = useServer();
  const [open, setOpen] = createSignal(Boolean(props.defaultOpen));
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
    props.onCreated?.();
  }

  return (
    <section
      class={cn(
        // Dashed, accent-tinted chrome — deliberately distinct from a step
        // row's solid rounded card, so this reads as "add via AI" rather
        // than a collapsed step.
        props.variant === "canvas"
          ? "w-[min(520px,calc(100%-40px))] shrink-0 overflow-hidden rounded-[16px] border transition-colors shadow-[0_18px_60px_rgb(0_0_0/24%)]"
          : "mx-3 mt-2 mb-0.5 shrink-0 overflow-hidden rounded-[10px] border border-dashed transition-colors",
        open()
          ? props.variant === "canvas"
            ? "border-[color-mix(in_srgb,var(--text-interactive-base)_38%,var(--border-weak-base))] bg-surface-raised-stronger-non-alpha"
            : "border-[color-mix(in_srgb,var(--text-interactive-base)_45%,transparent)] bg-[var(--product-accent-soft)]"
          : "border-[color-mix(in_srgb,var(--text-interactive-base)_28%,transparent)] bg-[color-mix(in_srgb,var(--text-interactive-base)_5%,transparent)] hover:bg-[color-mix(in_srgb,var(--text-interactive-base)_9%,transparent)]",
      )}
    >
      <button
        type="button"
        class={cn(
          "grid w-full grid-cols-[28px_minmax(0,1fr)_18px] items-center gap-2.5 text-left text-text-base focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus",
          props.variant === "canvas" ? "min-h-[58px] px-4 py-2.5" : "min-h-[38px] px-2.5 py-1.5",
        )}
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="grid size-7 place-items-center rounded-lg text-[var(--text-interactive-base)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--text-interactive-base)_35%,transparent)]">
          <Icon name="sparkle" size={14} />
        </span>
        <strong class="truncate text-[13px]/[1.25] font-medium text-[var(--text-interactive-base)]">
          {props.variant === "canvas" ? "Describe your test" : "Generate steps"}
        </strong>
        <Icon
          name="chevron-down"
          size={14}
          class={cn(
            "text-[var(--text-weak)] transition-transform duration-150",
            open() && "rotate-180",
          )}
        />
      </button>
      <Show when={open()}>
        <div
          class={cn(
            "grid gap-2.5 border-t border-[var(--border-weak-base)] pb-3",
            props.variant === "canvas" ? "px-4" : "px-3.5",
          )}
        >
          <label
            for="agent-test-prompt"
            class="pt-3 text-[11px]/[1.25] font-semibold tracking-[0.08em] text-text-weak uppercase"
          >
            Tell Relay what a person should do
          </label>
          <textarea
            id="agent-test-prompt"
            value={prompt()}
            rows={props.variant === "canvas" ? 4 : 3}
            class={cn(
              "w-full resize-y rounded-lg border border-border-weak-base bg-background-base px-3 py-2.5 text-[13px]/[1.45] text-text-base outline-none focus:border-border-focus focus:ring-3 focus:ring-surface-info-weak",
              props.variant === "canvas" ? "min-h-24" : "min-h-19",
            )}
            placeholder={
              "Sign in with {{email}}, open the profile, and check that the name is correct"
            }
            onInput={(event) => {
              setPrompt(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void createSteps();
            }}
          />
          <footer class="flex min-h-10 items-center justify-between gap-3">
            <span class="text-[10.5px] text-[var(--text-weak)]">⌘ Enter</span>
            <Button
              variant="primary"
              size="lg"
              disabled={!prompt().trim() || generating()}
              onClick={() => void createSteps()}
            >
              <Icon name="sparkle" size={14} /> {generating() ? "Creating…" : "Create steps"}
            </Button>
          </footer>
        </div>
      </Show>
    </section>
  );
}
