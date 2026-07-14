import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { JourneyMetadata, Revisioned } from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer, type RecipeStep, type RecordedStepEvidence } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { sentenceForStep } from "../lib/step-sentence";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";
import { FrameCanvas } from "./frame-canvas";
import { AddMenu } from "./step-list-controls";
import { kindLabel } from "./step-list-metadata";
import { eyebrow } from "../lib/ui";

type Viewport = { x: number; y: number; scale: number };
type EdgeStyle = "flow" | "branch" | "failure";
type EdgeConfig = { label: string; style: EdgeStyle };

const JOURNEY_NODE_WIDTH = 220;
const JOURNEY_NODE_PORT_Y = 200;
const JOURNEY_NODE_GAP = 96;

const boardChrome =
  "absolute top-3.5 z-[5] flex min-h-[38px] items-center rounded-[10px] border border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-panel)_92%,transparent)] shadow-[var(--v2-elevation-floating)] backdrop-blur-[12px]";

const controlBtn =
  "inline-flex h-[30px] min-w-[30px] items-center justify-center rounded-[7px] text-[10px] text-[var(--relay-text-secondary)] hover:bg-surface-raised-base-hover hover:text-[var(--relay-text)]";

/**
 * Journey is always available. Captured frames use the full freeform graph;
 * before evidence exists we render an editable planned graph from recipe steps
 * instead of disabling the feature and hiding the product model.
 */
export function JourneyWorkspace(props: { onLive: () => void }) {
  const server = useServer();
  return (
    <Show when={server.frames().length > 0} fallback={<PlannedJourney />}>
      <FrameCanvas onCollapse={props.onLive} />
    </Show>
  );
}

function PlannedJourney() {
  const server = useServer();
  const draft = useRecipeDraft();
  const workbench = useWorkbench();
  const fittedView = (): Viewport => ({
    x: window.innerWidth < 1500 ? 48 : 64,
    y: 72,
    scale: window.innerWidth < 1500 ? 0.78 : 0.9,
  });
  const [view, setView] = createSignal<Viewport>(fittedView());
  const [selectedEdge, setSelectedEdge] = createSignal<number | null>(null);
  const [addMenu, setAddMenu] = createSignal<{
    at: number;
    anchor: { left: number; top: number; bottom: number; width: number };
  } | null>(null);
  const [edgeConfig, setEdgeConfig] = createSignal<Record<number, EdgeConfig>>({});
  const [journeyRevision, setJourneyRevision] = createSignal<Revisioned<JourneyMetadata>>({
    revision: 0,
    value: { positions: {}, edgeLabels: {}, edgeKinds: {} },
    updatedAt: 0,
  });
  let drag: { x: number; y: number; vx: number; vy: number } | null = null;

  const nodes = createMemo(() =>
    draft.steps().map((step, index) => ({
      step,
      index,
      x: index * (JOURNEY_NODE_WIDTH + JOURNEY_NODE_GAP),
      y: 0,
    })),
  );
  const evidenceCount = createMemo(
    () => nodes().filter((node) => evidenceForStep(node.step)?.screenshot).length,
  );
  const width = () =>
    Math.max(620, nodes().length * (JOURNEY_NODE_WIDTH + JOURNEY_NODE_GAP) + JOURNEY_NODE_WIDTH);
  const defaultEdge = (index: number): EdgeConfig => {
    const step = nodes()[index]?.step;
    return step?.kind === "branch"
      ? { label: `Matched → ${step.thenRecipeId}`, style: "branch" }
      : step?.kind === "repeat"
        ? { label: `Repeat ${step.count}×`, style: "branch" }
        : { label: "Continue", style: "flow" };
  };

  createEffect(() => {
    const id = server.selectedRecipeId();
    if (!id) return;
    void server
      .loadJourney(id)
      .then((metadata) => {
        if (server.selectedRecipeId() !== id) return;
        setJourneyRevision(metadata);
        setEdgeConfig(
          Object.fromEntries(
            Object.keys(metadata.value.edgeLabels).map((key) => [
              Number(key),
              {
                label: metadata.value.edgeLabels[key] ?? "Continue",
                style: (metadata.value.edgeKinds[key] as EdgeStyle | undefined) ?? "flow",
              },
            ]),
          ),
        );
      })
      .catch(() => setEdgeConfig({}));
    setSelectedEdge(null);
  });

  function patchEdge(index: number, patch: Partial<EdgeConfig>): void {
    const next = {
      ...edgeConfig(),
      [index]: {
        label: edgeConfig()[index]?.label ?? defaultEdge(index).label,
        style: edgeConfig()[index]?.style ?? defaultEdge(index).style,
        ...patch,
      },
    };
    setEdgeConfig(next);
    const id = server.selectedRecipeId();
    if (id) {
      const current = journeyRevision();
      const value: JourneyMetadata = {
        ...current.value,
        edgeLabels: Object.fromEntries(
          Object.entries(next).map(([key, config]) => [key, config.label]),
        ),
        edgeKinds: Object.fromEntries(
          Object.entries(next).map(([key, config]) => [key, config.style]),
        ),
      };
      setJourneyRevision({
        ...current,
        revision: current.revision + 1,
        value,
        updatedAt: Date.now(),
      });
      void server
        .saveJourney(id, current, value)
        .then(setJourneyRevision)
        .catch(() => setJourneyRevision(current));
    }
  }

  function zoom(delta: number): void {
    setView((current) => ({ ...current, scale: clamp(current.scale + delta, 0.48, 1.18) }));
  }

  return (
    <section
      class="!absolute inset-0 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing [background-image:radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--relay-text)_10%,transparent)_1px,transparent_0)] [background-size:20px_20px]"
      aria-label="Planned test journey"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoom(event.deltaY > 0 ? -0.08 : 0.08);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select"))
          return;
        event.preventDefault();
        const current = view();
        drag = { x: event.clientX, y: event.clientY, vx: current.x, vy: current.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        setView((current) => ({
          ...current,
          x: drag!.vx + event.clientX - drag!.x,
          y: drag!.vy + event.clientY - drag!.y,
        }));
      }}
      onPointerUp={() => {
        drag = null;
      }}
      onPointerCancel={() => {
        drag = null;
      }}
      onLostPointerCapture={() => {
        drag = null;
      }}
    >
      <div
        class={cn(
          boardChrome,
          "left-3.5 gap-2.5 px-2.5 text-[10px] text-[var(--relay-text-secondary)]",
        )}
      >
        <span class="inline-flex items-center gap-1.5 font-semibold">
          <i class="size-1.5 rounded-full bg-[var(--relay-accent)] shadow-[0_0_9px_color-mix(in_srgb,var(--relay-accent)_65%,transparent)]" />
          {nodes().length} {nodes().length === 1 ? "step" : "steps"}
        </span>
        <b class="border-l border-[var(--relay-line)] pl-2.5 font-mono text-[9px] font-normal text-[var(--relay-text-tertiary)]">
          {evidenceCount() > 0 ? `${evidenceCount()} captured` : "Not run yet"}
        </b>
      </div>
      <div class={cn(boardChrome, "right-3.5 gap-0.5 border-0 p-1")}>
        <button type="button" class={controlBtn} onClick={() => zoom(-0.1)} aria-label="Zoom out">
          −
        </button>
        <span class="inline-flex h-[30px] min-w-10 items-center justify-center font-mono text-[10px] text-[var(--relay-text-tertiary)]">
          {Math.round(view().scale * 100)}%
        </span>
        <button type="button" class={controlBtn} onClick={() => zoom(0.1)} aria-label="Zoom in">
          +
        </button>
        <button type="button" class={controlBtn} onClick={() => setView(fittedView())}>
          Fit
        </button>
      </div>

      <Show when={selectedEdge() !== null}>
        <div
          class="absolute top-[82px] right-3.5 z-[7] grid w-[260px] cursor-default gap-2.5 rounded-xl border border-[var(--relay-line)] bg-[var(--relay-panel)] p-3 text-[var(--relay-text)] shadow-[var(--v2-elevation-floating)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div class="grid gap-1">
            <span class={eyebrow}>Connection</span>
            <strong class="text-[13px] font-semibold">Customize arrow</strong>
          </div>
          <label class="grid gap-1">
            <span class="text-[10px] text-[var(--relay-text-tertiary)]">Label</span>
            <input
              class="h-8 w-full rounded-[7px] border border-[var(--relay-line)] bg-[var(--relay-surface-raised)] px-2.5 text-[var(--relay-text)] outline-none focus:border-[var(--text-interactive-base)]"
              value={edgeConfig()[selectedEdge()!]?.label ?? defaultEdge(selectedEdge()!).label}
              onInput={(event) => patchEdge(selectedEdge()!, { label: event.currentTarget.value })}
            />
          </label>
          <label class="grid gap-1">
            <span class="text-[10px] text-[var(--relay-text-tertiary)]">Type</span>
            <select
              class="h-8 w-full rounded-[7px] border border-[var(--relay-line)] bg-[var(--relay-surface-raised)] px-2.5 text-[var(--relay-text)] outline-none"
              value={edgeConfig()[selectedEdge()!]?.style ?? defaultEdge(selectedEdge()!).style}
              onChange={(event) =>
                patchEdge(selectedEdge()!, { style: event.currentTarget.value as EdgeStyle })
              }
            >
              <option value="flow">Normal path</option>
              <option value="branch">Alternate branch</option>
              <option value="failure">Failure path</option>
            </select>
          </label>
          <button
            type="button"
            class="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-[7px] text-[var(--relay-text-tertiary)] hover:bg-surface-raised-base-hover hover:text-[var(--relay-text)]"
            aria-label="Close arrow editor"
            onClick={() => setSelectedEdge(null)}
          >
            ×
          </button>
        </div>
      </Show>

      <Show
        when={nodes().length > 0}
        fallback={
          <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div class="grid size-11 place-items-center rounded-xl bg-[var(--relay-accent-soft)] text-[var(--text-interactive-base)]">
              <Icon name="move" size={22} />
            </div>
            <strong class="mt-3 text-[13px] text-[var(--relay-text)]">No journey yet</strong>
            <p class="mt-1.5 max-w-[330px] text-[11px]/[1.5] text-[var(--relay-text-tertiary)]">
              Add a step or record the device. Screens will appear here as a navigable flow.
            </p>
          </div>
        }
      >
        <div
          class="absolute top-16 left-0 h-[620px] origin-top-left will-change-transform"
          style={{
            transform: `translate3d(${view().x}px, ${view().y}px, 0) scale(${view().scale})`,
            width: `${width()}px`,
          }}
        >
          <svg
            class="pointer-events-auto absolute inset-0 overflow-visible"
            width={width()}
            height="620"
            aria-label="Journey connections"
          >
            <defs>
              <marker
                id="journey-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" class="fill-[var(--relay-accent)] stroke-none" />
              </marker>
            </defs>
            <For each={nodes().slice(0, -1)}>
              {(node) => {
                const next = () => nodes()[node.index + 1]!;
                const x1 = () => node.x + JOURNEY_NODE_WIDTH + 7;
                const y1 = () => node.y + JOURNEY_NODE_PORT_Y;
                const x2 = () => next().x - 13;
                const y2 = () => next().y + JOURNEY_NODE_PORT_Y;
                const style = () =>
                  edgeConfig()[node.index]?.style ?? defaultEdge(node.index).style;
                const lineClass = () =>
                  cn(
                    "pointer-events-none fill-none stroke-2",
                    style() === "branch" &&
                      "stroke-[var(--icon-warning-base)] [stroke-dasharray:2_5]",
                    style() === "failure" &&
                      "stroke-[var(--icon-critical-base)] [stroke-dasharray:8_5]",
                    style() === "flow" &&
                      "stroke-[color-mix(in_srgb,var(--relay-accent)_62%,var(--relay-line))] [stroke-dasharray:6_7]",
                  );
                return (
                  <g>
                    <path
                      class="cursor-pointer fill-none stroke-transparent [stroke-width:18]"
                      d={`M ${x1()} ${y1()} C ${x1() + 56} ${y1()}, ${x2() - 56} ${y2()}, ${x2()} ${y2()}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => setSelectedEdge(node.index)}
                    />
                    <path
                      class={lineClass()}
                      marker-end="url(#journey-arrow)"
                      d={`M ${x1()} ${y1()} C ${x1() + 56} ${y1()}, ${x2() - 56} ${y2()}, ${x2()} ${y2()}`}
                    />
                    <text
                      class="pointer-events-none fill-[var(--relay-text-tertiary)] font-mono text-[9px]"
                      x={(x1() + x2()) / 2}
                      y={(y1() + y2()) / 2 - 10}
                      text-anchor="middle"
                    >
                      {edgeConfig()[node.index]?.label ?? defaultEdge(node.index).label}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
          <For each={nodes()}>
            {(node) => {
              const active = () => workbench.focusedIndex() === node.index;
              return (
                <div
                  role="button"
                  tabIndex={0}
                  class="group absolute top-0 left-0 w-[220px] origin-top-left cursor-pointer select-none rounded-[18px] p-0 text-left outline-none"
                  style={{
                    transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
                    "--journey-node-accent": accentForStep(node.step),
                  }}
                  onClick={() => workbench.focusStep(node.index)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    workbench.focusStep(node.index);
                  }}
                >
                  <JourneyPlanCard step={node.step} index={node.index} active={active()} />
                  <Show when={node.index > 0}>
                    <div
                      class="absolute top-[195px] left-[-5px] size-2.5 rounded-full border-2 border-[var(--relay-panel)] bg-[var(--relay-accent)]"
                      aria-hidden="true"
                    />
                  </Show>
                  <Show when={node.index < nodes().length - 1}>
                    <div
                      class="absolute top-[195px] right-[-5px] size-2.5 rounded-full border-2 border-[var(--relay-panel)] bg-[var(--relay-accent)]"
                      aria-hidden="true"
                    />
                  </Show>
                  <div class="pointer-events-none absolute top-[167px] right-[-76px] z-[4] flex h-[66px] w-[86px] items-center justify-end opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                    <span
                      class="absolute inset-0 [clip-path:polygon(0_28%,100%_0,100%_100%,0_72%)]"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      class="relative mr-1.5 grid size-9 place-items-center rounded-full border border-white/15 bg-[#6f5bf3] text-white shadow-[0_10px_28px_rgb(0_0_0/45%),0_0_0_5px_#10131a] transition-[transform,background-color] duration-150 hover:scale-105 hover:bg-[#806df8] active:scale-90"
                      aria-label={`Add step after ${node.index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setAddMenu({
                          at: node.index + 1,
                          anchor: {
                            left: rect.left,
                            top: rect.top,
                            bottom: rect.bottom,
                            width: rect.width,
                          },
                        });
                      }}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={addMenu()}>
        {(menu) => (
          <AddMenu
            anchor={menu().anchor}
            onClose={() => setAddMenu(null)}
            onPick={(step) => {
              draft.insertStep(menu().at, step);
              workbench.focusStep(menu().at);
              draft.setExpandedStep(menu().at);
              setAddMenu(null);
            }}
          />
        )}
      </Show>
    </section>
  );
}

export function JourneyPlanCard(props: { step: RecipeStep; index: number; active?: boolean }) {
  const server = useServer();
  const evidence = createMemo(() => evidenceForStep(props.step));
  const screenshot = createMemo(() => {
    const shot = evidence()?.screenshot;
    return shot ? server.recordingEvidenceUrl(shot.recipeId, shot.id) : "";
  });
  return (
    <div
      class={cn(
        "relative grid h-[400px] grid-rows-[34px_minmax(0,1fr)_36px] overflow-hidden rounded-[18px] border border-[var(--relay-line-strong)] shadow-[0_8px_24px_rgb(0_0_0/16%)] transition-[border-color,box-shadow] duration-150",
        "bg-surface-raised-stronger-non-alpha",
        "before:absolute before:top-0 before:right-5 before:left-5 before:h-px before:bg-[linear-gradient(90deg,transparent,var(--journey-node-accent),transparent)] before:opacity-70 before:content-['']",
        props.active &&
          "border-[var(--text-interactive-base)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--relay-accent)_26%,transparent),0_12px_32px_rgb(0_0_0/24%)]",
      )}
      style={{ "--journey-node-accent": accentForStep(props.step) }}
    >
      <header class="grid grid-cols-[auto_1fr] items-center gap-2 border-b border-[color-mix(in_srgb,var(--relay-line)_72%,transparent)] px-3 text-[var(--relay-text-tertiary)]">
        <span class="font-mono text-[11px] leading-none text-[var(--relay-text-secondary)]">
          {String(props.index + 1).padStart(2, "0")}
        </span>
        <span class="text-[10px] font-semibold tracking-[0.09em] uppercase">
          {kindLabel(props.step.kind)}
        </span>
      </header>
      <Show
        when={screenshot()}
        fallback={
          <div class="grid min-w-0 place-items-center bg-[radial-gradient(circle_at_50%_38%,color-mix(in_srgb,var(--journey-node-accent)_13%,transparent),transparent_42%),var(--relay-bg)] p-5 text-center">
            <span class="grid size-[46px] place-items-center rounded-[14px] border border-[color-mix(in_srgb,var(--journey-node-accent)_28%,var(--relay-line))] bg-[color-mix(in_srgb,var(--journey-node-accent)_11%,var(--relay-surface-raised))] text-[color-mix(in_srgb,var(--journey-node-accent)_78%,white)]">
              <Icon name={iconForStep(props.step)} size={22} />
            </span>
            <div class="mt-4 min-w-0">
              <strong class="line-clamp-3 block text-[14px]/[1.4] font-semibold tracking-[-0.012em] text-[var(--relay-text)]">
                {sentenceForStep(props.step, server.recipes())}
              </strong>
              <small class="mt-2 block text-[10.5px]/[1.45] text-[var(--relay-text-tertiary)]">
                Run to capture this screen.
              </small>
            </div>
          </div>
        }
      >
        {(src) => (
          <div class="relative min-h-0 overflow-hidden bg-[#080a0f]">
            <img
              src={src()}
              alt={`Device evidence for step ${props.index + 1}`}
              draggable={false}
              class="size-full select-none object-contain object-top"
            />
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pt-8 pb-2.5">
              <small class="mb-0.5 block text-[9px] font-semibold tracking-[0.08em] text-white/65 uppercase">
                {actionForStep(props.step)}
              </small>
              <strong class="line-clamp-1 block text-[13px] font-semibold text-white">
                {sentenceForStep(props.step, server.recipes())}
              </strong>
            </div>
          </div>
        )}
      </Show>
      <footer class="flex items-center justify-between border-t border-[color-mix(in_srgb,var(--relay-line)_72%,transparent)] px-3 text-[var(--relay-text-tertiary)]">
        <span class="inline-flex items-center gap-1.5 text-[10px]">
          <i
            class={cn(
              "size-1.5 rounded-full",
              screenshot() ? "bg-[var(--relay-green)]" : "bg-[var(--relay-amber)]",
            )}
          />
          {screenshot() ? "Captured on device" : "Not captured"}
        </span>
        <Icon name="chevron-right" size={13} />
      </footer>
    </div>
  );
}

export function evidenceForStep(step?: RecipeStep): RecordedStepEvidence | undefined {
  return step && "evidence" in step ? step.evidence : undefined;
}

export function accentForStep(step: RecipeStep): string {
  if (step.kind === "expect" || step.kind === "assert-content") return "#35c89f";
  if (step.kind === "type" || step.kind === "clipboard") return "#5ea7ff";
  if (step.kind === "screenshot" || step.kind === "extract") return "#e985be";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "#f2b65d";
  if (step.kind === "app" || step.kind === "module" || step.kind === "flow") return "#a67cff";
  return "#8068f2";
}

export function iconForStep(step: RecipeStep): IconName {
  if (step.kind === "type") return "keyboard";
  if (step.kind === "screenshot") return "camera";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "clock";
  if (step.kind === "swipe" || step.kind === "scroll") return "move";
  if (step.kind === "expect") return "check";
  if (step.kind === "extract") return "download";
  if (step.kind === "assert-content" || step.kind === "evaluate-semantic") return "check";
  return "pointer";
}

export function actionForStep(step: RecipeStep): string {
  if (step.kind === "expect") return "Validate";
  if (step.kind === "extract") return "Extract";
  if (step.kind === "assert-content" || step.kind === "evaluate-semantic") return "Evaluate";
  if (step.kind === "type") return "Type value";
  if (step.kind === "tap" || step.kind === "long-press") return "Interact";
  if (step.kind === "scroll" || step.kind === "swipe" || step.kind === "key") return "Navigate";
  if (step.kind === "screenshot") return "Capture";
  if (step.kind === "sleep" || step.kind === "wait-for" || step.kind === "wait-response")
    return "Wait";
  return "Continue";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
