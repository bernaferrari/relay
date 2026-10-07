import { useEffect, useRef, useState } from "react";
import type { AuthoringTarget } from "@relay/protocol";
import type { DeviceProductService } from "../data/device-product-service";
import { takeNativeAppLaunch } from "../data/native-app-launch-context";

/** Keep the replay baseline separate from whether setup still needs to open
 * it. An acknowledged device handoff avoids another launch; fresh preview and
 * canonical recording evidence still determine what is on screen. */
export function useNativeAppStartContext({
  service,
  target,
  targetId,
  requestedOriginApplication,
}: {
  service: DeviceProductService;
  target?: AuthoringTarget;
  targetId: string;
  requestedOriginApplication?: string;
}) {
  const [originApplication, setOriginApplication] = useState(requestedOriginApplication ?? "");
  const [opened, setOpened] = useState<{
    service: DeviceProductService;
    kind: AuthoringTarget["kind"];
    platform: AuthoringTarget["platform"];
    serial: string;
    application: string;
  }>();
  function markOpened(application: string) {
    setOpened(
      application && target && target.targetId === targetId
        ? {
            service,
            kind: target.kind,
            platform: target.platform,
            serial: target.targetId,
            application,
          }
        : undefined,
    );
  }
  // Invalidate during render, before effects can run, so an old connection or
  // target can never enable Start on the replacement identity.
  const openedApplication =
    opened &&
    opened.service === service &&
    opened.kind === target?.kind &&
    opened.platform === target?.platform &&
    opened.serial === target?.targetId &&
    opened.serial === targetId &&
    opened.application === originApplication
      ? opened.application
      : "";
  const previousTargetId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousTargetId.current && previousTargetId.current !== targetId) {
      setOriginApplication("");
      setOpened(undefined);
    }
    previousTargetId.current = targetId;
  }, [targetId]);
  useEffect(() => {
    if (!target || target.targetId !== targetId || !originApplication) {
      setOpened(undefined);
      return;
    }
    const context = takeNativeAppLaunch(service, target, originApplication);
    if (context)
      setOpened({
        service,
        kind: target.kind,
        platform: target.platform,
        serial: target.targetId,
        application: context.originApplication,
      });
    else
      setOpened((previous) =>
        previous?.service === service &&
        previous.kind === target.kind &&
        previous.platform === target.platform &&
        previous.serial === targetId &&
        previous.application === originApplication
          ? previous
          : undefined,
      );
  }, [service, target?.kind, target?.platform, target?.targetId, targetId, originApplication]);
  return { originApplication, setOriginApplication, openedApplication, markOpened };
}
