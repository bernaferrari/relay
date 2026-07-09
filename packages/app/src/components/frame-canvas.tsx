import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useServer, type Frame } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import { clamp, stepStatusFromRun } from "../lib/run-gates";

/**
 * Infinite pan/zoom canvas of run screenshots — inspired by OpenCode's
 * agentboard graph viewport (translate + scale world space).
 *
 * Flexible: works with live job frames and disk-run frames. Authoring still
 * lives in the step list; this is for step-through evidence.
 */

const CARD_W = 220;
const CARD_H = 400;
const GAP_X = 56;
const PAD = 80;
const MIN_SCALE = 0.2;
const MAX_SCALE = 1.6;

type CanvasFrame = {
  key: string;
  index: number;
  caption: string;
  src: string;
  status?: "pass" | "fail" | "idle";
};

export function FrameCanvas(props: { onCollapse?: () => void }) {
  const server = useServer();
  const wb = useWorkbench();
  const [viewport, setViewport] = createSignal({ x: 40, y: 40, scale: 0.85 });
  const [selected, setSelected] = createSignal(0);
  let rootEl: HTMLDivElement | undefined;
  let pan:
    | {
        startX: number;
        startY: number;
        originX: number;
        originY: number;
      }
    | undefined;

  const items = createMemo<CanvasFrame[]>(() => {
    const reviewed = wb.reviewedRun();
    // Prefer frames from the reviewed disk/live run when present
    if (reviewed?.kind === "disk" && reviewed.run.frames?.length) {
      return reviewed.run.frames.map((f, i) => ({
        key: `disk-${reviewed.run.id}-${i}`,
        index: i,
        caption: f.caption || `Step ${i + 1}`,
        src: server.frameUrlForPersisted(reviewed.run, f),
        status: stepStatusFromRun(reviewed.run.steps, i),
      }));
    }
    if (reviewed?.kind === "live" && reviewed.job.steps?.length) {
      // Live job may still be streaming frames on the server session
      const live = server.frames();
      if (live.length) {
        return live.map((f, i) => ({
          key: f.id,
          index: i,
          caption: f.caption || `Frame ${i + 1}`,
          src: frameToSrc(f),
          status: stepStatusFromRun(reviewed.job.steps, i),
        }));
      }
    }
    // Live session frames — map active job step statuses when available
    const live = server.frames();
    if (live.length) {
      const active = wb.activeLiveJob();
      return live.map((f, i) => ({
        key: f.id,
        index: i,
        caption: f.caption || `Frame ${i + 1}`,
        src: frameToSrc(f),
        status: active ? stepStatusFromRun(active.steps, i) : ("idle" as const),
      }));
    }
    return [];
  });

  const worldW = () => Math.max(PAD * 2 + items().length * (CARD_W + GAP_X), 800);
  const worldH = () => PAD * 2 + CARD_H + 80;

  function cardX(i: number) {
    return PAD + i * (CARD_W + GAP_X);
  }
  function cardY() {
    return PAD;
  }

  function fit() {
    const rect = rootEl?.getBoundingClientRect();
    if (!rect || items().length === 0) return;
    const w = worldW();
    const h = worldH();
    const scale = clamp(Math.min((rect.width - 64) / w, (rect.height - 64) / h), MIN_SCALE, 1.1);
    setViewport({
      scale,
      x: (rect.width - w * scale) / 2,
      y: (rect.height - h * scale) / 2,
    });
  }

  function select(i: number) {
    setSelected(i);
    wb.focusFrame(i);
  }

  // Keep board selection in sync with filmstrip / step focus.
  createEffect(() => {
    const i = server.frameIndex();
    if (i >= 0 && i < items().length) setSelected(i);
  });

  function onWheel(e: WheelEvent) {
    if (!rootEl) return;
    e.preventDefault();
    const rect = rootEl.getBoundingClientRect();
    const cur = viewport();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // zoom toward cursor
    const worldX = (mx - cur.x) / cur.scale;
    const worldY = (my - cur.y) / cur.scale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = clamp(cur.scale * delta, MIN_SCALE, MAX_SCALE);
    setViewport({
      scale: nextScale,
      x: mx - worldX * nextScale,
      y: my - worldY * nextScale,
    });
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // Don't pan when clicking a card (cards stop propagation)
    const t = e.target as HTMLElement;
    if (t.closest?.("[data-fc-card]")) return;
    pan = {
      startX: e.clientX,
      startY: e.clientY,
      originX: viewport().x,
      originY: viewport().y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!pan) return;
    setViewport((v) => ({
      ...v,
      x: pan!.originX + (e.clientX - pan!.startX),
      y: pan!.originY + (e.clientY - pan!.startY),
    }));
  }
  function onPointerUp() {
    pan = undefined;
  }

  createEffect(() => {
    // re-fit when items arrive
    void items().length;
    requestAnimationFrame(fit);
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.onCollapse) {
        e.preventDefault();
        props.onCollapse();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        select(Math.min(selected() + 1, items().length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        select(Math.max(selected() - 1, 0));
      } else if (e.key === "f" || e.key === "F") {
        fit();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <section
      class="flex min-h-0 flex-1 flex-col bg-deep bg-[radial-gradient(ellipse_90%_70%_at_50%_45%,color-mix(in_srgb,var(--color-accent)_7%,transparent),transparent_55%)]"
      aria-label="Frame board"
    >
      <div class="flex h-10 shrink-0 items-center gap-2.5 border-b border-border bg-deep/70 px-3.5">
        <Show when={props.onCollapse}>
          <button type="button" class="btn btn-ghost" onClick={() => props.onCollapse?.()}>
            ← Phone
          </button>
        </Show>
        <Show when={items().length > 0}>
          <span class="mono text-meta font-semibold text-text">{items().length} frames</span>
          <span class="mono text-[10.5px] text-text-faint">scroll · drag · ←→ · Esc</span>
          <span class="mono rounded-md border border-border bg-layer-2 px-2 py-0.5 text-[11px] text-text-faint">
            {Math.round(viewport().scale * 100)}%
          </span>
        </Show>
        <span class="flex-1" />
        <button
          type="button"
          class="btn btn-ghost"
          onClick={() => fit()}
          disabled={!items().length}
        >
          Fit
        </button>
      </div>

      <Show
        when={items().length > 0}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
            <p class="m-0 mt-[18px] mb-1.5 text-[15px] font-semibold tracking-[-0.02em] text-text">
              No frames
            </p>
            <p class="m-0 max-w-80 text-[12.5px] leading-normal text-text-faint">
              Run a test first.
            </p>
          </div>
        }
      >
        <div
          class="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
          ref={rootEl}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            class="absolute top-0 left-0 origin-top-left will-change-transform"
            style={{
              width: `${worldW()}px`,
              height: `${worldH()}px`,
              transform: `translate(${viewport().x}px, ${viewport().y}px) scale(${viewport().scale})`,
            }}
          >
            <div
              class="pointer-events-none absolute -inset-[400px] z-0 bg-[length:24px_24px] bg-[radial-gradient(color-mix(in_srgb,var(--color-border)_70%,transparent)_1px,transparent_1px)]"
              aria-hidden="true"
            />
            {/* edges between cards */}
            <svg
              class="pointer-events-none absolute inset-0 z-[1] overflow-visible"
              width={worldW()}
              height={worldH()}
              aria-hidden="true"
            >
              <For each={items().slice(0, -1)}>
                {(_, i) => {
                  const x1 = cardX(i()) + CARD_W;
                  const x2 = cardX(i() + 1);
                  const y = cardY() + CARD_H / 2;
                  return (
                    <line
                      x1={x1}
                      y1={y}
                      x2={x2}
                      y2={y}
                      class="fill-none stroke-accent/45 stroke-2 [stroke-dasharray:6_6]"
                    />
                  );
                }}
              </For>
            </svg>

            <For each={items()}>
              {(item, i) => (
                <button
                  type="button"
                  data-fc-card
                  class={cn(
                    "absolute z-[1] flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-layer-1 p-0",
                    "shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45),0_0_0_1px_color-mix(in_srgb,#fff_6%,transparent)]",
                    "transition-[border-color,box-shadow,transform] hover:border-border-strong",
                    selected() === i() &&
                      "z-[2] border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_55%,transparent),0_18px_44px_-10px_rgb(0_0_0/0.5)]",
                    item.status === "pass" &&
                      !selected() &&
                      "shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45),0_0_0_1px_color-mix(in_srgb,var(--color-pass)_40%,transparent)]",
                    item.status === "fail" &&
                      !selected() &&
                      "shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45),0_0_0_1px_color-mix(in_srgb,var(--color-fail)_45%,transparent)]",
                  )}
                  style={{
                    left: `${cardX(i())}px`,
                    top: `${cardY()}px`,
                    width: `${CARD_W}px`,
                    height: `${CARD_H}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    select(i());
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Show when={item.status === "pass" || item.status === "fail"}>
                    <span
                      class={cn(
                        "absolute top-0 right-0 left-0 z-[2] h-[3px]",
                        item.status === "pass" && "bg-pass",
                        item.status === "fail" && "bg-fail",
                      )}
                      aria-hidden="true"
                    />
                  </Show>
                  <div class="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-layer-2 px-2">
                    <span class="mono min-w-[1.2em] text-[10.5px] font-semibold text-text-faint">
                      {i() + 1}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-text">
                      {item.caption}
                    </span>
                    <Show when={item.status === "pass"}>
                      <span class="grid size-4 shrink-0 place-items-center rounded-full bg-pass/15 text-pass">
                        <Icon name="check" size={11} />
                      </span>
                    </Show>
                    <Show when={item.status === "fail"}>
                      <span class="grid size-4 shrink-0 place-items-center rounded-full bg-fail/15 text-fail">
                        <Icon name="x" size={11} />
                      </span>
                    </Show>
                  </div>
                  <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-deep">
                    <img
                      class="pointer-events-none h-full w-full object-contain select-none"
                      src={item.src}
                      alt={item.caption}
                      draggable={false}
                    />
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </section>
  );
}

function frameToSrc(f: Frame): string {
  if (f.base64) return `data:${f.mime || "image/png"};base64,${f.base64}`;
  return "";
}
