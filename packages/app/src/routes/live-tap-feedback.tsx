/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { containedFrameRect } from "../data/live-frame-geometry";

export type TapFeedback = {
  x: number;
  y: number;
  id: number;
  state: "sending" | "sent" | "unconfirmed";
};
export const TAP_FEEDBACK_VISIBLE_MS = 420;
const iconMotion =
  "absolute inset-0 grid place-items-center transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none";

/** One continuous marker, anchored to the drawn pixels throughout delivery and resize. */
export function LiveTapFeedback({
  canvasRef,
  tap,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  tap: TapFeedback;
}) {
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const [pendingVisible, setPendingVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (tap.state !== "sending") {
      const timer = setTimeout(() => setExiting(true), TAP_FEEDBACK_VISIBLE_MS - 150);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setPendingVisible(true), 180);
    return () => clearTimeout(timer);
  }, [tap.state]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current,
      stage = canvas?.parentElement;
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
  if (!position) return null;
  const sending = tap.state === "sending";
  return (
    <div
      data-slot="live-tap-feedback"
      data-pending={sending}
      data-state={tap.state}
      data-exiting={exiting || undefined}
      className="pointer-events-none absolute top-(--tap-y) left-(--tap-x) z-20 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center opacity-100 transition-[opacity,scale] duration-150 ease-out data-[exiting]:scale-95 data-[exiting]:opacity-0 motion-reduce:transition-none"
      style={{ "--tap-x": `${position.x}px`, "--tap-y": `${position.y}px` } as CSSProperties}
    >
      <span
        data-slot="live-tap-ripple"
        className="absolute inset-0 animate-live-tap-ripple rounded-full border border-primary/50 bg-primary/10 motion-reduce:hidden"
        aria-hidden="true"
      />
      <span
        data-slot="live-tap-indicator"
        className="relative grid size-7 place-items-center rounded-full border border-border bg-background/90 shadow-sm"
        aria-hidden="true"
      >
        <span
          className={`${iconMotion} ${sending && !pendingVisible ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
        >
          <span className="size-1.5 rounded-full bg-primary" />
        </span>
        <span
          data-slot="live-tap-pending"
          data-visible={sending && pendingVisible}
          className={`${iconMotion} text-primary ${sending && pendingVisible ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
        >
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        </span>
        <span
          className={`${iconMotion} text-success ${tap.state === "sent" ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
        >
          <Check className="size-4" strokeWidth={2.5} />
        </span>
        <span
          className={`${iconMotion} text-warning ${tap.state === "unconfirmed" ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
        >
          <CircleAlert className="size-4" />
        </span>
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {sending ? "Sending tap…" : tap.state === "sent" ? "Tap sent" : "Tap not confirmed"}
      </span>
    </div>
  );
}
