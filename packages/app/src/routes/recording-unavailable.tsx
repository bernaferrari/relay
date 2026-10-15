/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useNavigate } from "@tanstack/react-router";
import type { AuthoringTarget } from "@relay/protocol";
import type { ProductRecordingState } from "@relay/product/recording-journey";

/** Failed preparation is terminal, but its cause and recovery still belong on screen. */
export function RecordingUnavailable({
  recovery,
  failedTarget,
  refreshing,
  onRefresh,
}: {
  recovery?: ProductRecordingState["recovery"];
  failedTarget?: AuthoringTarget;
  refreshing: boolean;
  onRefresh(): void;
}) {
  const navigate = useNavigate();
  return (
    <div className="m-auto grid w-full max-w-sm justify-items-center gap-3 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold">{recovery?.title ?? "Relay session unavailable"}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {recovery?.detail ?? "Reconnect to reopen your recording and saved steps."}
      </p>
      <div className="flex gap-2">
        {failedTarget?.kind === "device" ? (
          <Button
            onClick={() =>
              void navigate({
                to: "/devices/$deviceId",
                params: { deviceId: failedTarget.targetId },
              })
            }
          >
            Open device
          </Button>
        ) : (
          <Button disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Reconnecting…" : "Reconnect"}
          </Button>
        )}
        <Button variant="outline" onClick={() => void navigate({ to: "/tests" })}>
          Back to tests
        </Button>
      </div>
    </div>
  );
}
