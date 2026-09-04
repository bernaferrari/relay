/** @jsxImportSource react */
import { Badge, Button } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import type { LiveTargetSession, LiveTargetStatus } from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, errorMessage } from "./recording-shared";

const routeApi = getRouteApi("/devices/$deviceId");

function productPlatform(device: ProductDevice): string {
  if (device.platform === "ios") return "Apple device";
  if (device.platform === "android") return "Android device";
  return "Managed browser";
}

function statusCopy(device: ProductDevice): { label: string; title: string; detail: string } {
  if (device.status === "needs-attention") {
    return {
      label: "Needs attention",
      title: "One step before this device is ready",
      detail: device.recovery ?? "Reconnect this device, then ask Relay to check it again.",
    };
  }
  if (device.status === "virtual") {
    return {
      label: "Virtual device",
      title: "Available when a Test needs it",
      detail:
        "Relay checks this virtual device again when you start a Test, so the final Run uses current availability.",
    };
  }
  return {
    label: "Ready",
    title: "Ready for a Test",
    detail:
      "Relay reported this device ready. Its connection and evidence capabilities are checked again when a Run starts.",
  };
}

export function DevicePage() {
  const { deviceId } = routeApi.useParams();
  const { deviceService, productService, queryClient } = useRouteContext({ from: "__root__" });
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const device = useQuery({
    queryKey: deviceQueryKeys.device(deviceId),
    queryFn: () => deviceService.get(deviceId),
    staleTime: 5_000,
  });
  const recover = useMutation({
    mutationFn: async () => {
      if (!device.data) throw new TypeError("This device is no longer available.");
      return deviceService.recover(device.data.serial, "connect");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.devices });
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.device(deviceId) });
    },
  });
  const target = useQuery({
    queryKey: ["devices", deviceId, "live-target"],
    queryFn: async () => {
      const connected = await productService.connect();
      if (connected.recovery) return undefined;
      const options = await productService.presentTargets(connected.targets);
      return options.find(
        (option) => option.targetId === device.data?.serial || option.targetId === device.data?.id,
      );
    },
    enabled: Boolean(device.data && device.data.status !== "needs-attention"),
    staleTime: 5_000,
  });
  const presentation = device.data ? statusCopy(device.data) : undefined;

  useEffect(() => {
    const createPreview = productService.previewTarget;
    if (!target.data || !canvas.current || !createPreview) return;
    let disposed = false;
    let unmount: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mounted: LiveTargetSession | undefined;
    setLiveIssue(undefined);
    setLiveStatus("connecting");
    void createPreview(target.data)
      .then((next) => {
        if (disposed || !canvas.current) return next.close();
        mounted = next;
        session.current = next;
        unsubscribe = next.subscribe((state) => {
          setLiveStatus(state.status);
          setLiveIssue(state.issue ? friendlyLiveIssue(state.issue) : undefined);
        });
        unmount = next.mount(canvas.current);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLiveStatus("degraded");
          setLiveIssue(friendlyLiveIssue(errorMessage(error)));
        }
      });
    return () => {
      disposed = true;
      unmount?.();
      unsubscribe?.();
      if (session.current === mounted) session.current = undefined;
      mounted?.close();
    };
  }, [liveAttempt, productService, target.data]);

  async function send(input: Parameters<LiveTargetSession["input"]>[0]) {
    if (!session.current) {
      setLiveIssue("The live view is still connecting.");
      return;
    }
    setLiveBusy(true);
    setLiveIssue(undefined);
    try {
      await session.current.input(input);
    } catch (error) {
      setLiveIssue(friendlyLiveIssue(errorMessage(error)));
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <section className="relay-page relay-device-page">
      <Breadcrumbs
        items={[{ label: "Devices", to: "/devices" }, { label: device.data?.name ?? "Device" }]}
      />
      <header className="relay-page-header relay-device-detail-header">
        <div>
          <p className="relay-eyebrow">Device</p>
          <h1>{device.data?.name ?? "Device"}</h1>
          {device.data ? (
            <p className="relay-page-description">
              {[productPlatform(device.data), device.data.osVersion, device.data.kind]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        {device.data?.status === "needs-attention" ? (
          <Button variant="primary" onClick={() => recover.mutate()} disabled={recover.isPending}>
            {recover.isPending ? "Reconnecting…" : "Reconnect device"}
          </Button>
        ) : device.data ? (
          <Button
            variant="primary"
            render={
              <Link
                to="/tests/new"
                search={{ target: target.data?.targetId ?? device.data.serial }}
              />
            }
          >
            Use for a new Test
          </Button>
        ) : null}
      </header>

      {device.isPending ? <PageLoading label="Checking this device…" /> : null}

      {device.isError ? (
        <EmptyState
          title="Relay could not check this device"
          detail="The connection may have changed. Check again without losing your place."
          tone="notice"
          action={
            <Button variant="primary" onClick={() => void device.refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {!device.isPending && !device.isError && !device.data ? (
        <EmptyState
          title="This device is no longer available"
          detail="It may have been disconnected or renamed. Return to Devices to see what Relay can use now."
          action={
            <Button variant="primary" render={<Link to="/devices" />}>
              View Devices
            </Button>
          }
        />
      ) : null}

      {device.data && presentation ? (
        <div className="relay-device-detail-grid">
          <section className="relay-device-health" aria-labelledby="device-health-title">
            <Badge variant={device.data.status === "needs-attention" ? "warning" : "success"}>
              {presentation.label}
            </Badge>
            <h2 id="device-health-title">{presentation.title}</h2>
            <p>{presentation.detail}</p>
            {recover.error ? (
              <p className="relay-settings-error" role="alert">
                Reconnection did not finish. Keep the device awake and connected, then try again.
              </p>
            ) : null}
            {recover.data ? (
              <div className="relay-device-recovery-result" aria-live="polite">
                <strong>
                  {recover.data.ready ? "Device is ready" : "Device still needs attention"}
                </strong>
                <p>{recover.data.summary}</p>
              </div>
            ) : null}
          </section>

          <section className="relay-device-facts" aria-labelledby="device-details-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">At a glance</p>
                <h2 id="device-details-title">Device details</h2>
              </div>
            </div>
            <dl>
              <div>
                <dt>Platform</dt>
                <dd>{productPlatform(device.data)}</dd>
              </div>
              <div>
                <dt>Software</dt>
                <dd>{device.data.osVersion ?? "Reported by the device when available"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{device.data.kind ?? "Device"}</dd>
              </div>
            </dl>
          </section>

          {device.data.status !== "needs-attention" ? (
            <section className="relay-device-live" aria-labelledby="device-live-title">
              <div className="relay-device-live-heading">
                <div>
                  <p className="relay-section-label">Live session</p>
                  <h2 id="device-live-title">Position the device before recording</h2>
                  <p>
                    Interact freely here. Nothing is recorded until you explicitly start a Test.
                  </p>
                </div>
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setLiveAttempt((value) => value + 1)}
                >
                  <RotateCcw aria-hidden="true" /> Reconnect
                </Button>
              </div>
              {target.isPending ? <PageLoading label="Opening the live device…" /> : null}
              {target.data ? (
                <LiveTargetCanvas
                  canvasRef={canvas}
                  status={liveStatus}
                  issue={liveIssue}
                  busy={liveBusy}
                  targetTitle={target.data.name}
                  targetDetail={target.data.detail}
                  send={send}
                  recording={false}
                />
              ) : !target.isPending ? (
                <EmptyState
                  title="Live control is not available yet"
                  detail="Keep the device awake and connected, then reconnect. You can still use it when Relay reports it ready."
                />
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function friendlyLiveIssue(message: string): string {
  if (/locked|unlock|view only/iu.test(message)) return "Unlock the device, then reconnect.";
  if (/packet|transport|codec|decode|base64|operation|targetid/iu.test(message)) {
    return "Relay could not show the live view. Keep the device connected, then reconnect.";
  }
  return message;
}
