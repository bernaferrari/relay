import { Show, createSignal } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { planTestPrompt } from "../lib/natural-language-plan";
import { Icon } from "./icon";

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
      class="mx-2.5 mt-2.5 mb-0.5 shrink-0 overflow-hidden rounded-xl border bg-background-stronger transition-colors"
      classList={{
        "border-border-focus": open(),
        "border-border-weak-base": !open(),
      }}
    >
      <button
        type="button"
        class="grid min-h-[50px] w-full grid-cols-[28px_minmax(0,1fr)_18px] items-center gap-2 px-2.5 py-2 text-left text-text-base focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-strong-focus"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="grid size-7 place-items-center rounded-lg bg-surface-info-weak text-text-info-base">
          <Icon name="sparkle" size={16} />
        </span>
        <span class="grid min-w-0 gap-0.5">
          <strong class="text-[13px]/[1.25] font-semibold">Build with AI</strong>
          <small class="truncate text-[11px]/[1.35] text-text-weak">
            Describe what you want to test
          </small>
        </span>
        <Icon name={open() ? "chevron-up" : "chevron-down"} size={14} />
      </button>
      <Show when={open()}>
        <div class="grid gap-2.5 border-t border-border-weak-base px-2.5 pb-2.5">
          <label
            for="agent-test-prompt"
            class="pt-2.5 text-[11px]/[1.25] font-semibold tracking-[0.08em] text-text-weak uppercase"
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
              class="relay-primary"
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
