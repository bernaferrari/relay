import type { AppMapObserved } from "@relay/protocol";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

/** Before anyone has opened a map, the last week of additions reads as new. */
const FIRST_VISIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Screens runs added to this map since this person last opened it. Opening
 * the map counts as seeing them, so the "new" mark is gone next time.
 */
export function useScreensNewSinceVisit(
  appId: string,
  observed: AppMapObserved | undefined,
): ReadonlySet<string> {
  const { platform } = useRouteContext({ from: "__root__" });
  const key = `relay:map-seen:${appId}`;
  const [since, setSince] = useState<number>();
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(platform.storage.get(key)).then((stored) => {
      if (cancelled) return;
      const previous = Number(stored);
      setSince(
        Number.isFinite(previous) && previous > 0 ? previous : Date.now() - FIRST_VISIT_WINDOW_MS,
      );
      void Promise.resolve(platform.storage.set(key, String(Date.now())));
    });
    return () => {
      cancelled = true;
    };
  }, [key, platform]);
  return useMemo(
    () =>
      new Set(
        since === undefined
          ? []
          : (observed?.screens ?? []).flatMap((screen) =>
              screen.screenId && screen.addedByRuns && (screen.addedAt ?? 0) > since
                ? [screen.screenId]
                : [],
            ),
      ),
    [observed, since],
  );
}
