import {
  For,
  Index,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";
import { useServer, type RecipeStep, type StepTarget } from "../context/server";
import { useRecipeDraft } from "../context/recipe-draft";
import { useWorkbench, type RowAnno } from "../context/workbench";
import { sentenceForStep, stepIssue } from "../lib/step-sentence";
import { fmtMs, titleize } from "../lib/job";
import {
  STRATEGIES,
  defaultStrategy,
  detectedChain,
  fmtPoint,
  parsePoint,
  type Strategy,
} from "../lib/step-target";
import { Icon } from "./icon";

type AddOption = { label: string; make: () => RecipeStep };
type AddGroup = { label: string; items: AddOption[] };

/** Add-step menu, grouped Act / Check / More. Swipe is deliberately absent —
 *  authoring meaningful from/to coordinates by hand isn't worth the UI; swipe
 *  steps still show up fine once recorded from the device. */
const ADD_GROUPS: AddGroup[] = [
  {
    label: "Act",
    items: [
      { label: "Tap element", make: () => ({ kind: "tap", target: {} }) },
      { label: "Type text", make: () => ({ kind: "type", text: "" }) },
      { label: "Scroll", make: () => ({ kind: "scroll", direction: "down" }) },
      { label: "Press Back", make: () => ({ kind: "key", key: "back" }) },
      { label: "Press Home", make: () => ({ kind: "key", key: "home" }) },
    ],
  },
  {
    label: "Check",
    items: [
      {
        label: "Check element is visible",
        make: () => ({ kind: "expect", target: {}, condition: "visible" }),
      },
      {
        label: "Check element is gone",
        make: () => ({ kind: "expect", target: {}, condition: "gone" }),
      },
      { label: "Wait for element", make: () => ({ kind: "wait-for", target: {} }) },
      { label: "Wait (sleep)", make: () => ({ kind: "sleep", ms: 500 }) },
    ],
  },
  {
    label: "More",
    items: [
      { label: "Screenshot", make: () => ({ kind: "screenshot" }) },
      { label: "Pause for human", make: () => ({ kind: "pause", message: "" }) },
    ],
  },
];

function isTargetKind(
  step: RecipeStep,
): step is Extract<RecipeStep, { kind: "tap" | "wait-for" | "expect" }> {
  return step.kind === "tap" || step.kind === "wait-for" || step.kind === "expect";
}

/** Manual target editor: segmented strategy selector + one input for the
 *  chosen field's value. Shared by tap / wait-for / expect rows. */
function ManualTarget(props: {
  target: Accessor<StepTarget>;
  strategy: Accessor<Strategy>;
  onStrategy: (s: Strategy) => void;
  onPatch: (patch: Partial<StepTarget>) => void;
  autofocus?: Accessor<boolean>;
  onAutofocused?: () => void;
}): JSX.Element {
  const strat = () => STRATEGIES.find((x) => x.id === props.strategy());
  let inputRef: HTMLInputElement | undefined;
  // createEffect (not onMount): runs after this subtree is in the DOM AND
  // re-runs when the wants-focus flag flips, so it works whether the flag was
  // set before or after the input mounted (the old onMount raced the flag).
  createEffect(() => {
    if (props.autofocus?.()) {
      inputRef?.focus();
      props.onAutofocused?.();
    }
  });
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
          const t = props.target();
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
              ref={inputRef}
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

/** Grouped add-step popover — closes on outside click, Escape, or a pick. */
function AddMenu(props: { onPick: (step: RecipeStep) => void; onClose: () => void }): JSX.Element {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref && !ref.contains(e.target as Node)) props.onClose();
    };
    document.addEventListener("mousedown", onDoc);
    onCleanup(() => document.removeEventListener("mousedown", onDoc));
  });
  return (
    <div
      class="recipe-editor__add-menu"
      role="menu"
      aria-label="Add step"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <For each={ADD_GROUPS}>
        {(g) => (
          <div class="recipe-editor__add-group">
            <div class="recipe-editor__add-group-label">{g.label}</div>
            <For each={g.items}>
              {(o) => (
                <button
                  type="button"
                  class="recipe-editor__add-item"
                  role="menuitem"
                  onClick={() => props.onPick(o.make())}
                >
                  {o.label}
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

/** Slim hover-reveal insertion point between two rows. */
function InsertGap(props: {
  at: number;
  open: boolean;
  onToggle: () => void;
  onPick: (step: RecipeStep) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div class="step-insert" classList={{ "step-insert--open": props.open }}>
      <button
        type="button"
        class="step-insert__btn"
        aria-label="Insert step here"
        data-tip="Insert step here"
        onClick={() => props.onToggle()}
      >
        <Icon name="plus" size={11} />
      </button>
      <Show when={props.open}>
        <AddMenu onPick={props.onPick} onClose={props.onClose} />
      </Show>
    </div>
  );
}

/**
 * The row annotation badge — the ONE place run state renders on a step row.
 * idle dot · pulsing running dot · green check (pops in) · red cross, with
 * duration in tabular figures. Shared by the editor rows and the builtin
 * planned rows so every list annotates identically.
 */
export function StepAnno(props: { anno: Accessor<RowAnno> }): JSX.Element {
  const dur = () => fmtMs(props.anno().durationMs);
  return (
    <span class="sanno" aria-hidden="true">
      <Show when={props.anno().status === "idle"}>
        <span class="sanno__dot" />
      </Show>
      <Show when={props.anno().status === "running"}>
        <span class="sanno__dot sanno__dot--run" />
      </Show>
      <Show when={props.anno().status === "pass"}>
        <span class="sanno__mark sanno__mark--pass">
          <Icon name="check" size={13} />
        </span>
        <Show when={dur()}>
          <span class="sanno__dur">{dur()}</span>
        </Show>
      </Show>
      <Show when={props.anno().status === "fail"}>
        <span class="sanno__mark sanno__mark--fail">
          <Icon name="x" size={13} />
        </span>
        <Show when={dur()}>
          <span class="sanno__dur">{dur()}</span>
        </Show>
      </Show>
    </span>
  );
}

function StepRow(props: {
  step: Accessor<RecipeStep>;
  index: number;
  total: Accessor<number>;
  expanded: Accessor<boolean>;
  flash: Accessor<boolean>;
  autofocus: Accessor<boolean>;
  onAutofocused: () => void;
  onToggleExpand: () => void;
  onChange: (next: RecipeStep) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}): JSX.Element {
  const server = useServer();
  const wb = useWorkbench();
  const initialStep = props.step();
  const [strategy, setStrategy] = createSignal<Strategy>(
    isTargetKind(initialStep) ? defaultStrategy(initialStep.target) : "label",
  );
  const [confirmDel, setConfirmDel] = createSignal(false);
  let delTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(delTimer));

  const kind = () => props.step().kind;
  const issue = () => stepIssue(props.step());
  const anno = () => wb.rowAnno(props.index);

  const target = (): StepTarget => {
    const s = props.step();
    return isTargetKind(s) ? s.target : {};
  };
  const setTarget = (patch: Partial<StepTarget>) => {
    const s = props.step() as Extract<RecipeStep, { kind: "tap" | "wait-for" | "expect" }>;
    props.onChange({ ...s, target: { ...s.target, ...patch } } as RecipeStep);
  };
  /** One-click retarget for a captured tap: prune to the chosen strategy as
   *  primary, keeping `point` as the emergency fallback. */
  const retargetTap = (id: Strategy) => {
    const s = props.step();
    if (s.kind !== "tap") return;
    const t = s.target;
    const pruned: typeof t = {};
    if (id === "ref" && t.ref) pruned.ref = t.ref;
    else if (id === "label" && t.label) pruned.label = t.label;
    else if (id === "text" && t.text) pruned.text = t.text;
    if (t.point) pruned.point = t.point;
    props.onChange({ ...s, target: pruned });
    setStrategy(id);
  };

  function onEdit(next: RecipeStep): void {
    props.onChange(next);
  }

  const canRunStep = () =>
    kind() !== "pause" &&
    !issue() &&
    !wb.running() &&
    server.health() === "online" &&
    !server.isEmptyDevices();
  const runDisabledReason = () => {
    if (kind() === "pause") return "Pause steps need a human — they run inside a full run";
    if (issue()) return issue()!;
    if (wb.running()) return "Already stepping — stop first";
    if (server.health() !== "online") return "Server is offline";
    if (server.isEmptyDevices()) return "Connect a device to run steps";
    return "";
  };
  const runTip = () =>
    runDisabledReason() ||
    (wb.autoContinue() ? "Run from this step (Auto-continue is on)" : "Run this step");

  function armDelete(): void {
    if (confirmDel()) {
      clearTimeout(delTimer);
      props.onRemove();
      return;
    }
    setConfirmDel(true);
    delTimer = setTimeout(() => setConfirmDel(false), 3000);
  }

  return (
    <div
      class="recipe-editor__step"
      classList={{
        "recipe-editor__step--open": props.expanded(),
        "recipe-editor__step--err": Boolean(issue()),
        "recipe-editor__step--flash": props.flash(),
      }}
    >
      <div
        class="recipe-editor__row"
        onClick={(e) => {
          // The whole row toggles the editor — except clicks meant for the
          // action buttons (they live in .recipe-editor__row-actions).
          if ((e.target as HTMLElement).closest(".recipe-editor__row-actions")) return;
          props.onToggleExpand();
        }}
      >
        <span class="recipe-editor__step-i mono">{String(props.index + 1).padStart(2, "0")}</span>
        <button type="button" class="recipe-editor__sentence" aria-expanded={props.expanded()}>
          <Icon
            name={props.expanded() ? "chevron-down" : "chevron-right"}
            size={12}
            class="recipe-editor__chev"
          />
          <span class="recipe-editor__sentence-text">
            {sentenceForStep(props.step(), server.recipes())}
          </span>
        </button>

        <StepAnno anno={anno} />

        <span class="recipe-editor__row-actions">
          <button
            type="button"
            class="recipe-editor__btn"
            data-tip={runTip()}
            aria-label="Run this step"
            disabled={!canRunStep()}
            onClick={() => void wb.runFrom(props.index)}
          >
            <Icon name="play" size={12} />
          </button>
          <button
            type="button"
            class="recipe-editor__btn"
            data-tip="Duplicate step"
            aria-label="Duplicate step"
            onClick={() => props.onDuplicate()}
          >
            <Icon name="copy" size={12} />
          </button>
          <button
            type="button"
            class="recipe-editor__btn"
            data-tip="Move up"
            aria-label="Move step up"
            disabled={props.index === 0}
            onClick={() => props.onMove(-1)}
          >
            <Icon name="chevron-up" size={12} />
          </button>
          <button
            type="button"
            class="recipe-editor__btn"
            data-tip="Move down"
            aria-label="Move step down"
            disabled={props.index === props.total() - 1}
            onClick={() => props.onMove(1)}
          >
            <Icon name="chevron-down" size={12} />
          </button>
          <button
            type="button"
            class="recipe-editor__btn recipe-editor__btn--del"
            data-tip={confirmDel() ? "Click again to confirm" : "Delete step"}
            aria-label="Delete step"
            onClick={() => armDelete()}
          >
            <Show when={!confirmDel()} fallback={<span class="pick-row__sure">Sure?</span>}>
              <Icon name="trash" size={12} />
            </Show>
          </button>
        </span>
      </div>

      {/* Failure auto-surfaces as one compact line — no expand needed. */}
      <Show when={anno().status === "fail" && anno().error}>
        <p class="step-row__fail-msg">
          <Icon name="alert" size={11} />
          {anno().error}
        </p>
      </Show>

      <Show when={issue() && !props.expanded()}>
        <p class="step-row__issue">{issue()}</p>
      </Show>

      <Show when={props.expanded()}>
        <div class="recipe-editor__detail">
          {/* tap — detected chain as one-click retargeting when captured */}
          <Show when={kind() === "tap"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "tap") return null;
              const chain = detectedChain(s.target);
              const hasDetected = chain.some((c) => c.id !== "point");
              if (!hasDetected) {
                return (
                  <div class="recipe-editor__nodetect">
                    <p class="recipe-editor__hint">
                      Choose how to find the element — by label, visible text, @ref, or coordinates.
                    </p>
                    <ManualTarget
                      target={target}
                      strategy={strategy}
                      onStrategy={setStrategy}
                      onPatch={setTarget}
                      autofocus={props.autofocus}
                      onAutofocused={props.onAutofocused}
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
                        aria-checked={strategy() === c.id}
                        class="recipe-editor__chain-opt"
                        classList={{ "recipe-editor__chain-opt--on": strategy() === c.id }}
                        onClick={() => retargetTap(c.id)}
                      >
                        <span class="recipe-editor__chain-mark mono" aria-hidden="true">
                          {strategy() === c.id ? "◉" : "○"}
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
          <Show when={kind() === "wait-for"}>
            <ManualTarget
              target={target}
              strategy={strategy}
              onStrategy={setStrategy}
              onPatch={setTarget}
              autofocus={props.autofocus}
              onAutofocused={props.onAutofocused}
            />
            {(() => {
              const s = props.step();
              if (s.kind !== "wait-for") return null;
              return (
                <span class="recipe-editor__timeout-wrap">
                  <input
                    class="recipe-editor__value mono recipe-editor__value--timeout"
                    type="number"
                    min={0}
                    placeholder="5"
                    value={s.timeoutMs ? Math.round(s.timeoutMs / 1000) : ""}
                    onInput={(e) => {
                      const v = e.currentTarget.value;
                      onEdit({
                        ...s,
                        ...(v
                          ? { timeoutMs: (parseInt(v, 10) || 0) * 1000 }
                          : { timeoutMs: undefined }),
                      });
                    }}
                  />
                  <span class="recipe-editor__unit mono">s</span>
                </span>
              );
            })()}
          </Show>

          {/* expect — target + condition (implied by which add-option was
              chosen) + timeout */}
          <Show when={kind() === "expect"}>
            <ManualTarget
              target={target}
              strategy={strategy}
              onStrategy={setStrategy}
              onPatch={setTarget}
              autofocus={props.autofocus}
              onAutofocused={props.onAutofocused}
            />
            {(() => {
              const s = props.step();
              if (s.kind !== "expect") return null;
              return (
                <>
                  <div class="seg" role="group" aria-label="Condition">
                    {(
                      [
                        ["visible", "Is visible"],
                        ["gone", "Is gone"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        class="seg__btn"
                        classList={{ "seg__btn--on": s.condition === id }}
                        onClick={() => onEdit({ ...s, condition: id })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span class="recipe-editor__timeout-wrap">
                    <input
                      class="recipe-editor__value mono recipe-editor__value--timeout"
                      type="number"
                      min={0}
                      placeholder="5"
                      value={s.timeoutMs ? Math.round(s.timeoutMs / 1000) : ""}
                      onInput={(e) => {
                        const v = e.currentTarget.value;
                        onEdit({
                          ...s,
                          ...(v
                            ? { timeoutMs: (parseInt(v, 10) || 0) * 1000 }
                            : { timeoutMs: undefined }),
                        });
                      }}
                    />
                    <span class="recipe-editor__unit mono">s</span>
                  </span>
                </>
              );
            })()}
          </Show>

          {/* type */}
          <Show when={kind() === "type"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "type") return null;
              let ref: HTMLInputElement | undefined;
              createEffect(() => {
                if (props.autofocus()) {
                  ref?.focus();
                  props.onAutofocused();
                }
              });
              return (
                <input
                  ref={ref}
                  class="recipe-editor__value mono"
                  type="text"
                  placeholder="text to type"
                  value={s.text}
                  onInput={(e) => onEdit({ ...s, text: e.currentTarget.value })}
                  spellcheck={false}
                />
              );
            })()}
          </Show>

          {/* sleep */}
          <Show when={kind() === "sleep"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "sleep") return null;
              let ref: HTMLInputElement | undefined;
              createEffect(() => {
                if (props.autofocus()) {
                  ref?.focus();
                  props.onAutofocused();
                }
              });
              return (
                <span class="recipe-editor__timeout-wrap">
                  <input
                    ref={ref}
                    class="recipe-editor__value mono recipe-editor__value--timeout"
                    type="number"
                    min={0}
                    placeholder="500"
                    value={s.ms}
                    onInput={(e) => onEdit({ ...s, ms: parseInt(e.currentTarget.value, 10) || 0 })}
                  />
                  <span class="recipe-editor__unit mono">ms</span>
                </span>
              );
            })()}
          </Show>

          {/* pause */}
          <Show when={kind() === "pause"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "pause") return null;
              let ref: HTMLInputElement | undefined;
              createEffect(() => {
                if (props.autofocus()) {
                  ref?.focus();
                  props.onAutofocused();
                }
              });
              return (
                <input
                  ref={ref}
                  class="recipe-editor__value"
                  type="text"
                  placeholder="instructions for the human (e.g. complete 2FA)"
                  value={s.message}
                  onInput={(e) => onEdit({ ...s, message: e.currentTarget.value })}
                  spellcheck={false}
                />
              );
            })()}
          </Show>

          {/* key */}
          <Show when={kind() === "key"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "key") return null;
              return (
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
                      classList={{ "seg__btn--on": s.key === id }}
                      onClick={() => onEdit({ kind: "key", key: id })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              );
            })()}
          </Show>

          {/* scroll */}
          <Show when={kind() === "scroll"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "scroll") return null;
              return (
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
                        classList={{ "seg__btn--on": s.direction === id }}
                        onClick={() =>
                          onEdit({
                            kind: "scroll",
                            direction: id,
                            ...(s.amount !== undefined ? { amount: s.amount } : {}),
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
                    value={s.amount ?? ""}
                    onInput={(e) => {
                      const n = parseInt(e.currentTarget.value, 10);
                      onEdit({
                        kind: "scroll",
                        direction: s.direction,
                        ...(Number.isFinite(n) ? { amount: n } : {}),
                      });
                    }}
                  />
                </>
              );
            })()}
          </Show>

          {/* screenshot */}
          <Show when={kind() === "screenshot"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "screenshot") return null;
              return (
                <input
                  class="recipe-editor__value"
                  type="text"
                  placeholder="caption (optional)"
                  value={s.caption ?? ""}
                  onInput={(e) =>
                    onEdit({
                      kind: "screenshot",
                      ...(e.currentTarget.value ? { caption: e.currentTarget.value } : {}),
                    })
                  }
                  spellcheck={false}
                />
              );
            })()}
          </Show>

          {/* flow — pick which built-in flow this step runs */}
          <Show when={kind() === "flow"}>
            {(() => {
              const s = props.step();
              if (s.kind !== "flow") return null;
              const flows = server.recipes().filter((r) => r.source === "builtin");
              return (
                <select
                  class="recipe-editor__value recipe-editor__select"
                  aria-label="Built-in flow"
                  value={s.flow}
                  onChange={(e) => onEdit({ kind: "flow", flow: e.currentTarget.value })}
                >
                  <Show when={s.flow && !flows.some((f) => f.id === s.flow)}>
                    <option value={s.flow}>{titleize(s.flow, server.recipes())}</option>
                  </Show>
                  <For each={flows}>{(f) => <option value={f.id}>{f.title}</option>}</For>
                </select>
              );
            })()}
          </Show>

          {/* When annotated, the expanded row also shows that step's log. */}
          <Show when={anno().log}>
            <pre class="step-row__log mono">{anno().log}</pre>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * The interactive step list for a custom recipe — the run pane's body when a
 * custom recipe is selected and no run is showing. Reads/writes through
 * `useRecipeDraft()`, which owns the debounced autosave; this component is
 * purely presentational + row-local ephemeral state (expand, run result).
 */
export function RecipeStepsEditor(): JSX.Element {
  const draft = useRecipeDraft();
  const [expanded, setExpanded] = createSignal<number | null>(null);
  const [addAt, setAddAt] = createSignal<number | null>(null);
  const [focusIndex, setFocusIndex] = createSignal<number | null>(null);

  function toggle(i: number): void {
    setExpanded((e) => (e === i ? null : i));
  }

  function insertAt(at: number, step: RecipeStep): void {
    draft.insertStep(at, step);
    setAddAt(null);
    setExpanded(at);
    setFocusIndex(at);
  }

  return (
    <div class="recipe-editor__steps">
      <Show when={draft.steps().length === 0}>
        <p class="recipe-editor__empty">No steps yet — record from the device or add one below.</p>
      </Show>

      <Show when={draft.steps().length > 0}>
        <InsertGap
          at={0}
          open={addAt() === 0}
          onToggle={() => setAddAt((a) => (a === 0 ? null : 0))}
          onPick={(s) => insertAt(0, s)}
          onClose={() => setAddAt(null)}
        />
      </Show>

      <Index each={draft.steps()}>
        {(step, i) => (
          <>
            <StepRow
              step={step}
              index={i}
              total={() => draft.steps().length}
              expanded={() => expanded() === i}
              flash={() => draft.flashSteps().has(step())}
              autofocus={() => focusIndex() === i}
              onAutofocused={() => setFocusIndex((f) => (f === i ? null : f))}
              onToggleExpand={() => toggle(i)}
              onChange={(next) => draft.updateStep(i, next)}
              onMove={(dir) => {
                draft.moveStep(i, dir);
                setExpanded((e) => (e === i ? i + dir : e === i + dir ? i : e));
              }}
              onRemove={() => {
                draft.removeStep(i);
                setExpanded((e) => (e === null ? null : e === i ? null : e > i ? e - 1 : e));
              }}
              onDuplicate={() => draft.duplicateStep(i)}
            />
            <Show when={i + 1 < draft.steps().length}>
              <InsertGap
                at={i + 1}
                open={addAt() === i + 1}
                onToggle={() => setAddAt((a) => (a === i + 1 ? null : i + 1))}
                onPick={(s) => insertAt(i + 1, s)}
                onClose={() => setAddAt(null)}
              />
            </Show>
          </>
        )}
      </Index>

      <div class="recipe-editor__add-wrap">
        <button
          type="button"
          class="btn btn-ghost recipe-editor__add"
          aria-haspopup="menu"
          aria-expanded={addAt() === draft.steps().length}
          onClick={() =>
            setAddAt((a) => (a === draft.steps().length ? null : draft.steps().length))
          }
        >
          <Icon name="plus" size={13} />
          Add step
        </button>
        <Show when={addAt() === draft.steps().length}>
          <AddMenu
            onPick={(s) => insertAt(draft.steps().length, s)}
            onClose={() => setAddAt(null)}
          />
        </Show>
      </div>
    </div>
  );
}
