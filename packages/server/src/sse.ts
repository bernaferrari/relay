import type http from "node:http";
import { envelopeEvent, eventsAfter, now, subscribe, type DeviceEvent } from "@relay/core";

type Client = {
  res: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
  visible: (event: DeviceEvent) => boolean;
};

export function createSseHub(headers: Record<string, string>): {
  attach: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    visible?: (event: DeviceEvent) => boolean,
  ) => void;
  count: () => number;
  close: () => void;
} {
  const clients = new Set<Client>();

  const write = (res: http.ServerResponse, event: DeviceEvent) => {
    res.write(`id: ${event.sequence}\n`);
    res.write(`event: ${event.payload.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = subscribe((event) => {
    for (const client of clients) {
      if (!client.visible(event)) continue;
      try {
        write(client.res, event);
      } catch {
        clearInterval(client.heartbeat);
        clients.delete(client);
      }
    }
  });

  return {
    attach(req, res, visible = () => true) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...headers,
      });
      res.write(`: connected ${now()}\n\n`);
      const headerCursor = Array.isArray(req.headers["last-event-id"])
        ? req.headers["last-event-id"][0]
        : req.headers["last-event-id"];
      const requestedAfter = Number(headerCursor ?? 0);
      const replay = eventsAfter(Number.isFinite(requestedAfter) ? requestedAfter : 0);
      for (const event of replay.events) {
        if (visible(event)) write(res, event);
      }
      if (replay.gap) {
        write(
          res,
          envelopeEvent({
            type: "stream.gap",
            at: now(),
            requestedAfter,
            oldestAvailable: replay.oldestAvailable,
            latestAvailable: replay.latestAvailable,
            requiresRefresh: true as const,
          }),
        );
      }

      const client: Client = {
        res,
        visible,
        heartbeat: setInterval(() => {
          try {
            res.write(`: ping ${now()}\n\n`);
          } catch {
            clearInterval(client.heartbeat);
          }
        }, 15_000),
      };
      clients.add(client);
      const cleanup = () => {
        clearInterval(client.heartbeat);
        clients.delete(client);
      };
      req.on("close", cleanup);
      req.on("error", cleanup);
    },
    count: () => clients.size,
    close() {
      unsubscribe();
      for (const client of clients) {
        clearInterval(client.heartbeat);
        client.res.end();
      }
      clients.clear();
    },
  };
}
