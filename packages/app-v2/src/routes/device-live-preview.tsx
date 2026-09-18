/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { RotateCcw } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { BrowserAddressBar } from "../components/browser-address-bar";
import { RecoveryState } from "../components/product-patterns";
import type {
  LiveTargetBrowserContext,
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { TalkBackModeSelect, TalkBackOverlay, useTalkBackReview } from "./talkback-review-panel";

export function DeviceLivePreview({
  platform,
  canvas,
  target,
  browserContext,
  status,
  issue,
  busy,
  reconnect,
  send,
  pending,
  reconnecting,
  issueAction,
  talkBack,
}: {
  platform: string;
  canvas: RefObject<HTMLCanvasElement | null>;
  target?: { name: string; detail: string };
  browserContext?: LiveTargetBrowserContext;
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
  reconnect: () => void;
  send: (input: Parameters<LiveTargetSession["input"]>[0]) => Promise<boolean>;
  pending: boolean;
  reconnecting: boolean;
  issueAction?: ReactNode;
  talkBack: ReturnType<typeof useTalkBackReview>;
}) {
  if (!target && !pending) {
    return (
      <RecoveryState
        layout="centered"
        className="min-h-64"
        title="Live view is not connected"
        detail={
          platform === "browser"
            ? "Reconnect to bring this browser back into Relay."
            : "Keep the device awake and connected, then reconnect."
        }
        action={
          <Button size="sm" onClick={reconnect}>
            <RotateCcw aria-hidden="true" /> Reconnect
          </Button>
        }
      />
    );
  }
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col rounded-xl bg-muted/30 max-[900px]:h-[65dvh]"
      aria-labelledby="device-live-title"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 px-3 py-2">
        <h2 className="text-sm font-medium" id="device-live-title">
          Live preview
        </h2>
        {status === "streaming" || (status === "idle" && !pending) ? (
          <Button size="sm" variant="ghost" onClick={reconnect} disabled={reconnecting}>
            <RotateCcw aria-hidden="true" /> Reconnect
          </Button>
        ) : null}
      </div>
      {platform === "browser" ? (
        <BrowserAddressBar
          url={browserContext?.pageUrl}
          disabled={busy || status !== "streaming"}
          send={send}
        />
      ) : null}
      <div className="min-h-0 flex-1">
        <LiveTargetCanvas
          canvasRef={canvas}
          status={pending ? "connecting" : status}
          issue={issue}
          issueAction={issueAction}
          busy={busy}
          targetTitle={target?.name ?? "Device"}
          targetDetail={target?.detail ?? ""}
          browserContext={browserContext}
          send={send}
          recording={false}
          showTargetDetails={false}
          targetPlatform={platform}
          recoveryAction={
            <Button size="sm" onClick={reconnect} disabled={reconnecting}>
              <RotateCcw aria-hidden="true" /> {reconnecting ? "Reconnecting…" : "Reconnect"}
            </Button>
          }
          helpText=""
          overlay={
            talkBack.on && talkBack.mode !== "off" ? (
              <TalkBackOverlay
                canvasRef={canvas}
                items={talkBack.inspection.overlayItems}
                bounds={talkBack.inspection.bounds}
                mode={talkBack.mode}
              />
            ) : null
          }
          toolbar={
            <div className="flex items-center gap-2">
              <TalkBackModeSelect
                mode={talkBack.mode}
                loading={talkBack.loading}
                onModeChange={(mode) => talkBack.setMode(mode)}
              />
              {talkBack.on && platform !== "browser" ? (
                <span
                  className="text-xs text-muted-foreground"
                  role="status"
                  title={talkBack.issue ?? talkBack.inspection.message}
                >
                  {talkBack.loading
                    ? "Reading labels…"
                    : talkBack.issue || talkBack.inspection.message
                      ? "Labels unavailable"
                      : null}
                </span>
              ) : null}
            </div>
          }
        />
      </div>
    </section>
  );
}
