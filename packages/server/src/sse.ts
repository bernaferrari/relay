import type http from "node:http";
import { envelopeEvent, eventsAfter, now, subscribe, type DeviceEvent } from "@relay/core";

const SLOW_CLIENT_SKIP_LIMIT = 50;

type Client = {
  res: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
  visible: (event: DeviceEvent) => boolean;
  paused: boolean;
  skipped: number;
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

  const drop = (client: Client) => {
    clearInterval(client.heartbeat);
    clients.delete(client);
  };

  const write = (client: Client, event: DeviceEvent) => {
    if (client.res.destroyed || client.res.writableEnded) {
      drop(client);
      return;
    }
    if (client.paused) {
      client.skipped += 1;
      if (client.skipped > SLOW_CLIENT_SKIP_LIMIT) drop(client);
      return;
    }
    try {
      const ok =
        client.res.write(`id: ${event.sequence}\n`) &&
        client.res.write(`event: ${event.payload.type}\n`) &&
        client.res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (ok) {
        client.skipped = 0;
        return;
      }
      client.paused = true;
      client.res.once("drain", () => {
        client.paused = false;
        client.skipped = 0;
      });
    } catch {
      drop(client);
    }
  };
  const unsubscribe = subscribe((event) => {
    for (const client of clients) {
      if (!client.visible(event)) continue;
      write(client, event);
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
      const client: Client = {
        res,
        visible,
        paused: false,
        skipped: 0,
        heartbeat: setInterval(() => {
          if (client.paused || res.destroyed || res.writableEnded) return;
          try {
            res.write(`: ping ${now()}\n\n`);
          } catch {
            drop(client);
          }
        }, 15_000),
      };
      for (const event of replay.events) {
        if (visible(event)) write(client, event);
      }
      if (replay.gap) {
        write(
          client,
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

      clients.add(client);
      const cleanup = () => drop(client);
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
