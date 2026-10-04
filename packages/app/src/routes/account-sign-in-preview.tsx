/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { RotateCcw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BrowserAddressBar } from "../components/browser-address-bar";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
import type { RecordingProductService } from "../data/recording-product-service";
import type { ProductTargetOption } from "../data/target-presentation";
import { currentAccessibilityInspection } from "../data/talkback-overlay";
import type { PlatformStorage } from "../platform/types";
import { LiveTargetCanvas } from "./live-target-canvas";
import { RecordingInputRecovery } from "./recording-input-recovery";
import { TalkBackOverlay } from "./talkback-review-panel";
import { useNewTestPreviewInput } from "./use-new-test-preview-input";
import { useNewTestPreviewSession } from "./use-new-test-preview-session";

export type AccountSignInSession = Awaited<ReturnType<BrowserSpacesProductService["openSpace"]>> & {
  sessionId: string;
};

/** Attach to the isolated sign-in session; input and uncertainty remain owned by Relay. */
export function AccountSignInPreview({
  opened,
  service,
  storage,
  disabled,
  onReady,
}: {
  opened: AccountSignInSession;
  service: RecordingProductService;
  storage: PlatformStorage;
  disabled: boolean;
  onReady(ready: boolean): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Omit<LiveTargetSnapshot, "target">>({
    status: "connecting",
  });
  const target = useMemo<ProductTargetOption>(
    () => ({
      kind: "browser",
      platform: "browser",
      targetId: opened.targetId,
      name: opened.name,
      detail: opened.url,
    }),
    [opened],
  );
  const previewService = useMemo(
    () => ({
      previewTarget: service.previewTarget
        ? (selected: Parameters<NonNullable<RecordingProductService["previewTarget"]>>[0]) =>
            service.previewTarget!(selected, {
              sessionId: opened.sessionId,
              ...(opened.configurationDigest
                ? { configurationDigest: opened.configurationDigest }
                : {}),
            })
        : undefined,
    }),
    [service, opened],
  );
  useNewTestPreviewSession({
    target,
    canvas,
    sessionRef: session,
    service: previewService,
    attempt,
    mode: "account-sign-in",
    enabled: true,
    onSnapshot(next) {
      session.current?.setAccessibilityInspection?.(true);
      setSnapshot(next);
    },
  });
  const input = useNewTestPreviewInput({ target, session, storage, service, attempt });
  const currentFrame =
    snapshot.status === "streaming" &&
    Boolean(snapshot.frameSequence) &&
    snapshot.browserContext?.sessionId === opened.sessionId;
  const ready = currentFrame && !input.busy && !disabled;
  useLayoutEffect(() => {
    onReady(ready);
  }, [ready, onReady]);
  const inspection = currentAccessibilityInspection(snapshot.accessibility);
  const reconnect = () => setAttempt((value) => value + 1);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-muted/30"
      aria-label="Sign-in browser"
    >
      <BrowserAddressBar
        url={snapshot.browserContext?.pageUrl ?? opened.url}
        disabled={!ready || disabled}
        send={input.send}
      />
      <div className="min-h-0 flex-1">
        <LiveTargetCanvas
          canvasRef={canvas}
          status={snapshot.status}
          issue={input.issue ?? snapshot.issue}
          busy={!ready || disabled}
          targetTitle={opened.name}
          targetDetail={opened.url}
          browserContext={snapshot.browserContext}
          targetPlatform="browser"
          send={input.send}
          recording={false}
          showTargetDetails={false}
          helpText=""
          overlay={
            currentFrame ? (
              <TalkBackOverlay
                canvasRef={canvas}
                items={inspection.overlayItems}
                bounds={inspection.bounds}
                mode="hover"
              />
            ) : null
          }
          recoveryAction={
            <Button size="sm" onClick={reconnect} disabled={disabled}>
              <RotateCcw aria-hidden="true" /> Reconnect
            </Button>
          }
        />
      </div>
      {input.failure ? (
        <RecordingInputRecovery
          issue="Relay couldn’t confirm the last interaction. Check the website before continuing."
          failure={input.failure}
          busy={input.recoveryBusy || disabled}
          onObserve={input.observe}
        />
      ) : null}
      {input.issue && !input.failure && snapshot.status === "streaming" ? (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {input.issue}
        </p>
      ) : null}
    </section>
  );
}
