/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { MonitorSmartphone } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import type { LiveTargetInput, LiveTargetStatus } from "../data/live-target-session";

type Point = { x: number; y: number };

export function LiveTargetCanvas({
  canvasRef,
  status,
  issue,
  busy,
  targetTitle,
  targetDetail,
  send,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
  targetTitle: string;
  targetDetail: string;
  send(input: LiveTargetInput): Promise<void>;
}) {
  const [text, setText] = useState("");
  const pointerStart = useRef<Point | undefined>(undefined);
  const wheel = useRef<{ point: Point; x: number; y: number } | undefined>(undefined);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const streaming = status === "streaming";

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
    if (!streaming || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void send({ kind: "key", key: "enter" });
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      void send({ kind: "key", key: "enter", text: event.key });
    }
  }

  function typeText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text;
    if (!value || busy || !streaming) return;
    void send({ kind: "key", key: "enter", text: value }).then(() => setText(""));
  }

  return (
    <div className="relay-live-target">
      <div className="relay-live-target-frame">
        <canvas
          ref={canvasRef}
          className="relay-capture-live-target"
          aria-label={`Interactive live target: ${targetTitle}`}
          aria-describedby="live-target-help"
          tabIndex={streaming ? 0 : -1}
          onPointerDown={pointerDown}
          onPointerUp={pointerUp}
          onPointerCancel={() => {
            pointerStart.current = undefined;
          }}
          onWheel={wheelTarget}
          onKeyDown={keyTarget}
        />
        {!streaming ? (
          <div className="relay-capture-presence" role="status">
            <span className="relay-capture-presence-mark" aria-hidden="true">
              <MonitorSmartphone />
            </span>
            <h2>{issue ? "The live view needs attention" : "Connecting to the target"}</h2>
            <p>{issue ?? "The app will appear here as soon as the target is ready."}</p>
          </div>
        ) : null}
        {busy ? <span className="relay-live-target-busy">Recording interaction…</span> : null}
      </div>

      <div className="relay-live-target-tools">
        <div>
          <strong>{targetTitle}</strong>
          <span>{targetDetail}</span>
        </div>
        <form onSubmit={typeText}>
          <label className="relay-visually-hidden" htmlFor="live-target-text">
            Text to type into the focused target field
          </label>
          <input
            id="live-target-text"
            className="relay-input"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="Type into the target"
            disabled={!streaming || busy}
            autoComplete="off"
            maxLength={16_384}
          />
          <Button type="submit" variant="secondary" disabled={!text || !streaming || busy}>
            Type
          </Button>
        </form>
      </div>
      <p id="live-target-help" className="relay-live-target-help">
        Click, drag, scroll, or type here. Relay records each supported interaction in this Test.
      </p>
    </div>
  );
}
