/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  ArrowUp,
  ChevronLeft,
  Circle,
  Square,
  MonitorSmartphone,
  LoaderCircle,
  Expand,
  Minimize2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type KeyboardEvent,
  type ClipboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
  type CSSProperties,
} from "react";
import { useLivePreviewFullscreen } from "./use-live-preview-fullscreen";
import type {
  LiveTargetBrowserContext,
  LiveTargetInput,
  LiveTargetStatus,
} from "../data/live-target-session";

type Point = { x: number; y: number };
type TapFeedback = Point & { id: number; pending: boolean };

export function LiveTargetCanvas({
  canvasRef,
  onCanvasChange,
  status,
  issue,
  busy,
  busyLabel = "Sending input…",
  inputEnabled = true,
  controlNotice,
  targetTitle,
  targetDetail,
  browserContext,
  send,
  recording = true,
  helpText,
  layout = "stage",
  overlay,
  toolbar,
  showTargetDetails = true,
  targetPlatform,
  recoveryAction,
  issueAction,
  directBrowser = targetPlatform === "browser" || Boolean(browserContext),
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onCanvasChange?: (canvas: HTMLCanvasElement | null) => void;
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
  busyLabel?: string;
  inputEnabled?: boolean;
  controlNotice?: ReactNode;
  targetTitle: string;
  targetDetail: string;
  browserContext?: LiveTargetBrowserContext;
  send(input: LiveTargetInput): Promise<boolean>;
  recording?: boolean;
  helpText?: string;
  layout?: "stage" | "rail";
  overlay?: ReactNode;
  toolbar?: ReactNode;
  showTargetDetails?: boolean;
  targetPlatform?: string;
  recoveryAction?: ReactNode;
  issueAction?: ReactNode;
  directBrowser?: boolean;
}) {
  const [text, setText] = useState("");
  const [tap, setTap] = useState<TapFeedback>();
  const tapSequence = useRef(0);
  const fullscreen = useLivePreviewFullscreen();
  const helpId = `${useId()}-help`;
  const textInputId = `live-target-text-${useId().replaceAll(":", "")}`;
  const pointerStart = useRef<Point | undefined>(undefined);
  const wheel = useRef<{ point: Point; x: number; y: number } | undefined>(undefined);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (onCanvasChange) onCanvasChange(node);
      canvasRef.current = node;
    },
    [canvasRef, onCanvasChange],
  );
  const streaming = status === "streaming";
  const interactive = streaming && inputEnabled;
  const help =
    helpText !== ""
      ? (helpText ??
        (recording
          ? "Click, drag, scroll, or type here. Relay records each supported interaction in this test. Enter and Backspace are supported keys."
          : "Click, drag, scroll, or type. Enter and Backspace are supported keys."))
      : undefined;

  useEffect(
    () => () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!tap || tap.pending) return;
    const timer = setTimeout(
      () => setTap((current) => (current === tap ? undefined : current)),
      260,
    );
    return () => clearTimeout(timer);
  }, [tap]);

  function point(event: { clientX: number; clientY: number }): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const drawn = containedFrameRect(canvas.getBoundingClientRect(), canvas.width, canvas.height);
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width - 1,
          Math.round(((event.clientX - drawn.left) / drawn.width) * canvas.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height - 1,
          Math.round(((event.clientY - drawn.top) / drawn.height) * canvas.height),
        ),
      ),
    };
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!interactive || busy) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = point(event);
  }

  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const start = pointerStart.current;
    if (!interactive || busy || !start) return;
    const end = point(event);
    pointerStart.current = undefined;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.hypot(dx, dy) < 10) {
      const canvas = event.currentTarget;
      const id = ++tapSequence.current;
      setTap({ id, x: end.x / canvas.width, y: end.y / canvas.height, pending: true });
      const settle = () =>
        setTap((current) => (current?.id === id ? { ...current, pending: false } : current));
      void send({ kind: "touch", action: "up", x: end.x, y: end.y }).then(settle, settle);
      return;
    }
    void send({ kind: "scroll", x: start.x, y: start.y, scrollX: dx, scrollY: dy });
  }

  function wheelTarget(event: WheelEvent<HTMLCanvasElement>) {
    if (!interactive || busy) return;
    event.preventDefault();
    const origin = point(event);
    const pending = wheel.current ?? { point: origin, x: 0, y: 0 };
    pending.x -= event.deltaX;
    pending.y -= event.deltaY;
    wheel.current = pending;
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      const gesture = wheel.current;
      wheel.current = undefined;
      if (!gesture || Math.hypot(gesture.x, gesture.y) < 2) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const endX = Math.max(1, Math.min(canvas.width - 1, gesture.point.x + gesture.x));
      const endY = Math.max(1, Math.min(canvas.height - 1, gesture.point.y + gesture.y));
      void send({
        kind: "scroll",
        x: gesture.point.x,
        y: gesture.point.y,
        scrollX: endX - gesture.point.x,
        scrollY: endY - gesture.point.y,
      });
    }, 140);
  }

  function keyTarget(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!interactive || busy || composing.current || event.metaKey || event.ctrlKey || event.altKey)
      return;
    if (event.key === "Enter") {
      event.preventDefault();
      void send({ kind: "key", key: "enter" });
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      void send({ kind: "key", key: "backspace" });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      void send({ kind: "key", key: "enter", text: event.key });
    }
  }

  function pasteTarget(event: ClipboardEvent<HTMLCanvasElement>) {
    if (!interactive || (busy && !directBrowser)) return;
    const value = event.clipboardData.getData("text");
    if (!value) return;
    event.preventDefault();
    void send({ kind: "key", key: "enter", text: value });
  }

  function typeText() {
    const value = text;
    if (!value || busy || !interactive) return;
    void send({ kind: "key", key: "enter", text: value })
      .then((delivered) => {
        // Keep the draft visible when the transport rejects or recording cannot
        // accept the interaction. Clearing on an attempted send made text look
        // successfully recorded when it had actually been lost.
        if (delivered === true) setText((current) => (current === value ? "" : current));
      })
      .catch(() => {
        /* The caller presents the delivery error; keep the draft. */
      });
  }

  const rail = layout === "rail";

  return (
    <dialog
      ref={fullscreen.surface}
      open
      role={fullscreen.expanded ? "dialog" : "group"}
      aria-label={fullscreen.expanded ? `Live control: ${targetTitle}` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        fullscreen.setExpanded(false);
      }}
      className={
        fullscreen.expanded
          ? "fixed inset-0 m-0 grid h-dvh w-screen max-h-none max-w-none grid-rows-[minmax(0,1fr)_auto_auto] overflow-hidden border-0 bg-background p-4 text-foreground backdrop:bg-background/80"
          : rail
            ? "relative m-0 flex h-full min-h-0 w-full flex-col border-0 bg-transparent p-0 text-foreground"
            : "relative m-0 grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_auto_auto] border-0 bg-transparent p-0 text-foreground"
      }
    >
      <div
        className={
          directBrowser
            ? "relative flex min-h-0 items-start justify-center overflow-auto bg-muted/40 p-4"
            : rail && !fullscreen.expanded
              ? "relative flex min-h-80 flex-1 items-center justify-center overflow-hidden bg-muted/40"
              : "relative flex min-h-0 items-center justify-center overflow-visible p-3"
        }
      >
        <canvas
          ref={attachCanvas}
          data-slot="capture-live-target"
          className={
            directBrowser
              ? "my-auto block h-auto w-full shrink-0 rounded-lg shadow-md ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "h-full max-h-full max-w-full min-h-0 min-w-0 touch-none object-contain"
          }
          aria-label={`Interactive Device: ${targetTitle}`}
          aria-describedby={help ? helpId : undefined}
          tabIndex={interactive ? 0 : -1}
          aria-disabled={!interactive || busy}
          aria-busy={busy}
          onPointerDown={pointerDown}
          onPointerUp={pointerUp}
          onPointerCancel={() => {
            pointerStart.current = undefined;
          }}
          onWheel={wheelTarget}
          onKeyDown={keyTarget}
          onPaste={pasteTarget}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            if (!interactive || busy || !event.data) return;
            void send({ kind: "key", key: "enter", text: event.data });
          }}
        />
        {!streaming ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-background p-8 text-center text-foreground"
            role="status"
          >
            <div className="flex max-w-sm flex-col items-center gap-2">
              <span
                className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground [&>svg]:size-5"
                aria-hidden="true"
              >
                {issue ? (
                  <MonitorSmartphone />
                ) : (
                  <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                )}
              </span>
              <h2 className="text-base font-medium">
                {issue ? "Live view unavailable" : "Connecting to live view…"}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {issue && /failed to fetch|networkerror|load failed/iu.test(issue)
                  ? "Relay lost the connection. Reconnect to restore the live view."
                  : issue &&
                      /iOS preview.*(?:cooling down|still stopping|became stale)|safe iOS preview producer ended/iu.test(
                        issue,
                      )
                    ? "The live view stopped. Reconnect to restore it."
                    : (issue ?? "The app will appear here once connected.")}
              </p>
              {issue && recoveryAction ? <div className="mt-4">{recoveryAction}</div> : null}
            </div>
          </div>
        ) : null}
        {streaming ? overlay : null}
        {streaming && tap ? <LiveTapFeedback key={tap.id} canvasRef={canvasRef} tap={tap} /> : null}
        {streaming && ((busy && !tap?.pending) || controlNotice) ? (
          <div className="pointer-events-none absolute left-3 top-3 z-20">
            <div
              className="pointer-events-auto flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm shadow-sm ring-1 ring-border"
              role="status"
              aria-live="polite"
            >
              {busy ? (
                <>
                  <LoaderCircle
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  {busyLabel}
                </>
              ) : (
                controlNotice
              )}
            </div>
          </div>
        ) : null}
        {streaming && issue ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
            <div
              role="status"
              className="pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg bg-background px-4 py-3 text-sm shadow-sm ring-1 ring-border"
            >
              <p className="min-w-0 flex-1 leading-relaxed">{issue}</p>
              {issueAction}
            </div>
          </div>
        ) : null}
      </div>

      {!directBrowser && streaming ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          ref={fullscreen.trigger}
          className="absolute right-3 top-3 z-20"
          aria-label={fullscreen.expanded ? "Exit fullscreen" : "Fullscreen live control"}
          aria-pressed={fullscreen.expanded}
          title={
            fullscreen.expanded ? "Exit fullscreen (Escape)" : "Fullscreen · fit the whole device"
          }
          onClick={() => {
            if (wheelTimer.current) clearTimeout(wheelTimer.current);
            wheelTimer.current = undefined;
            wheel.current = undefined;
            fullscreen.setExpanded((value) => !value);
          }}
        >
          {fullscreen.expanded ? <Minimize2 aria-hidden="true" /> : <Expand aria-hidden="true" />}
        </Button>
      ) : null}

      {!directBrowser || showTargetDetails || toolbar ? (
        <div
          className={
            rail
              ? "grid min-w-0 grid-cols-1 gap-2 border-t border-border p-2"
              : "grid min-w-0 grid-cols-1 gap-2 border-t border-border p-2"
          }
        >
          {showTargetDetails ? (
            <div className="grid min-w-0 gap-0.5">
              <strong className="text-sm font-semibold">{targetTitle}</strong>
              <span className="text-xs text-muted-foreground">{targetDetail}</span>
              {browserContext ? (
                <span
                  aria-label="Current browser configuration"
                  className="break-words text-xs text-muted-foreground"
                >
                  {browserContext.engine[0]?.toUpperCase()}
                  {browserContext.engine.slice(1)} · {browserContext.viewport.width}×
                  {browserContext.viewport.height} · {browserContext.locale}
                  {browserContext.authenticationFixtureId
                    ? ` · Account reference ${browserContext.authenticationFixtureId}`
                    : ""}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex w-full flex-wrap items-center gap-2">
            {targetPlatform === "android" ? (
              <div
                role="group"
                aria-label="Android navigation"
                className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/50 p-0.5"
              >
                {(
                  [
                    { key: "back", label: "Back", icon: ChevronLeft, help: "Go back in Android" },
                    { key: "home", label: "Home", icon: Circle, help: "Go to the home screen" },
                    { key: "recents", label: "Recents", icon: Square, help: "Show recent apps" },
                  ] as const
                ).map(({ key, label, icon: Icon, help }) => (
                  <Button
                    key={key}
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Android ${label}`}
                    title={`${label} — ${help}`}
                    disabled={busy || !interactive}
                    onClick={() => void send({ kind: "key", key })}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </Button>
                ))}
              </div>
            ) : null}
            {toolbar}
            {!directBrowser ? (
              <>
                <label className="sr-only" htmlFor={textInputId}>
                  Text to type into the focused field
                </label>
                <Input
                  className="min-w-24 flex-1 basis-40"
                  id={textInputId}
                  value={text}
                  onChange={(event) => setText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      typeText();
                    }
                  }}
                  placeholder="Type into the app"
                  disabled={!interactive || busy}
                  autoComplete="off"
                  maxLength={16_384}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  aria-label="Type text into app"
                  title="Type text into the focused field"
                  disabled={!text || !interactive || busy}
                  onClick={typeText}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {help ? (
        <p id={helpId} className="px-3 pb-3 text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </dialog>
  );
}

/**
 * Where the frame is actually drawn inside the canvas element. The canvas uses
 * object-fit: contain, so a frame with a different aspect is letterboxed;
 * mapping a click against the whole element would land on the wrong control.
 */
export function containedFrameRect(
  element: { left: number; top: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
): { left: number; top: number; width: number; height: number } {
  const boxWidth = Math.max(element.width, 1);
  const boxHeight = Math.max(element.height, 1);
  if (!frameWidth || !frameHeight) {
    return { left: element.left, top: element.top, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / frameWidth, boxHeight / frameHeight);
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    left: element.left + (boxWidth - width) / 2,
    top: element.top + (boxHeight - height) / 2,
    width,
    height,
  };
}

/** Follow the drawn frame, including letterboxing and fullscreen resize. */
function LiveTapFeedback({
  canvasRef,
  tap,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  tap: TapFeedback;
}) {
  const [position, setPosition] = useState<Point>();
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const update = () => {
      const frame = containedFrameRect(canvas.getBoundingClientRect(), canvas.width, canvas.height);
      const origin = stage.getBoundingClientRect();
      setPosition({
        x: frame.left - origin.left + stage.scrollLeft + tap.x * frame.width,
        y: frame.top - origin.top + stage.scrollTop + tap.y * frame.height,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [canvasRef, tap.x, tap.y]);
  return position ? (
    <div
      data-slot="live-tap-feedback"
      data-pending={tap.pending}
      className="pointer-events-none absolute left-(--tap-x) top-(--tap-y) z-20 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center text-primary"
      style={{ "--tap-x": `${position.x}px`, "--tap-y": `${position.y}px` } as CSSProperties}
    >
      <span
        data-slot="live-tap-ripple"
        className="absolute inset-0 animate-live-tap-ripple rounded-full border-2 border-current bg-primary/15 motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span
        className={
          tap.pending ? "size-2 rounded-full bg-primary ring-2 ring-background" : "sr-only"
        }
        aria-hidden="true"
      />
      <span className="sr-only" role="status" aria-live="polite">
        {tap.pending ? "Sending tap…" : ""}
      </span>
    </div>
  ) : null;
}
