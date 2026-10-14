import type { RecordingProductService } from "../data/recording-product-service";
import { deviceSummaryLine } from "../data/device-label";
import { useQuery } from "@tanstack/react-query";
import {
  deviceDiscoveryScope,
  deviceLivePreviewAvailable,
  type DeviceProductService,
  type ProductDevice,
} from "../data/device-product-service";

export function useDeviceControlCheck({
  service,
  device,
  connected,
  attempt,
}: {
  service: DeviceProductService;
  device?: ProductDevice;
  connected: boolean;
  attempt: number;
}) {
  const required = Boolean(service.checkControl && device && device.platform !== "browser");
  const check = useQuery({
    queryKey: ["device-control", device?.serial, attempt],
    queryFn: () => service.checkControl!(device!.serial, device!.platform as "android" | "ios"),
    enabled: required && connected,
    staleTime: Infinity,
    retry: false,
  });
  return required
    ? {
        ready: check.isSuccess && !check.isFetching && check.data?.ready === true,
        checking: check.isFetching || (check.isPending && !check.isError),
        message: check.data?.message,
        recoverable: check.data?.recoverable,
        recheck: () => {
          return check
            .refetch()
            .then((result) => result.isSuccess && result.data?.ready === true)
            .catch(() => false);
        },
      }
    : undefined;
}

export function useIOSInstalledApps(
  service: DeviceProductService,
  device: ProductDevice | undefined,
  open: boolean,
) {
  const apps = useQuery({
    queryKey: ["installed-apps", device?.serial],
    queryFn: () => service.listInstalledApps!(device!.serial),
    enabled: Boolean(open && device?.platform === "ios" && service.listInstalledApps),
    staleTime: 30_000,
    retry: false,
  });
  return service.listInstalledApps
    ? {
        apps: apps.data,
        loading: apps.isPending,
        error: apps.isError,
        refresh: () => {
          void apps.refetch();
        },
      }
    : undefined;
}

export function useDevicePreviewTarget(
  deviceId: string,
  device: ProductDevice | undefined,
  service: RecordingProductService,
) {
  return useQuery({
    queryKey: ["devices", deviceId, "live-target"],
    queryFn: async () => {
      const selectedDevice = device!;
      if (selectedDevice.platform === "browser") {
        return {
          kind: "browser" as const,
          platform: "browser" as const,
          targetId: selectedDevice.id,
          name: selectedDevice.name,
          detail: "Managed browser",
        };
      }
      if (selectedDevice.status === "needs-attention")
        return {
          kind: "device" as const,
          platform: selectedDevice.platform,
          targetId: selectedDevice.serial,
          name: selectedDevice.name,
          detail: deviceSummaryLine(selectedDevice),
        };
      const scope = deviceDiscoveryScope(selectedDevice);
      const connected = await service.connect(scope);
      if (connected.recovery) return null;
      const options = await service.presentTargets(connected.targets, scope);
      return (
        options.find(
          (option) =>
            option.targetId === selectedDevice.serial || option.targetId === selectedDevice.id,
        ) ?? null
      );
    },
    enabled: deviceLivePreviewAvailable(device),
    staleTime: 5_000,
  });
}
