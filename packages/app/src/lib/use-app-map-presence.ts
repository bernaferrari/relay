import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type { CollaborationAwareness } from "@relay/protocol";
import { useServer } from "../context/server";

/** Best-effort remote presence list for the active App Map canvas. */
export function useAppMapPresence(options: { recording: Accessor<boolean> }) {
  const server = useServer();
  const [remoteAwareness, setRemoteAwareness] = createSignal<CollaborationAwareness[]>([]);

  createEffect(() => {
    if (server.health() !== "online") {
      setRemoteAwareness([]);
      return;
    }
    let cancelled = false;
    const publish = async () => {
      try {
        await server.runAction("presence.upsert", {
          actorId: server.actorId(),
          actorKind: "human",
          activity: options.recording() ? "recording" : "editing",
          displayName: server.actorId(),
        });
        const listed = await server.runAction("presence.list", {});
        if (!cancelled && listed && typeof listed === "object" && "actors" in listed) {
          const actors = (listed as { actors: CollaborationAwareness[] }).actors.filter(
            (actor) => actor.actorId !== server.actorId(),
          );
          setRemoteAwareness(actors);
        }
      } catch {
        /* presence is best-effort */
      }
    };
    void publish();
    const timer = window.setInterval(() => void publish(), 12_000);
    onCleanup(() => {
      cancelled = true;
      window.clearInterval(timer);
      void server.runAction("presence.clear", { actorId: server.actorId() }).catch(() => undefined);
    });
  });

  return { remoteAwareness };
}
