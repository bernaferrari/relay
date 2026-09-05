import type { Platform } from "../platform/types";

export type ProductClientContext = {
  client: InstanceType<(typeof import("@relay/client"))["RelayClient"]>;
  actorId: string;
  serverUrl?: string;
};

const clients = new WeakMap<Platform, Promise<ProductClientContext>>();

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
      client: new RelayClient(connection, { fetch: platform.fetch ?? fetch }),
      actorId: connection.actorId,
      serverUrl: connection.url,
    };
  });
  clients.set(platform, created);
  return created;
}
