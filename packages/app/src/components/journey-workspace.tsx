import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { JourneyMetadata, Revisioned } from "@relay/protocol";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer, type RecipeStep } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { sentenceForStep } from "../lib/step-sentence";
import { cn } from "../lib/cn";
import { Icon, type IconName } from "./icon";
import { FrameCanvas } from "./frame-canvas";
import { AddMenu } from "./step-list-controls";
import { kindLabel } from "./step-list-metadata";

type Viewport = { x: number; y: number; scale: number };
type EdgeStyle = "flow" | "branch" | "failure";
type EdgeConfig = { label: string; style: EdgeStyle };

const JOURNEY_NODE_WIDTH = 252;
const JOURNEY_NODE_PORT_Y = 92;

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
      x: index * 342,
      y: index % 2 === 0 ? 0 : 58,
    })),
  );
  const width = () => Math.max(620, nodes().length * 342 + 252);
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
      class="journey-board"
      aria-label="Planned test journey"
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoom(event.deltaY > 0 ? -0.08 : 0.08);
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
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
    >
      <div class="journey-board__mode">
        <span>
          <i /> Planned flow
        </span>
        <b>
          {nodes().length} action{nodes().length === 1 ? "" : "s"}
        </b>
      </div>
      <div class="journey-board__controls">
        <button type="button" onClick={() => zoom(-0.1)} aria-label="Zoom out">
          −
        </button>
        <span>{Math.round(view().scale * 100)}%</span>
        <button type="button" onClick={() => zoom(0.1)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setView(fittedView())}>
          Fit
        </button>
      </div>

      <Show when={selectedEdge() !== null}>
        <div class="journey-edge-editor" onPointerDown={(event) => event.stopPropagation()}>
          <div>
            <span class="relay-eyebrow">Connection</span>
            <strong>Customize arrow</strong>
          </div>
          <label>
            <span>Label</span>
            <input
              value={edgeConfig()[selectedEdge()!]?.label ?? defaultEdge(selectedEdge()!).label}
              onInput={(event) => patchEdge(selectedEdge()!, { label: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>Type</span>
            <select
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
          <div class="journey-board__empty">
            <div>
              <Icon name="move" size={22} />
            </div>
            <strong>No journey yet</strong>
            <p>Add a step or record the device. Screens will appear here as a navigable flow.</p>
          </div>
        }
      >
        <div
          class="journey-board__world"
          style={{
            transform: `translate3d(${view().x}px, ${view().y}px, 0) scale(${view().scale})`,
            width: `${width()}px`,
          }}
        >
          <svg
            class="journey-board__edges"
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
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            <For each={nodes().slice(0, -1)}>
              {(node) => {
                const next = () => nodes()[node.index + 1]!;
                const x1 = () => node.x + JOURNEY_NODE_WIDTH + 7;
                const y1 = () => node.y + JOURNEY_NODE_PORT_Y;
                const x2 = () => next().x - 13;
                const y2 = () => next().y + JOURNEY_NODE_PORT_Y;
                return (
                  <g
                    class={`journey-edge is-${edgeConfig()[node.index]?.style ?? defaultEdge(node.index).style}`}
                  >
                    <path
                      class="journey-edge__hit"
                      d={`M ${x1()} ${y1()} C ${x1() + 56} ${y1()}, ${x2() - 56} ${y2()}, ${x2()} ${y2()}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => setSelectedEdge(node.index)}
                    />
                    <path
                      class="journey-edge__line"
                      marker-end="url(#journey-arrow)"
                      d={`M ${x1()} ${y1()} C ${x1() + 56} ${y1()}, ${x2() - 56} ${y2()}, ${x2()} ${y2()}`}
                    />
                    <text x={(x1() + x2()) / 2} y={(y1() + y2()) / 2 - 10} text-anchor="middle">
                      {edgeConfig()[node.index]?.label ?? defaultEdge(node.index).label}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>
          <For each={nodes()}>
            {(node) => (
              <div
                role="button"
                tabIndex={0}
                class={cn("journey-node", workbench.focusedIndex() === node.index && "is-active")}
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
                <JourneyPlanCard step={node.step} index={node.index} />
                <Show when={node.index > 0}>
                  <div class="journey-node__port is-input" aria-hidden="true" />
                </Show>
                <Show when={node.index < nodes().length - 1}>
                  <div class="journey-node__port is-output" aria-hidden="true" />
                </Show>
                <button
                  type="button"
                  class="journey-node__add"
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
                  <Icon name="plus" size={15} />
                </button>
              </div>
            )}
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

export function JourneyPlanCard(props: { step: RecipeStep; index: number }) {
  const server = useServer();
  return (
    <div class="journey-plan-card" style={{ "--journey-node-accent": accentForStep(props.step) }}>
      <header>
        <span class="journey-plan-card__index">{String(props.index + 1).padStart(2, "0")}</span>
        <span class="journey-plan-card__kind">{kindLabel(props.step.kind)}</span>
        <Icon name="more" size={14} />
      </header>
      <div class="journey-plan-card__body">
        <span class="journey-plan-card__icon">
          <Icon name={iconForStep(props.step)} size={20} />
        </span>
        <div>
          <small>{actionForStep(props.step)}</small>
          <strong>{sentenceForStep(props.step, server.recipes())}</strong>
        </div>
      </div>
      <footer>
        <span>
          <i /> Evidence after run
        </span>
        <Icon name="chevron-right" size={13} />
      </footer>
    </div>
  );
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
