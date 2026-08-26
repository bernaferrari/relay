import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { DiscoveryExplorationTimeline } from "@relay/protocol";
import { useServer } from "../context/server";

const LIVE_POLL_MS = 1_500;

/**
 * Follow one discovery session's exploration timeline.
 *
 * The timeline is a server projection, so it is polled while the crawl is live
 * and fetched once more when it settles. The explore run comes from the session
 * list the caller is already refreshing, which is why the stop reason survives a
 * server restart without a second request.
 */
export function useDiscoveryExplorationTimeline(
  sessionId: () => string | undefined,
  live: () => boolean,
) {
  const server = useServer();
  const [explorationTimeline, setExplorationTimeline] =
    createSignal<DiscoveryExplorationTimeline | undefined>();

  const run = createMemo(
    () => server.discoverySessions().find((session) => session.id === sessionId())?.explore,
  );

  createEffect(() => {
    const id = sessionId();
    if (!id) {
      setExplorationTimeline(undefined);
      return;
    }
    let cancelled = false;
    setExplorationTimeline((current) => (current?.sessionId === id ? current : undefined));
    const load = async () => {
      const loaded = await server.loadDiscoveryExplorationTimeline(id).catch(() => undefined);
      if (cancelled || !loaded) return;
      setExplorationTimeline(loaded);
    };
    void load();
    if (!live()) {
      onCleanup(() => {
        cancelled = true;
      });
      return;
    }
    const timer = setInterval(() => void load(), LIVE_POLL_MS);
    onCleanup(() => {
      cancelled = true;
      clearInterval(timer);
    });
  });

  return { explorationTimeline, run };
}
