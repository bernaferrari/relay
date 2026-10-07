import { Button } from "@relay/ui-react/components/button";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import type { DeviceProductService } from "../data/device-product-service";
import type { createRecordingSetupAdmission } from "../data/recording-setup-admission";
import type { ProductRecordingState } from "../data/recording-product-service";
import { RecordingProblem } from "./recording-shared";

/** Explicit repair keeps the recording admission held until discovery settles. */
export function useNewTestDeviceRecovery({
  deviceService,
  targetId,
  admission,
  refetchTargets,
  onRecovered,
  onError,
}: {
  deviceService: DeviceProductService;
  targetId: string;
  admission: ReturnType<typeof createRecordingSetupAdmission>;
  refetchTargets(): Promise<unknown>;
  onRecovered(): void;
  onError(): void;
}) {
  const current = useRef({ deviceService, targetId });
  current.current = { deviceService, targetId };
  const mutation = useMutation({
    mutationFn: (input: { service: DeviceProductService; serial: string }) =>
      input.service.recover(input.serial, "connect"),
    onSuccess: async (_result, input) => {
      if (
        current.current.deviceService !== input.service ||
        current.current.targetId !== input.serial
      )
        return;
      await refetchTargets();
      if (
        current.current.deviceService === input.service &&
        current.current.targetId === input.serial
      )
        onRecovered();
    },
    onError: (_error, input) => {
      if (
        current.current.deviceService === input.service &&
        current.current.targetId === input.serial
      )
        onError();
    },
  });
  return {
    isPending: mutation.isPending,
    admission: { busy: mutation.isPending || !admission.mayEdit(), mayEdit: admission.mayEdit },
    canReconnect(recovery: ProductRecordingState["recovery"], kind?: "device" | "browser") {
      return Boolean(
        targetId &&
        kind === "device" &&
        recovery?.sourceCode === "native-recording-target-not-ready",
      );
    },
    mutate(serial: string) {
      if (!serial || serial !== targetId) return;
      void admission
        .run(() => mutation.mutateAsync({ service: deviceService, serial }))
        .catch(() => undefined);
    },
  };
}

function NewTestDeviceRecoveryButton({
  pending,
  onReconnect,
}: {
  pending: boolean;
  onReconnect(): void;
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onReconnect}>
      {pending ? "Reconnecting…" : "Reconnect device"}
    </Button>
  );
}

type SetupQuery = {
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  refetch(): Promise<unknown>;
};

/** Readiness repair stays beside the loaded setup instead of replacing it. */
export function NewTestSetupProblem({
  open,
  apps,
  targets,
  path,
  detailed,
  onReconnect,
  reconnecting,
}: {
  open: boolean;
  apps: SetupQuery;
  targets: SetupQuery & { data?: Pick<ProductRecordingState, "recovery"> };
  path: SetupQuery;
  detailed: boolean;
  onReconnect?: () => void;
  reconnecting: boolean;
}) {
  const targetError = detailed ? targets.error : undefined;
  const targetRecovery = detailed ? targets.data?.recovery : undefined;
  return (
    <RecordingProblem
      layout={open ? "compact" : "centered"}
      className={open ? undefined : "!mt-0 !max-w-none min-h-0 w-full flex-1"}
      error={apps.error ?? targetError ?? path.error}
      recovery={targetRecovery}
      action={
        onReconnect ? (
          <NewTestDeviceRecoveryButton pending={reconnecting} onReconnect={onReconnect} />
        ) : undefined
      }
      onRetry={() => {
        if (apps.isError) void apps.refetch();
        if (targetError || targetRecovery) void targets.refetch();
        if (path.isError) void path.refetch();
      }}
      retrying={apps.isFetching || (detailed && targets.isFetching) || path.isFetching}
    />
  );
}
