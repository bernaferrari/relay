/** @jsxImportSource react */
import { useEffect, useRef, useState, type CSSProperties, type MouseEventHandler } from "react";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { Circle, Maximize2, Minimize2, X } from "lucide-react";
import type { BrowserRect } from "../data/browser-workspace-layout";
import { BrowserAddressBar } from "../components/browser-address-bar";
import type { BrowserTile } from "../data/browser-workspace";
import type {
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetSnapshot,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { errorMessage } from "./recording-shared";

export function BrowserWorkspaceTile({
  tile,
  focused,
  hidden,
  onFocus,
  onRemove,
  className = "",
  rect,
  dragging,
  grip,
}: {
  grip: import("react").ReactNode;
  className?: string;
  rect: BrowserRect;
  dragging?: boolean;
  tile: BrowserTile;
  focused: boolean;
  hidden: boolean;
  onFocus: MouseEventHandler<HTMLButtonElement>;
  onRemove(): void;
}) {
  const { productService } = useRouteContext({ from: "__root__" });
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<LiveTargetSnapshot>();
  const [issue, setIssue] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    let disposed = false;
    let live: LiveTargetSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let unmount: (() => void) | undefined;
    setSnapshot(undefined);
    setIssue(undefined);
    const open = async () => {
      if (!productService.previewTarget) throw new Error("Live browser control is unavailable.");
      const next = await productService.previewTarget(
        { kind: "browser", platform: "browser", targetId: tile.browserId },
        tile.identity,
      );
      if (disposed) return next.close();
      live = next;
      session.current = next;
      setSnapshot(next.snapshot());
      unsubscribe = next.subscribe((value) => {
        if (!disposed)
          setSnapshot((current) =>
            current?.status === value.status &&
            current.issue === value.issue &&
            current.browserContext === value.browserContext
              ? current
              : value,
          );
      });
      if (canvas.current) unmount = next.mount(canvas.current);
    };
    void open().catch((error: unknown) => {
      if (!disposed) setIssue(errorMessage(error));
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      unmount?.();
      live?.close();
      if (session.current === live) session.current = undefined;
    };
  }, [productService, tile.browserId, tile.identity, attempt]);

  async function send(input: LiveTargetInput) {
    const live = session.current;
    if (!live || pending.current) return false;
    pending.current = true;
    setBusy(true);
    setIssue(undefined);
    try {
      await live.input(input);
      return true;
    } catch (error) {
      setIssue(errorMessage(error));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      style={
        {
          "--tile-left": `calc(${rect.x}% + ${rect.x > 0.01 ? 6 : 0}px)`,
          "--tile-top": `calc(${rect.y}% + ${rect.y > 0.01 ? 6 : 0}px)`,
          "--tile-width": `calc(${rect.width}% - ${(rect.x > 0.01 ? 6 : 0) + (rect.x + rect.width < 99.99 ? 6 : 0)}px)`,
          "--tile-height": `calc(${rect.height}% - ${(rect.y > 0.01 ? 6 : 0) + (rect.y + rect.height < 99.99 ? 6 : 0)}px)`,
        } as CSSProperties
      }
      data-browser-tile={tile.id}
      data-dragging={dragging || undefined}
      aria-label={`${tile.name} · ${tile.accountName}`}
      hidden={hidden}
      className={`${className} ${hidden ? "hidden" : "flex"} @container min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background data-[workspace-moving]:z-20 data-[dragging]:pointer-events-none data-[dragging]:z-40 data-[dragging]:opacity-90 data-[dragging]:shadow-2xl absolute top-(--tile-top) left-(--tile-left) h-(--tile-height) w-(--tile-width)`}
    >
      <header className="grid min-h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 border-b border-border px-3">
        <div
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={`${tile.name} · ${tile.accountName}`}
        >
          {tile.name}{" "}
          {!["New profile", "Current session", tile.name].includes(tile.accountName) ? (
            <span className="font-normal text-muted-foreground">· {tile.accountName}</span>
          ) : null}
        </div>
        {grip}
        <div className="flex items-center justify-end gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 px-2 text-xs"
            nativeButton={false}
            aria-label={`Record ${tile.name}`}
            disabled={busy || snapshot?.status !== "streaming"}
            render={
              <Link
                to="/tests/new"
                search={{
                  target: tile.browserId,
                  ...(tile.identity?.authenticationFixtureId
                    ? { account: tile.identity.authenticationFixtureId }
                    : tile.identity?.signedOut
                      ? { account: "" }
                      : {}),
                }}
              />
            }
          >
            <Circle className="size-2 fill-destructive text-destructive" aria-hidden="true" />
            <span className="@max-[380px]:hidden">Record</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={focused ? `Restore ${tile.name}` : `Expand ${tile.name}`}
            onClick={onFocus}
          >
            {focused ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Remove ${tile.name} from workspace`}
            onClick={onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </header>
      <BrowserAddressBar
        url={snapshot?.browserContext?.pageUrl}
        disabled={busy || snapshot?.status !== "streaming"}
        send={send}
      />
      <div className="min-h-0 flex-1">
        <LiveTargetCanvas
          canvasRef={canvas}
          status={issue && !snapshot ? "degraded" : (snapshot?.status ?? "connecting")}
          issue={issue ?? snapshot?.issue}
          busy={busy}
          send={send}
          targetTitle={tile.name}
          targetDetail=""
          browserContext={snapshot?.browserContext}
          targetPlatform="browser"
          browserFit="contain"
          inputScope={tile.id}
          recording={false}
          showTargetDetails={false}
          helpText=""
          recoveryAction={
            <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              Reconnect
            </Button>
          }
        />
      </div>
    </section>
  );
}
