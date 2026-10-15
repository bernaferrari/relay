/** @jsxImportSource react */
import { useEffect, useRef, useState, type CSSProperties, type MouseEventHandler } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import type { BrowserRect } from "../data/browser-workspace-layout";
import {
  BrowserWorkspaceHeader,
  type BrowserWorkspaceHeaderProps,
} from "./browser-workspace-header";
import { BrowserAddressBar } from "../components/browser-address-bar";
import type { BrowserTile } from "../data/browser-workspace";
import type {
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetSnapshot,
} from "../data/live-target-session";
import { BrowserWorkspaceTileActions } from "./browser-workspace-tile-actions";
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
  controls,
}: {
  controls: Omit<BrowserWorkspaceHeaderProps, "id" | "name" | "leading" | "actions">;
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
          "--tile-left": `calc(${rect.x}% + ${(12 * rect.x) / 100}px)`,
          "--tile-top": `calc(${rect.y}% + ${(12 * rect.y) / 100}px)`,
          "--tile-width": `calc(${rect.width}% - ${12 * (1 - rect.width / 100)}px)`,
          "--tile-height": `calc(${rect.height}% - ${12 * (1 - rect.height / 100)}px)`,
        } as CSSProperties
      }
      data-browser-tile={tile.id}
      data-dragging={dragging || undefined}
      aria-label={`${tile.name} · ${tile.accountName}`}
      hidden={hidden}
      className={`${className} ${hidden ? "hidden" : "flex"} @container min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background data-[workspace-moving]:z-20 data-[dragging]:pointer-events-none data-[dragging]:z-40 data-[dragging]:opacity-90 data-[dragging]:shadow-2xl absolute top-(--tile-top) left-(--tile-left) h-(--tile-height) w-(--tile-width)`}
    >
      <BrowserWorkspaceHeader
        {...controls}
        id={tile.id}
        name={tile.name}
        leading={
          <div
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={`${tile.name} · ${tile.accountName}`}
          >
            {tile.name}{" "}
            {!["New profile", "Current session", tile.name].includes(tile.accountName) ? (
              <span className="font-normal text-muted-foreground">· {tile.accountName}</span>
            ) : null}
          </div>
        }
        actions={
          <BrowserWorkspaceTileActions
            tile={tile}
            focused={focused}
            ready={!busy && snapshot?.status === "streaming"}
            onFocus={onFocus}
            onRemove={onRemove}
          />
        }
      />
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
