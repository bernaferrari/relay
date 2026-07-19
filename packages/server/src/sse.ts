import type http from "node:http";
import { now, recentEvents, subscribe, type DeviceEvent } from "@relay/core";

type Client = { res: http.ServerResponse; heartbeat: NodeJS.Timeout };

export function createSseHub(headers: Record<string, string>): {
  attach: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  count: () => number;
  close: () => void;
} {
  const clients = new Set<Client>();

  const write = (res: http.ServerResponse, event: DeviceEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = subscribe((event) => {
    for (const client of clients) {
      try {
        write(client.res, event);
      } catch {
        clearInterval(client.heartbeat);
        clients.delete(client);
      }
    }
  });

  return {
    attach(req, res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        ...headers,
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, at: now() })}\n\n`);
      for (const event of recentEvents(30)) write(res, event);

      const client: Client = {
        res,
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
