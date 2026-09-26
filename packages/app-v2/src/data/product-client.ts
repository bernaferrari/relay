import type { Platform } from "../platform/types";

export type ProductClientContext = {
  client: InstanceType<(typeof import("@relay/client"))["RelayClient"]>;
  actorId: string;
  serverUrl?: string;
};

const clients = new WeakMap<Platform, Promise<ProductClientContext>>();

/** Pages mount several services that read the same list at once (app maps
 * are megabytes). Identical GETs in flight share one request; nothing is
 * cached after it settles. */
export function coalesceGets(base: typeof fetch): typeof fetch {
  const inflight = new Map<string, Promise<Response>>();
  return (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (method !== "GET" || input instanceof Request) return base(input, init);
    const key = String(input);
    let shared = inflight.get(key);
    if (!shared) {
      shared = base(input, init).finally(() => inflight.delete(key));
      inflight.set(key, shared);
    }
    return shared.then((response) => response.clone());
  };
}

/** One lazy transport identity per mounted platform. Product journeys can be
 * split into vertical slices without accidentally competing for a target as
 * different actors. */
export function productClientForPlatform(platform: Platform): Promise<ProductClientContext> {
  const existing = clients.get(platform);
  if (existing) return existing;
  const created = Promise.resolve().then(async () => {
    const { RelayClient } = await import("@relay/client");
    const connection = platform.getServerConnection
      ? await platform.getServerConnection()
      : {
          url: await platform.getServerUrl(),
          auth: { type: "none" as const },
          organizationId: "local",
          projectId: "default",
          actorId: `human:${crypto.randomUUID()}`,
          actorKind: "human" as const,
        };
    return {
      client: new RelayClient(connection, { fetch: coalesceGets(platform.fetch ?? fetch) }),
      actorId: connection.actorId,
      serverUrl: connection.url,
    };
  });
  clients.set(platform, created);
  return created;
}
