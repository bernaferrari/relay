import { For, Show, createSignal, type JSX } from "solid-js";
import { useRecorder, type RecStep, type CustomRecipe } from "../context/recorder";
import { Icon } from "./icon";

function stepKind(s: RecStep): string {
  return s.kind;
}

function stepToText(s: RecStep): string {
  if (s.kind === "ref") return s.ref;
  if (s.kind === "label") return s.label;
  return `${s.x}, ${s.y}`;
}

function parseStep(kind: string, text: string): RecStep {
  if (kind === "ref") {
    return { kind: "ref", ref: text.startsWith("@") ? text : `@${text}` };
  }
  if (kind === "label") return { kind: "label", label: text };
  const parts = text.split(/[,\s]+/).filter(Boolean);
  return {
    kind: "point",
    x: parseInt(parts[0] ?? "0", 10) || 0,
    y: parseInt(parts[1] ?? "0", 10) || 0,
  };
}

export function RecipeEditor(props: {
  recipe: CustomRecipe | null;
  onClose: () => void;
}): JSX.Element {
  const rec = useRecorder();
  const [title, setTitle] = createSignal(props.recipe?.title ?? "");
  const [steps, setSteps] = createSignal<RecStep[]>(
    props.recipe?.steps ? [...props.recipe.steps] : [],
  );

  function addStep(): void {
    setSteps((s) => [...s, { kind: "point", x: 0, y: 0 }]);
  }
  function removeStep(i: number): void {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: number): void {
    setSteps((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
  }
  function updateStepText(i: number, text: string): void {
    setSteps((s) => s.map((st, idx) => (idx === i ? parseStep(stepKind(st), text) : st)));
  }
  function changeStepKind(i: number, kind: string): void {
    setSteps((s) => s.map((st, idx) => (idx === i ? parseStep(kind, stepToText(st)) : st)));
  }
  function save(): void {
    if (props.recipe) {
      rec.updateRecipe(props.recipe.id, title(), steps());
    } else {
      rec.saveRecipeFromSteps(title(), steps());
    }
    props.onClose();
  }

  return (
    <div
      class="dialog-overlay"
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
      <div class="dialog dialog--editor" role="dialog" aria-modal="true" aria-label="Recipe editor">
        <div class="dialog__head">
          <h2 class="dialog__title">{props.recipe ? "Edit recipe" : "New recipe"}</h2>
          <button
            type="button"
            class="dialog__close"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div class="recipe-editor">
          <input
            class="recipe-editor__title"
            type="text"
            placeholder="Recipe name…"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            spellcheck={false}
          />
          <div class="recipe-editor__steps">
            <For each={steps()}>
              {(step, i) => (
                <div class="recipe-editor__step">
                  <span class="recipe-editor__step-i mono">{String(i() + 1).padStart(2, "0")}</span>
                  <select
                    class="recipe-editor__kind"
                    value={stepKind(step)}
                    onChange={(e) => changeStepKind(i(), e.currentTarget.value)}
                  >
                    <option value="ref">ref</option>
                    <option value="label">label</option>
                    <option value="point">point</option>
                  </select>
                  <input
                    class="recipe-editor__value mono"
                    type="text"
                    value={stepToText(step)}
                    onInput={(e) => updateStepText(i(), e.currentTarget.value)}
                    spellcheck={false}
                  />
                  <button
                    type="button"
                    class="recipe-editor__btn"
                    title="Move up"
                    onClick={() => move(i(), -1)}
                  >
                    <Icon name="chevron-down" size={12} />
                  </button>
                  <button
                    type="button"
                    class="recipe-editor__btn"
                    title="Move down"
                    onClick={() => move(i(), 1)}
                  >
                    <Icon name="chevron-right" size={12} />
                  </button>
                  <button
                    type="button"
                    class="recipe-editor__btn recipe-editor__btn--del"
                    title="Remove step"
                    onClick={() => removeStep(i())}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}
            </For>
            <Show when={steps().length === 0}>
              <p class="recipe-editor__empty">
                No steps yet — add one below or record from the device.
              </p>
            </Show>
          </div>
          <button type="button" class="btn btn-ghost recipe-editor__add" onClick={() => addStep()}>
            <Icon name="chevron-right" size={13} />
            Add step
          </button>
          <div class="recipe-editor__actions">
            <button type="button" class="btn btn-acc" onClick={() => save()}>
              <Icon name="check" size={13} />
              Save
            </button>
            <button type="button" class="btn btn-ghost" onClick={() => props.onClose()}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
