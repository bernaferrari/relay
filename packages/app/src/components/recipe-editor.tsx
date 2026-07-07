import { For, Index, Show, createSignal, onMount, onCleanup, type JSX } from "solid-js";
import { useServer, type RecipeInfo, type RecipeStep, type StepTarget } from "../context/server";
import { useCommand } from "../context/command";
import { Icon } from "./icon";
import { trapFocus } from "../lib/modal";
import { titleize } from "../lib/job";

type Strategy = "ref" | "label" | "text" | "point";

const STRATEGIES: { id: Strategy; label: string; placeholder: string }[] = [
  { id: "ref", label: "Element @ref", placeholder: "@e26" },
  { id: "label", label: "Label", placeholder: "Sign in" },
  { id: "text", label: "Text", placeholder: "Welcome back" },
  { id: "point", label: "Point", placeholder: "x, y" },
];

/** Named actions for the Add-step menu (plan 009 step 7). */
const ADD_OPTIONS: { label: string; make: () => RecipeStep }[] = [
  { label: "Tap element", make: () => ({ kind: "tap", target: {} }) },
  { label: "Type text", make: () => ({ kind: "type", text: "" }) },
  { label: "Wait for element", make: () => ({ kind: "wait-for", target: {} }) },
  { label: "Wait (sleep)", make: () => ({ kind: "sleep", ms: 500 }) },
  { label: "Pause for human", make: () => ({ kind: "pause", message: "" }) },
  { label: "Press Back", make: () => ({ kind: "key", key: "back" }) },
  { label: "Press Home", make: () => ({ kind: "key", key: "home" }) },
  { label: "Scroll", make: () => ({ kind: "scroll", direction: "down" }) },
  { label: "Screenshot", make: () => ({ kind: "screenshot" }) },
];

function defaultStrategy(t: StepTarget | undefined): Strategy {
  if (!t) return "ref";
  if (t.ref) return "ref";
  if (t.label) return "label";
  if (t.text) return "text";
  return "point";
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

/**
 * The captured target fields a tap recorded, best-first (ref · label · text ·
 * point) — each with its value, for the one-click retargeting chain (plan 010
 * step 5). Empty when nothing but a raw point (or nothing) was captured.
 */
function detectedChain(t: StepTarget | undefined | null): {
  id: Strategy;
  label: string;
  value: string;
}[] {
  if (!t) return [];
  const out: { id: Strategy; label: string; value: string }[] = [];
  if (t.ref) out.push({ id: "ref", label: "Element", value: t.ref });
  if (t.label) out.push({ id: "label", label: "Label", value: `"${t.label}"` });
  if (t.text) out.push({ id: "text", label: "Text", value: `"${t.text}"` });
  if (t.point) out.push({ id: "point", label: "Point", value: fmtPoint(t.point) });
  return out;
}

/** Human one-liner for a collapsed step row (plan 009 step 7). */
function sentenceFor(step: RecipeStep): string {
  switch (step.kind) {
    case "tap": {
      const t = step.target;
      const what = t.label
        ? `"${t.label}"`
        : t.ref
          ? t.ref
          : t.text
            ? `text "${t.text}"`
            : t.point
              ? `${t.point.x}, ${t.point.y}`
              : "an element";
      return `Tap ${what}`;
    }
    case "type":
      return step.text.trim() ? `Type "${step.text}"` : "Type text";
    case "wait-for": {
      const t = step.target;
      const what = t.label
        ? `"${t.label}"`
        : t.ref
          ? t.ref
          : t.text
            ? `text "${t.text}"`
            : "an element";
      const to = step.timeoutMs ? ` (${Math.round(step.timeoutMs / 1000)}s)` : "";
      return `Wait until ${what} appears${to}`;
    }
    case "sleep":
      return `Wait ${step.ms}ms`;
    case "pause":
      return step.message.trim() ? `Pause: ${step.message}` : "Pause for human";
    case "key":
      return `Press ${step.key === "back" ? "Back" : "Home"}`;
    case "scroll":
      return step.amount ? `Scroll ${step.direction} ${step.amount}` : `Scroll ${step.direction}`;
    case "swipe":
      return `Swipe ${Math.round(step.from.x)},${Math.round(step.from.y)} → ${Math.round(step.to.x)},${Math.round(step.to.y)}`;
    case "screenshot":
      return step.caption ? `Screenshot · ${step.caption}` : "Screenshot";
    case "flow":
      return `Flow: ${titleize(step.flow)}`;
  }
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
  // One row expanded at a time (plan 009 step 7); a single target-strategy
  // signal serves the expanded tap/wait-for row.
  const [expandedIdx, setExpandedIdx] = createSignal<number | null>(null);
  const [targetStrategy, setTargetStrategy] = createSignal<Strategy>("ref");
  const [addOpen, setAddOpen] = createSignal(false);

  onMount(() => {
    onCleanup(cmd.pushModal());
    if (dialogRef) onCleanup(trapFocus(dialogRef));
  });

  function toggleExpand(i: number): void {
    if (expandedIdx() === i) {
      setExpandedIdx(null);
      return;
    }
    const s = steps()[i];
    if (s && (s.kind === "tap" || s.kind === "wait-for")) {
      setTargetStrategy(defaultStrategy(s.target));
    }
    setExpandedIdx(i);
  }

  function addStep(make: () => RecipeStep): void {
    const idx = steps().length;
    setSteps((s) => [...s, make()]);
    setAddOpen(false);
    const made = steps()[idx];
    if (made && (made.kind === "tap" || made.kind === "wait-for")) {
      setTargetStrategy(defaultStrategy(made.target));
    }
    setExpandedIdx(idx);
  }
  function removeStep(i: number): void {
    setSteps((s) => s.filter((_, idx) => idx !== i));
    setExpandedIdx((e) => (e === null ? null : e === i ? null : e > i ? e - 1 : e));
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
    setExpandedIdx((e) => (e === i ? i + dir : e === i + dir ? i : e));
  }
  function setStep(i: number, next: RecipeStep): void {
    setSteps((s) => s.map((st, idx) => (idx === i ? next : st)));
  }

  function targetValid(t: StepTarget): boolean {
    return Boolean(t.ref || t.label || t.text || t.point);
  }
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
      case "swipe":
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
            <Index each={steps()}>
              {(step, i) => (
                <StepRow
                  step={step}
                  index={i}
                  total={steps().length}
                  expanded={() => expandedIdx() === i}
                  invalid={() => !stepValid(step())}
                  strategy={targetStrategy}
                  onToggleExpand={() => toggleExpand(i)}
                  onStrategy={setTargetStrategy}
                  onChange={(next) => setStep(i, next)}
                  onMove={(dir) => move(i, dir)}
                  onRemove={() => removeStep(i)}
                />
              )}
            </Index>
            <Show when={steps().length === 0}>
              <p class="recipe-editor__empty">
                No steps yet — add one below or record from the device.
              </p>
            </Show>
          </div>
          <div class="recipe-editor__add-wrap">
            <button
              type="button"
              class="btn btn-ghost recipe-editor__add"
              aria-haspopup="menu"
              aria-expanded={addOpen()}
              onClick={() => setAddOpen((o) => !o)}
            >
              <Icon name="plus" size={13} />
              Add step
            </button>
            <Show when={addOpen()}>
              <div class="recipe-editor__add-menu" role="menu" aria-label="Add step">
                <For each={ADD_OPTIONS}>
                  {(o) => (
                    <button
                      type="button"
                      class="recipe-editor__add-item"
                      role="menuitem"
                      onClick={() => addStep(o.make)}
                    >
                      {o.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
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

/**
 * Manual target editor: segmented strategy selector + one input for the
 * chosen field's value. Shared by wait-for steps and hand-authored taps that
 * captured no element (plan 010 step 5 keeps it as the authoring fallback).
 */
function ManualTarget(props: {
  target: () => StepTarget | null;
  strategy: () => Strategy;
  onStrategy: (s: Strategy) => void;
  onPatch: (patch: Partial<StepTarget>) => void;
}): JSX.Element {
  const strat = () => STRATEGIES.find((x) => x.id === props.strategy());
  return (
    <>
      <div class="seg" role="group" aria-label="Target strategy">
        <For each={STRATEGIES}>
          {(st) => (
            <button
              type="button"
              class="seg__btn"
              classList={{ "seg__btn--on": props.strategy() === st.id }}
              onClick={() => props.onStrategy(st.id)}
            >
              {st.label}
            </button>
          )}
        </For>
      </div>
      <Show when={strat()}>
        {(st) => {
          const t = props.target() ?? {};
          const value = () =>
            st().id === "ref"
              ? (t.ref ?? "")
              : st().id === "label"
                ? (t.label ?? "")
                : st().id === "text"
                  ? (t.text ?? "")
                  : fmtPoint(t.point);
          const onInput = (v: string) => {
            if (st().id === "ref") props.onPatch({ ref: v || undefined });
            else if (st().id === "label") props.onPatch({ label: v || undefined });
            else if (st().id === "text") props.onPatch({ text: v || undefined });
            else props.onPatch({ point: parsePoint(v) });
          };
          return (
            <input
              class="recipe-editor__value mono"
              type="text"
              placeholder={st().placeholder}
              value={value()}
              onInput={(e) => onInput(e.currentTarget.value)}
              spellcheck={false}
            />
          );
        }}
      </Show>
    </>
  );
}

/** One step row: collapsed = sentence (plan 009 step 7); click to expand. */
function StepRow(props: {
  step: () => RecipeStep;
  index: number;
  total: number;
  expanded: () => boolean;
  invalid: () => boolean;
  strategy: () => Strategy;
  onToggleExpand: () => void;
  onStrategy: (s: Strategy) => void;
  onChange: (next: RecipeStep) => void;
  onMove: (dir: number) => void;
  onRemove: () => void;
}): JSX.Element {
  const isTargetKind = () => {
    const k = props.step().kind;
    return k === "tap" || k === "wait-for";
  };
  const target = () =>
    isTargetKind()
      ? (props.step() as Extract<RecipeStep, { kind: "tap" | "wait-for" }>).target
      : null;
  const setTarget = (patch: Partial<StepTarget>) => {
    const s = props.step() as Extract<RecipeStep, { kind: "tap" | "wait-for" }>;
    props.onChange({ ...s, target: { ...s.target, ...patch } } as RecipeStep);
  };
  /**
   * One-click retarget (plan 010 step 5): prune the tap's target to the chosen
   * strategy as primary, keeping `point` as the fallback. Selecting "point"
   * leaves a point-only target.
   */
  const retargetTap = (id: Strategy) => {
    const s = props.step();
    if (s.kind !== "tap") return;
    const t = s.target;
    const pruned: StepTarget = {};
    if (id === "ref" && t.ref) pruned.ref = t.ref;
    else if (id === "label" && t.label) pruned.label = t.label;
    else if (id === "text" && t.text) pruned.text = t.text;
    if (t.point) pruned.point = t.point;
    props.onChange({ ...s, target: pruned });
    props.onStrategy(id);
  };
  // Narrowed accessors — Solid's <Show when={acc()}>{(s) => s().field}</Show>
  // hands a typed accessor to the children, preserving union narrowing.
  const asType = () => {
    const s = props.step();
    return s.kind === "type" ? s : null;
  };
  const asSleep = () => {
    const s = props.step();
    return s.kind === "sleep" ? s : null;
  };
  const asPause = () => {
    const s = props.step();
    return s.kind === "pause" ? s : null;
  };
  const asKey = () => {
    const s = props.step();
    return s.kind === "key" ? s : null;
  };
  const asScroll = () => {
    const s = props.step();
    return s.kind === "scroll" ? s : null;
  };
  const asScreenshot = () => {
    const s = props.step();
    return s.kind === "screenshot" ? s : null;
  };

  return (
    <div
      class="recipe-editor__step"
      classList={{
        "recipe-editor__step--open": props.expanded(),
        "recipe-editor__step--err": props.invalid(),
      }}
    >
      <div class="recipe-editor__row">
        <span class="recipe-editor__step-i mono">{String(props.index + 1).padStart(2, "0")}</span>
        <button
          type="button"
          class="recipe-editor__sentence"
          aria-expanded={props.expanded()}
          onClick={() => props.onToggleExpand()}
        >
          <Icon
            name={props.expanded() ? "chevron-down" : "chevron-right"}
            size={12}
            class="recipe-editor__chev"
          />
          <span class="recipe-editor__sentence-text">{sentenceFor(props.step())}</span>
          <Show when={props.step().kind === "flow"}>
            <span class="recipe-editor__readonly mono">read-only</span>
          </Show>
        </button>
        <span class="recipe-editor__row-actions">
          <button
            type="button"
            class="recipe-editor__btn"
            title="Move up"
            disabled={props.index === 0}
            onClick={() => props.onMove(-1)}
          >
            <Icon name="chevron-up" size={12} />
          </button>
          <button
            type="button"
            class="recipe-editor__btn"
            title="Move down"
            disabled={props.index === props.total - 1}
            onClick={() => props.onMove(1)}
          >
            <Icon name="chevron-down" size={12} />
          </button>
          <button
            type="button"
            class="recipe-editor__btn recipe-editor__btn--del"
            title="Remove step"
            onClick={() => props.onRemove()}
          >
            <Icon name="x" size={12} />
          </button>
        </span>
      </div>

      <Show when={props.expanded() && props.step().kind !== "flow"}>
        <div class="recipe-editor__detail">
          {/* tap — detected chain as one-click retargeting (plan 010 step 5) */}
          <Show when={props.step().kind === "tap"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "tap") return null;
              const chain = detectedChain(s.target);
              const hasDetected = chain.some((c) => c.id !== "point");
              if (!hasDetected) {
                return (
                  <div class="recipe-editor__nodetect">
                    <p class="recipe-editor__hint">
                      No element was detected under this tap — re-record with the target visible, or
                      pick one now.
                    </p>
                    <button
                      type="button"
                      class="btn btn-ghost"
                      disabled
                      title="Pick on device — available once a live snapshot is captured"
                    >
                      Pick on device
                    </button>
                    <ManualTarget
                      target={target}
                      strategy={props.strategy}
                      onStrategy={props.onStrategy}
                      onPatch={setTarget}
                    />
                  </div>
                );
              }
              return (
                <div class="recipe-editor__chain" role="radiogroup" aria-label="Retarget tap">
                  <For each={chain}>
                    {(c) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={props.strategy() === c.id}
                        class="recipe-editor__chain-opt"
                        classList={{ "recipe-editor__chain-opt--on": props.strategy() === c.id }}
                        onClick={() => retargetTap(c.id)}
                      >
                        <span class="recipe-editor__chain-mark mono" aria-hidden="true">
                          {props.strategy() === c.id ? "◉" : "○"}
                        </span>
                        <span class="recipe-editor__chain-label">{c.label}</span>
                        <span class="recipe-editor__chain-value mono">{c.value}</span>
                      </button>
                    )}
                  </For>
                  <p class="recipe-editor__hint">
                    One click retargets — the chosen field becomes primary, point stays the
                    fallback.
                  </p>
                </div>
              );
            })()}
          </Show>

          {/* wait-for — manual strategy selector + timeout */}
          <Show when={props.step().kind === "wait-for"}>
            <ManualTarget
              target={target}
              strategy={props.strategy}
              onStrategy={props.onStrategy}
              onPatch={setTarget}
            />
            {(() => {
              const s = props.step();
              if (s.kind !== "wait-for") return null;
              return (
                <input
                  class="recipe-editor__value mono recipe-editor__value--timeout"
                  type="number"
                  min={0}
                  placeholder="timeout s"
                  value={Math.round((s.timeoutMs ?? 0) / 1000)}
                  onInput={(e) =>
                    props.onChange({
                      ...s,
                      timeoutMs: (parseInt(e.currentTarget.value, 10) || 0) * 1000,
                    })
                  }
                />
              );
            })()}
          </Show>

          {/* type */}
          <Show when={asType()}>
            {(s) => (
              <input
                class="recipe-editor__value mono"
                type="text"
                placeholder="text to type"
                value={s().text}
                onInput={(e) => props.onChange({ kind: "type", text: e.currentTarget.value })}
                spellcheck={false}
              />
            )}
          </Show>

          {/* sleep */}
          <Show when={asSleep()}>
            {(s) => (
              <input
                class="recipe-editor__value mono"
                type="number"
                min={0}
                placeholder="ms"
                value={s().ms}
                onInput={(e) =>
                  props.onChange({ kind: "sleep", ms: parseInt(e.currentTarget.value, 10) || 0 })
                }
              />
            )}
          </Show>

          {/* pause */}
          <Show when={asPause()}>
            {(s) => (
              <input
                class="recipe-editor__value"
                type="text"
                placeholder="instructions for the human (e.g. complete 2FA)"
                value={s().message}
                onInput={(e) => props.onChange({ kind: "pause", message: e.currentTarget.value })}
                spellcheck={false}
              />
            )}
          </Show>

          {/* key */}
          <Show when={asKey()}>
            {(s) => (
              <div class="seg" role="group" aria-label="Key">
                {(
                  [
                    ["back", "Back"],
                    ["home", "Home"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    class="seg__btn"
                    classList={{ "seg__btn--on": s().key === id }}
                    onClick={() => props.onChange({ kind: "key", key: id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </Show>

          {/* scroll */}
          <Show when={asScroll()}>
            {(s) => (
              <>
                <div class="seg" role="group" aria-label="Direction">
                  {(
                    [
                      ["down", "Down"],
                      ["up", "Up"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      type="button"
                      class="seg__btn"
                      classList={{ "seg__btn--on": s().direction === id }}
                      onClick={() =>
                        props.onChange({
                          kind: "scroll",
                          direction: id,
                          ...(s().amount !== undefined ? { amount: s().amount } : {}),
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  class="recipe-editor__value mono"
                  type="number"
                  min={0}
                  placeholder="amount (optional)"
                  value={s().amount ?? ""}
                  onInput={(e) => {
                    const n = parseInt(e.currentTarget.value, 10);
                    props.onChange({
                      kind: "scroll",
                      direction: s().direction,
                      ...(Number.isFinite(n) ? { amount: n } : {}),
                    });
                  }}
                />
              </>
            )}
          </Show>

          {/* screenshot */}
          <Show when={asScreenshot()}>
            {(s) => (
              <input
                class="recipe-editor__value"
                type="text"
                placeholder="caption (optional)"
                value={s().caption ?? ""}
                onInput={(e) =>
                  props.onChange({
                    kind: "screenshot",
                    ...(e.currentTarget.value ? { caption: e.currentTarget.value } : {}),
                  })
                }
                spellcheck={false}
              />
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
