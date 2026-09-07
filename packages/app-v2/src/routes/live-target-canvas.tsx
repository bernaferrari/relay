/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { MonitorSmartphone } from "lucide-react";
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
      x: Math.round(((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * canvas.width),
      y: Math.round(((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * canvas.height),
    };
  }

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!streaming) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = point(event);
  }

  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const start = pointerStart.current;
    if (!streaming || !start) return;
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
    if (!streaming) return;
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
      void send({
        kind: "scroll",
        x: gesture.point.x,
        y: gesture.point.y,
        scrollX: gesture.x,
        scrollY: gesture.y,
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
    if (!streaming || busy) return;
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
          : "grid h-full min-h-[358px] grid-rows-[minmax(0,1fr)_auto_auto]"
      }
    >
      <div
        className={
          rail
            ? "relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden bg-muted/40"
            : "relative flex min-h-[260px] items-center justify-center overflow-hidden"
        }
      >
        <canvas
          ref={canvasRef}
          className="relay-capture-live-target h-full max-h-full max-w-full min-h-0 min-w-0 object-contain"
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
            className="absolute inset-0 grid place-items-center content-center gap-3 bg-muted/60 p-6 text-center"
            role="status"
          >
            <span
              className="grid size-12 place-items-center rounded-xl border border-border bg-background text-muted-foreground [&>svg]:size-6"
              aria-hidden="true"
            >
              <MonitorSmartphone />
            </span>
            <h2>{issue ? "The live view needs attention" : "Connecting"}</h2>
            <p>{issue ?? "The app will appear here when the Device is ready."}</p>
          </div>
        ) : null}
        {overlay}
        {busy ? (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
            {recording ? "Recording interaction…" : "Sending interaction…"}
          </span>
        ) : null}
      </div>
      {streaming && issue ? (
        <p role="status" className="border-t border-border px-3 py-2 text-sm">
          {issue}
        </p>
      ) : null}

      <div
        className={
          rail
            ? "grid gap-2 border-t border-border p-3"
            : "flex items-center justify-between gap-4 border-t border-border p-3 max-[700px]:grid"
        }
      >
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
        <div className="flex items-center gap-2">
          {toolbar}
          <label className="relay-visually-hidden sr-only" htmlFor={textInputId}>
            Text to type into the focused field
          </label>
          <Input
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
            variant="outline"
            disabled={!text || !streaming || busy}
            onClick={typeText}
          >
            Type
          </Button>
        </div>
      </div>
      {help ? (
        <p id={helpId} className="px-3 pb-3 text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}
