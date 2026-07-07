import { For, Show, createSignal, onMount, onCleanup, type JSX } from "solid-js";
import { useServer, type RecipeInfo, type RecipeStep, type StepTarget } from "../context/server";
import { useCommand } from "../context/command";
import { Icon } from "./icon";
import { trapFocus } from "../lib/modal";

type EditableKind =
  | "tap"
  | "type"
  | "wait-for"
  | "sleep"
  | "pause"
  | "key"
  | "scroll"
  | "screenshot";

const KIND_OPTIONS: { value: EditableKind; label: string }[] = [
  { value: "tap", label: "tap" },
  { value: "type", label: "type" },
  { value: "wait-for", label: "wait-for" },
  { value: "sleep", label: "sleep" },
  { value: "pause", label: "pause" },
  { value: "key", label: "key" },
  { value: "scroll", label: "scroll" },
  { value: "screenshot", label: "screenshot" },
];

/** Default step when inserting a new row of a given kind. */
function defaultStep(kind: EditableKind): RecipeStep {
  switch (kind) {
    case "tap":
      return { kind: "tap", target: {} };
    case "type":
      return { kind: "type", text: "" };
    case "wait-for":
      return { kind: "wait-for", target: {} };
    case "sleep":
      return { kind: "sleep", ms: 500 };
    case "pause":
      return { kind: "pause", message: "" };
    case "key":
      return { kind: "key", key: "back" };
    case "scroll":
      return { kind: "scroll", direction: "down" };
    case "screenshot":
      return { kind: "screenshot" };
  }
}

function parsePoint(text: string): { x: number; y: number } | undefined {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const x = parseInt(parts[0] ?? "", 10);
  const y = parseInt(parts[1] ?? "", 10);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return undefined;
}

function fmtPoint(p?: { x: number; y: number }): string {
  return p ? `${p.x}, ${p.y}` : "";
}

export function RecipeEditor(props: {
  recipe: RecipeInfo | null;
  onClose: () => void;
}): JSX.Element {
  const server = useServer();
  const cmd = useCommand();
  let dialogRef: HTMLDivElement | undefined;
  const [title, setTitle] = createSignal(props.recipe?.title ?? "");
  const [description, setDescription] = createSignal(props.recipe?.description ?? "");
  const [steps, setSteps] = createSignal<RecipeStep[]>(
    props.recipe?.steps ? props.recipe.steps.map((s) => ({ ...s })) : [],
  );
  const [saving, setSaving] = createSignal(false);

  onMount(() => {
    onCleanup(cmd.pushModal());
    if (dialogRef) onCleanup(trapFocus(dialogRef));
  });
  function addStep(): void {
    setSteps((s) => [...s, defaultStep("tap")]);
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
  /** Replace step i with a new value of the given kind (preserving common fields). */
  function changeKind(i: number, kind: EditableKind): void {
    setSteps((s) => s.map((st, idx) => (idx === i ? defaultStep(kind) : st)));
  }
  /** Replace step i with an updated copy. */
  function setStep(i: number, next: RecipeStep): void {
    setSteps((s) => s.map((st, idx) => (idx === i ? next : st)));
  }

  function targetValid(t: StepTarget): boolean {
    return Boolean(t.ref || t.label || t.text || t.point);
  }

  /** A step is valid if its required fields are present (mirrors core validation). */
  function stepValid(step: RecipeStep): boolean {
    switch (step.kind) {
      case "tap":
      case "wait-for":
        return targetValid(step.target);
      case "type":
        return step.text.trim().length > 0;
      case "sleep":
        return Number.isFinite(step.ms) && step.ms >= 0;
      case "pause":
        return step.message.trim().length > 0;
      case "scroll":
      case "key":
      case "screenshot":
      case "flow":
        return true;
    }
  }

  const allValid = () => title().trim().length > 0 && steps().every(stepValid);

  async function save(): Promise<void> {
    if (!allValid()) return;
    setSaving(true);
    const saved = await server.saveRecipeRemote({
      ...(props.recipe ? { id: props.recipe.id } : {}),
      title: title().trim(),
      description: description().trim() || undefined,
      steps: steps(),
    });
    setSaving(false);
    if (saved) {
      server.setSelectedRecipeId(saved.id);
      props.onClose();
    }
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
      <div
        class="dialog dialog--editor"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Recipe editor"
      >
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
          <input
            class="recipe-editor__desc"
            type="text"
            placeholder="Description (optional)…"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            spellcheck={false}
          />
          <div class="recipe-editor__steps">
            <For each={steps()}>
              {(step, i) => (
                <div class="recipe-editor__step">
                  <span class="recipe-editor__step-i mono">{String(i() + 1).padStart(2, "0")}</span>
                  <Show
                    when={step.kind !== "flow"}
                    fallback={
                      <span class="recipe-editor__flow mono">
                        flow · {step.kind === "flow" ? step.flow : ""}{" "}
                        <span class="recipe-editor__readonly">(read-only)</span>
                      </span>
                    }
                  >
                    <select
                      class="recipe-editor__kind"
                      value={step.kind}
                      onChange={(e) => changeKind(i(), e.currentTarget.value as EditableKind)}
                    >
                      <For each={KIND_OPTIONS}>
                        {(o) => <option value={o.value}>{o.label}</option>}
                      </For>
                    </select>
                    <StepValueEditor
                      step={step}
                      invalid={!stepValid(step)}
                      onChange={(next) => setStep(i(), next)}
                    />
                  </Show>
                  <button
                    type="button"
                    class="recipe-editor__btn"
                    title="Move up"
                    onClick={() => move(i(), -1)}
                  >
                    <Icon name="chevron-up" size={12} />
                  </button>
                  <button
                    type="button"
                    class="recipe-editor__btn"
                    title="Move down"
                    onClick={() => move(i(), 1)}
                  >
                    <Icon name="chevron-down" size={12} />
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
            <Icon name="plus" size={13} />
            Add step
          </button>
          <div class="recipe-editor__actions">
            <button
              type="button"
              class="btn btn-acc"
              disabled={!allValid() || saving()}
              onClick={() => void save()}
            >
              <Icon name="check" size={13} />
              {saving() ? "Saving…" : "Save"}
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

/** Per-kind value editor: one compact row of inputs for the active kind. */
function StepValueEditor(props: {
  step: RecipeStep;
  invalid: boolean;
  onChange: (next: RecipeStep) => void;
}): JSX.Element {
  const setTarget = (patch: Partial<StepTarget>) => {
    const s = props.step as
      | Extract<RecipeStep, { kind: "tap" }>
      | Extract<RecipeStep, { kind: "wait-for" }>;
    const target: StepTarget = { ...s.target, ...patch };
    props.onChange({ ...s, target } as RecipeStep);
  };
  const tapTarget = () =>
    props.step.kind === "tap" || props.step.kind === "wait-for" ? props.step.target : null;

  return (
    <span
      class="recipe-editor__value-wrap"
      classList={{ "recipe-editor__value-wrap--err": props.invalid }}
    >
      <Show when={props.step.kind === "type"}>
        <input
          class="recipe-editor__value mono"
          type="text"
          placeholder="text to type"
          value={props.step.kind === "type" ? props.step.text : ""}
          onInput={(e) => props.onChange({ kind: "type", text: e.currentTarget.value })}
          spellcheck={false}
        />
      </Show>

      <Show when={props.step.kind === "sleep"}>
        <input
          class="recipe-editor__value mono"
          type="number"
          min={0}
          placeholder="ms"
          value={props.step.kind === "sleep" ? props.step.ms : 0}
          onInput={(e) =>
            props.onChange({ kind: "sleep", ms: parseInt(e.currentTarget.value, 10) || 0 })
          }
        />
      </Show>

      <Show when={props.step.kind === "wait-for"}>
        <input
          class="recipe-editor__value mono"
          type="number"
          min={0}
          placeholder="timeout s"
          value={
            props.step.kind === "wait-for" ? Math.round((props.step.timeoutMs ?? 0) / 1000) : 0
          }
          onInput={(e) =>
            props.onChange({
              kind: "wait-for",
              target: tapTarget() ?? {},
              timeoutMs: (parseInt(e.currentTarget.value, 10) || 0) * 1000,
            })
          }
        />
      </Show>

      <Show when={props.step.kind === "pause"}>
        <input
          class="recipe-editor__value"
          type="text"
          placeholder="message / instructions"
          value={props.step.kind === "pause" ? props.step.message : ""}
          onInput={(e) => props.onChange({ kind: "pause", message: e.currentTarget.value })}
          spellcheck={false}
        />
      </Show>

      <Show when={props.step.kind === "key"}>
        <select
          class="recipe-editor__value"
          value={props.step.kind === "key" ? props.step.key : "back"}
          onChange={(e) =>
            props.onChange({ kind: "key", key: e.currentTarget.value as "back" | "home" })
          }
        >
          <option value="back">back</option>
          <option value="home">home</option>
        </select>
      </Show>

      <Show when={props.step.kind === "scroll"}>
        <select
          class="recipe-editor__value"
          value={props.step.kind === "scroll" ? props.step.direction : "down"}
          onChange={(e) => {
            const amount = props.step.kind === "scroll" ? props.step.amount : undefined;
            props.onChange({
              kind: "scroll",
              direction: e.currentTarget.value as "down" | "up",
              ...(amount !== undefined ? { amount } : {}),
            });
          }}
        >
          <option value="down">down</option>
          <option value="up">up</option>
        </select>
        <input
          class="recipe-editor__value mono"
          type="number"
          min={0}
          placeholder="amount"
          value={props.step.kind === "scroll" ? (props.step.amount ?? "") : ""}
          onInput={(e) => {
            const n = parseInt(e.currentTarget.value, 10);
            const direction = props.step.kind === "scroll" ? props.step.direction : "down";
            props.onChange({
              kind: "scroll",
              direction,
              ...(Number.isFinite(n) ? { amount: n } : {}),
            });
          }}
        />
      </Show>

      <Show when={props.step.kind === "screenshot"}>
        <input
          class="recipe-editor__value"
          type="text"
          placeholder="caption (optional)"
          value={props.step.kind === "screenshot" ? (props.step.caption ?? "") : ""}
          onInput={(e) =>
            props.onChange({
              kind: "screenshot",
              ...(e.currentTarget.value ? { caption: e.currentTarget.value } : {}),
            })
          }
          spellcheck={false}
        />
      </Show>

      {/* tap / wait-for share the target editor (ref · label · text · point) */}
      <Show when={tapTarget()}>
        <span class="recipe-editor__target">
          <input
            class="recipe-editor__value mono"
            type="text"
            placeholder="ref @e26"
            value={tapTarget()!.ref ?? ""}
            onInput={(e) => setTarget({ ref: e.currentTarget.value || undefined })}
            spellcheck={false}
          />
          <input
            class="recipe-editor__value mono"
            type="text"
            placeholder="label"
            value={tapTarget()!.label ?? ""}
            onInput={(e) => setTarget({ label: e.currentTarget.value || undefined })}
            spellcheck={false}
          />
          <input
            class="recipe-editor__value mono"
            type="text"
            placeholder="text"
            value={tapTarget()!.text ?? ""}
            onInput={(e) => setTarget({ text: e.currentTarget.value || undefined })}
            spellcheck={false}
          />
          <input
            class="recipe-editor__value mono"
            type="text"
            placeholder="x, y"
            value={fmtPoint(tapTarget()!.point)}
            onInput={(e) => setTarget({ point: parsePoint(e.currentTarget.value) })}
            spellcheck={false}
          />
        </span>
      </Show>
    </span>
  );
}
