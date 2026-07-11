import { For, Show, createMemo, createSignal } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { planTestPrompt } from "../lib/natural-language-plan";
import { sentenceForStep } from "../lib/step-sentence";
import { Icon } from "./icon";

export function AgentTestComposer() {
  const draft = useRecipeDraft();
  const server = useServer();
  const [open, setOpen] = createSignal(false);
  const [prompt, setPrompt] = createSignal("");
  const [generatedPrompt, setGeneratedPrompt] = createSignal("");
  const [generating, setGenerating] = createSignal(false);
  const plan = createMemo(() => planTestPrompt(generatedPrompt() || prompt()));

  async function generatePlan(): Promise<void> {
    if (!prompt().trim() || generating()) return;
    setGenerating(true);
    try {
      const result = await server.generate({
        purpose: "test-plan",
        prompt: prompt(),
        count: 1,
      });
      setGeneratedPrompt(result.values[0] || prompt());
    } catch (error) {
      setGeneratedPrompt(prompt());
      toast(
        `AI provider unavailable—using the local planner. ${error instanceof Error ? error.message : ""}`,
        "warning",
      );
    } finally {
      setGenerating(false);
    }
  }

  function addPlan(): void {
    const steps = plan().map((item) => item.step);
    if (steps.length === 0) return;
    draft.appendSteps(steps);
    setPrompt("");
    setGeneratedPrompt("");
    setOpen(false);
  }

  return (
    <section class="agent-composer" classList={{ "is-open": open() }}>
      <button
        type="button"
        class="agent-composer__trigger"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <Icon name="sparkle" size={16} />
        </span>
        <span>
          <strong>Describe a test</strong>
          <small>Turn plain language into editable steps</small>
        </span>
        <Icon name={open() ? "chevron-up" : "chevron-down"} size={14} />
      </button>
      <Show when={open()}>
        <div class="agent-composer__body">
          <label for="agent-test-prompt">What should the test do?</label>
          <textarea
            id="agent-test-prompt"
            value={prompt()}
            rows={3}
            placeholder={"Tap “Sign in”, type {{email}}, then verify “Welcome” is visible"}
            onInput={(event) => {
              setPrompt(event.currentTarget.value);
              setGeneratedPrompt("");
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") addPlan();
            }}
          />
          <Show when={plan().length > 0}>
            <ol class="agent-composer__preview">
              <For each={plan()}>
                {(item, index) => (
                  <li>
                    <span>{index() + 1}</span>
                    <div>
                      <strong>{item.step.kind}</strong>
                      <small>{sentenceForStep(item.step)}</small>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
          <footer>
            <small>Review first. Every generated step remains fully editable.</small>
            <div>
              <button
                type="button"
                aria-label="Generate plan"
                disabled={!prompt().trim() || generating()}
                onClick={() => void generatePlan()}
              >
                {generating() ? "Generating…" : "Generate"}
              </button>
              <button
                type="button"
                class="relay-primary"
                disabled={plan().length === 0}
                onClick={addPlan}
              >
                <Icon name="sparkle" size={14} /> Add {plan().length || ""} step
                {plan().length === 1 ? "" : "s"}
              </button>
            </div>
          </footer>
        </div>
      </Show>
    </section>
  );
}
