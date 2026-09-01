import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Button } from "@relay/ui/button";
import { IconButton } from "@relay/ui/icon-button";
import { useServer } from "../context/server";
import { useRecorder } from "../context/recorder";
import { useDeviceStageLiveFrame } from "../lib/use-device-stage-live-frame";
import { DeviceInteractionSurface } from "./device-interaction-surface";
import { useDeviceStageKeyboard } from "../lib/use-device-stage-keyboard";
import { Icon } from "./icon";
import { BrowserDeviceSemanticOverlay } from "./browser-device-semantic-overlay";
import { BrowserDeviceEnvironmentSummary } from "./browser-device-environment-summary";

const INTERACTION_FRAME_INTERVAL_MS = 50;
const IDLE_FRAME_INTERVAL_MS = 500;
const INTERACTION_BURST_MS = 1_500;
const WHEEL_BURST_MS = 90;

/** Raster-only view of the canonical server-owned Playwright page. No page
 * markup, script, iframe, webview, or WebContents enters Relay's renderer. */
export function BrowserDeviceStage() {
  const server = useServer();
  const recorder = useRecorder();
  const frameSrc = useDeviceStageLiveFrame();
  const [url, setUrl] = createSignal("");
  const [urlDirty, setUrlDirty] = createSignal(false);
  const [visible, setVisible] = createSignal(!document.hidden);
  const [semanticOverlayVisible, setSemanticOverlayVisible] = createSignal(false);
  let screen: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  let wheelBurst:
    | {
        point: { x: number; y: number };
        deltaX: number;
        deltaY: number;
        startedAt: number;
      }
    | undefined;
  let pollInFlight = false;
  let pollingGeneration = 0;
  let lastInteractionAt = Number.NEGATIVE_INFINITY;

  const session = () => server.browserDeviceSession();
  const activePage = createMemo(() =>
    session()?.pages.find((page) => page.id === session()?.activePageId),
  );
  const dimensions = createMemo(() => {
    const frame = server.liveFrame();
    return frame?.browserDevice && frame.width && frame.height
      ? { width: frame.width, height: frame.height }
      : undefined;
  });
  const controlled = () =>
    session()?.ownership === "controlled" && Boolean(server.selectedLeaseId());
  const setupDisabled = () => !controlled() || recorder.recording();
  const streamReady = () => session()?.status === "streaming" && Boolean(frameSrc());
  const semanticLabelsVisible = () =>
    semanticOverlayVisible() && Boolean(server.browserDeviceSemanticOverlay());
  const viewportKey = () =>
    `${session()?.profile.viewport.width ?? 1280}x${session()?.profile.viewport.height ?? 800}`;

  async function poll(): Promise<void> {
    if (!visible() || pollInFlight) return;
    pollInFlight = true;
    try {
      await server.pollLiveFrame();
    } finally {
      pollInFlight = false;
    }
  }

  function pollInterval(): number {
    return performance.now() - lastInteractionAt < INTERACTION_BURST_MS
      ? INTERACTION_FRAME_INTERVAL_MS
      : IDLE_FRAME_INTERVAL_MS;
  }

  function schedulePoll(generation: number, delay = pollInterval()): void {
    if (generation !== pollingGeneration || !visible()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void poll().finally(() => schedulePoll(generation));
    }, delay);
  }

  function markInteraction(): void {
    lastInteractionAt = performance.now();
    schedulePoll(pollingGeneration, 0);
  }

  createEffect(() => {
    const pageUrl = activePage()?.url;
    if (pageUrl && !urlDirty()) setUrl(pageUrl);
  });
  createEffect(() => {
    const targetId = server.selectedDevice();
    if (!targetId) return;
    const generation = ++pollingGeneration;
    void poll().finally(() => schedulePoll(generation));
    onCleanup(() => {
      pollingGeneration += 1;
      if (timer) clearTimeout(timer);
      timer = undefined;
    });
  });
  const onVisibility = () => {
    const nextVisible = !document.hidden;
    setVisible(nextVisible);
    if (!nextVisible) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      return;
    }
    markInteraction();
  };
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    if (wheelTimer) clearTimeout(wheelTimer);
  });

  useDeviceStageKeyboard({
    controlActive: controlled,
    screenElement: () => screen,
  });

  async function navigate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    markInteraction();
    const destination = url().trim();
    setUrlDirty(false);
    if (await server.navigateBrowserDevice(destination)) await poll();
  }

  async function applySwipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number,
    point = from,
  ): Promise<void> {
    markInteraction();
    const deltaX = (from.x - to.x) * 600;
    const deltaY = (from.y - to.y) * 600;
    const applied = await server.scrollDevice(point.x, point.y, deltaX / 600, deltaY / 600);
    if (applied) {
      await recorder.driveSwipe(from, to, durationMs, true, dimensions());
    }
    await poll();
  }

  function finishWheelBurst(): void {
    const burst = wheelBurst;
    wheelBurst = undefined;
    wheelTimer = undefined;
    if (!burst) return;
    const from = { x: 0.5, y: 0.5 };
    const to = {
      x: 0.5 - Math.max(-0.28, Math.min(0.28, burst.deltaX / 600)),
      y: 0.5 - Math.max(-0.28, Math.min(0.28, burst.deltaY / 600)),
    };
    const durationMs = Math.round(Math.max(80, Math.min(performance.now() - burst.startedAt, 600)));
    void applySwipe(from, to, durationMs, burst.point);
  }

  return (
    <section
      aria-label="Browser Device stage"
      class="flex h-full min-h-0 w-full flex-col items-center gap-2 p-3"
      data-browser-device-stage
      onKeyDown={markInteraction}
    >
      <div class="flex w-full max-w-[1100px] shrink-0 flex-col overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-stronger-non-alpha shadow-[var(--map-elevation-control)]">
        <div class="flex min-h-11 items-center gap-1 border-b border-border-weak-base px-1.5">
          <IconButton
            variant="ghost"
            size="normal"
            class="!size-10"
            aria-label="Go back"
            title={recorder.recording() ? "Setup controls pause while recording" : undefined}
            disabled={setupDisabled()}
            onClick={() => {
              markInteraction();
              void server.browserDeviceHistory("back").then(poll);
            }}
          >
            <Icon name="chevron-left" size={14} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="normal"
            class="!size-10"
            aria-label="Reload page"
            title={recorder.recording() ? "Setup controls pause while recording" : undefined}
            disabled={setupDisabled()}
            onClick={() => {
              markInteraction();
              void server.browserDeviceHistory("reload").then(poll);
            }}
          >
            <Icon name="refresh" size={14} />
          </IconButton>
          <form class="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={navigate}>
            <label class="sr-only" for="browser-device-url">
              Browser address
            </label>
            <input
              id="browser-device-url"
              type="url"
              inputmode="url"
              spellcheck={false}
              value={url()}
              disabled={setupDisabled()}
              onInput={(event) => {
                setUrlDirty(true);
                setUrl(event.currentTarget.value);
              }}
              class="h-9 min-w-0 flex-1 rounded-lg border border-border-weak-base bg-background-base px-3 text-caption text-text-strong outline-none focus-visible:border-border-strong-focus focus-visible:ring-2 focus-visible:ring-border-strong-focus/30"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={setupDisabled()}>
              Go
            </Button>
          </form>
          <BrowserDeviceEnvironmentSummary
            profile={() => session()?.profile}
            telemetry={() => session()?.telemetry}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={semanticLabelsVisible()}
            disabled={!streamReady()}
            title="Inspect semantic labels from this exact frame"
            onClick={() => {
              if (semanticLabelsVisible()) {
                setSemanticOverlayVisible(false);
                return;
              }
              void server.inspectBrowserDevice().then((overlay) => {
                setSemanticOverlayVisible(Boolean(overlay));
              });
            }}
          >
            {semanticLabelsVisible() ? "Hide labels" : "Inspect labels"}
          </Button>
          <label class="sr-only" for="browser-device-viewport">
            Browser viewport
          </label>
          <select
            id="browser-device-viewport"
            class="h-10 rounded-lg border border-border-weak-base bg-background-base px-2 text-caption text-text-base outline-none focus-visible:ring-2 focus-visible:ring-border-strong-focus"
            aria-label="Browser viewport"
            disabled={setupDisabled()}
            value={viewportKey()}
            onChange={(event) => {
              const [width, height] = event.currentTarget.value.split("x").map(Number);
              if (!width || !height) return;
              markInteraction();
              void server.openBrowserDevice({ viewport: { width, height } }).then(poll);
            }}
          >
            <Show when={!new Set(["390x844", "1280x800", "1440x900"]).has(viewportKey())}>
              <option value={viewportKey()}>Current · {viewportKey().replace("x", "×")}</option>
            </Show>
            <option value="390x844">Compact · 390×844</option>
            <option value="1280x800">Desktop · 1280×800</option>
            <option value="1440x900">Wide · 1440×900</option>
          </select>
        </div>

        <Show when={(session()?.pages.length ?? 0) > 1}>
          <div class="flex min-h-11 gap-1 overflow-x-auto border-b border-border-weak-base p-1">
            <For each={session()?.pages ?? []}>
              {(page) => (
                <div
                  class="flex min-h-10 min-w-32 max-w-64 items-center rounded-lg pr-1 transition-[background-color,color] duration-hover"
                  classList={{
                    "bg-surface-base text-text-strong": page.active,
                    "text-text-weak": !page.active,
                  }}
                >
                  <button
                    type="button"
                    class="min-h-10 min-w-0 flex-1 truncate rounded-lg px-3 text-left text-caption outline-none focus-visible:ring-2 focus-visible:ring-border-strong-focus"
                    aria-pressed={page.active}
                    disabled={page.closed || setupDisabled()}
                    onClick={() => {
                      markInteraction();
                      void server.activateBrowserDevicePage(page.id).then(poll);
                    }}
                  >
                    {page.title || "Untitled"}
                    {page.kind === "popup" ? " · Popup" : ""}
                  </button>
                  <IconButton
                    variant="ghost"
                    size="small"
                    class="!size-9 shrink-0"
                    aria-label={`Close ${page.title || (page.kind === "popup" ? "popup" : "page")}`}
                    disabled={page.closed || setupDisabled()}
                    onClick={() => {
                      markInteraction();
                      void server.closeBrowserDevicePage(page.id).then(poll);
                    }}
                  >
                    <Icon name="x" size={12} />
                  </IconButton>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="relative min-h-0 w-full max-w-[1100px] flex-1 overflow-hidden rounded-xl border border-border-weak-base bg-black shadow-[0_1px_2px_rgb(0_0_0/14%),0_22px_58px_-32px_rgb(0_0_0/42%)]">
        <Show
          when={frameSrc()}
          fallback={
            <div class="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center text-caption text-white/70">
              <span role="status">
                {server.liveCaptureIssue() ?? session()?.issue ?? "Opening the Browser Device…"}
              </span>
              <Show when={session()?.status === "closed" || session()?.status === "crashed"}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!controlled()}
                  onClick={() => {
                    markInteraction();
                    void server.openBrowserDevice().then(poll);
                  }}
                >
                  Reopen browser
                </Button>
              </Show>
            </div>
          }
        >
          <img
            src={frameSrc()}
            alt="Live pixels from the server-owned browser page"
            draggable={false}
            class="pointer-events-none h-full w-full object-contain"
            width={dimensions()?.width}
            height={dimensions()?.height}
          />
          <BrowserDeviceSemanticOverlay
            overlay={server.browserDeviceSemanticOverlay}
            frame={server.liveFrame}
            visible={semanticOverlayVisible}
          />
          <DeviceInteractionSurface
            sourceDimensions={dimensions}
            disabled={() => !streamReady()}
            viewOnly={() => !controlled()}
            elementRef={(element) => {
              screen = element;
            }}
            ariaLabel="Interactive Browser Device preview. Click the page or use the keyboard to record browser actions."
            onTap={({ point }) => {
              markInteraction();
              void server.clickBrowserDevice(point.logical.x, point.logical.y).then((result) => {
                const applied = typeof result === "boolean" ? result : result.applied;
                if (!applied) return poll();
                return recorder
                  .driveTap(
                    point.logical.x,
                    point.logical.y,
                    true,
                    dimensions(),
                    typeof result === "boolean" ? undefined : result.resolution,
                  )
                  .then(poll);
              });
            }}
            onSwipe={({ start, end, durationMs }) => {
              void applySwipe(start.logical, end.logical, Math.max(80, Math.min(durationMs, 800)));
            }}
            onWheel={({ point, deltaX, deltaY }) => {
              markInteraction();
              wheelBurst = wheelBurst
                ? {
                    ...wheelBurst,
                    point: point.logical,
                    deltaX: wheelBurst.deltaX + deltaX,
                    deltaY: wheelBurst.deltaY + deltaY,
                  }
                : {
                    point: point.logical,
                    deltaX,
                    deltaY,
                    startedAt: performance.now(),
                  };
              if (wheelTimer) clearTimeout(wheelTimer);
              wheelTimer = setTimeout(finishWheelBurst, WHEEL_BURST_MS);
            }}
          />
        </Show>

        <div class="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center px-3">
          <span
            class="max-w-full truncate rounded-full bg-black/75 px-3 py-1.5 text-micro text-white shadow-sm backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            {session()?.status === "degraded" ||
            session()?.status === "crashed" ||
            session()?.status === "closed"
              ? session()?.issue
              : session()?.ownership === "occupied"
                ? "View only · another controller owns input"
                : streamReady()
                  ? `Live · frame ${session()?.sequence ?? 0}`
                  : "Connecting browser pixels…"}
          </span>
        </div>
      </div>
    </section>
  );
}
