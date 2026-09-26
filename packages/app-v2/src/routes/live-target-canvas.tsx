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
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useId,
  type KeyboardEvent,
  type ClipboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import type {
  LiveTargetBrowserContext,
  LiveTargetInput,
  LiveTargetStatus,
} from "../data/live-target-session";

type Point = { x: number; y: number };

export function LiveTargetCanvas({
  canvasRef,
  status,
  issue,
  busy,
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
  directBrowser = false,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
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
  const helpId = `${useId()}-help`;
  const textInputId = `live-target-text-${useId().replaceAll(":", "")}`;
  const pointerStart = useRef<Point | undefined>(undefined);
  const wheel = useRef<{ point: Point; x: number; y: number } | undefined>(undefined);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const streaming = status === "streaming";
  const help =
    helpText !== ""
      ? (helpText ??
        (recording
          ? "Click, drag, scroll, or type here. Relay records each supported interaction in this Test. Enter and Backspace are supported keys."
          : "Click, drag, scroll, or type. Enter and Backspace are supported keys."))
      : undefined;

  useEffect(
    () => () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    },
    [],
  );

  function point(event: { clientX: number; clientY: number }): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width - 1,
          Math.round(((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * canvas.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height - 1,
          Math.round(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * canvas.height),
        ),
      ),
    };
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!streaming || busy) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = point(event);
  }

  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const start = pointerStart.current;
    if (!streaming || busy || !start) return;
    const end = point(event);
    pointerStart.current = undefined;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.hypot(dx, dy) < 10) {
      void send({ kind: "touch", action: "up", x: end.x, y: end.y });
      return;
    }
    void send({ kind: "scroll", x: start.x, y: start.y, scrollX: dx, scrollY: dy });
  }

  function wheelTarget(event: WheelEvent<HTMLCanvasElement>) {
    if (!streaming || busy) return;
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
    if (!streaming || composing.current || event.metaKey || event.ctrlKey || event.altKey) return;
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
    if (!streaming || (busy && !directBrowser)) return;
    const value = event.clipboardData.getData("text");
    if (!value) return;
    event.preventDefault();
    void send({ kind: "key", key: "enter", text: value });
  }

  function typeText() {
    const value = text;
    if (!value || busy || !streaming) return;
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
    <div
      className={
        rail
          ? "flex h-full min-h-0 flex-col"
          : "grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto]"
      }
    >
      <div
        className={
          directBrowser
            ? "relative flex min-h-0 items-start justify-center overflow-auto"
            : rail
              ? "relative flex min-h-80 flex-1 items-center justify-center overflow-hidden bg-muted/40"
              : "relative flex min-h-0 items-center justify-center overflow-visible p-3"
        }
      >
        <canvas
          ref={canvasRef}
          data-slot="capture-live-target"
          className={
            directBrowser
              ? "block h-auto w-full shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "h-full max-h-full max-w-full min-h-0 min-w-0 object-contain"
          }
          aria-label={`Interactive Device: ${targetTitle}`}
          aria-describedby={help ? helpId : undefined}
          tabIndex={streaming ? 0 : -1}
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
            if (!streaming || busy || !event.data) return;
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
                  : (issue ?? "The app will appear here once connected.")}
              </p>
              {issue && recoveryAction ? <div className="mt-4">{recoveryAction}</div> : null}
            </div>
          </div>
        ) : null}
        {streaming ? overlay : null}
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

      {!directBrowser ? (
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
          <div className="flex w-full items-center gap-2">
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
                    disabled={busy || !streaming}
                    onClick={() => void send({ kind: "key", key })}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </Button>
                ))}
              </div>
            ) : null}
            {toolbar}
            <label className="sr-only" htmlFor={textInputId}>
              Text to type into the focused field
            </label>
            <Input
              className="min-w-0 flex-1"
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
              disabled={!streaming || busy}
              autoComplete="off"
              maxLength={16_384}
            />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              aria-label="Type text into app"
              title="Type text into the focused field"
              disabled={!text || !streaming || busy}
              onClick={typeText}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
      {help ? (
        <p id={helpId} className="px-3 pb-3 text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}
