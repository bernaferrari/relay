/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import { PageLoading } from "./recording-shared";

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
  const { deviceService, queryClient } = useRouteContext({ from: "__root__" });
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
  const presentation = device.data ? statusCopy(device.data) : undefined;

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
          <Link className="relay-button relay-button--primary relay-button--medium" to="/tests/new">
            Use for a new Test
          </Link>
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
            <Link className="relay-button relay-button--primary relay-button--medium" to="/devices">
              View Devices
            </Link>
          }
        />
      ) : null}

      {device.data && presentation ? (
        <div className="relay-device-detail-grid">
          <section className="relay-device-health" aria-labelledby="device-health-title">
            <span className={`relay-device-status relay-device-status--${device.data.status}`}>
              <span aria-hidden="true" />
              {presentation.label}
            </span>
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
        </div>
      ) : null}
    </section>
  );
}
