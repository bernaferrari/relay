import { describe, expect, it, vi } from "vitest";
import type { ActivityRecord, AuthoringSession, DeviceLease } from "@relay/protocol";
import { createSessionProductService, projectSessionSummary } from "./session-product-service";

const client = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("./product-client", () => ({
  productClientForPlatform: vi.fn(async () => ({ client, actorId: "human:sessions-test" })),
}));

const platform = { platform: "web", storage: {} } as never;

function session(overrides: Partial<AuthoringSession> = {}): AuthoringSession {
  return {
    schemaVersion: 1,
    id: "authoring-session-1",
    organizationId: "local",
    projectId: "default",
    actorId: "human:sessions-test",
    actorKind: "human",
    appMapId: "map-1",
    state: "recording",
    target: { kind: "browser", platform: "browser", targetId: "browser-1" },
    leaseId: "lease-1",
    expectedAppMapRevision: 2,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function lease(overrides: Partial<DeviceLease> = {}): DeviceLease {
  return {
    id: "lease-1",
    projectId: "default",
    poolId: "pool-1",
    deviceSerial: "browser-1",
    ownerId: "human:sessions-test",
    status: "leased",
    leasedAt: 90,
    expiresAt: 10_000,
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    schemaVersion: 1,
    organizationId: "local",
    projectId: "default",
    activityId: "activity-1",
    actorId: "human:sessions-test",
    actorKind: "human",
    operationId: "authoring.session.interact",
    requestId: "request-1",
    timestamp: 150,
    eventType: "operation.succeeded",
    resourceKind: "recording-session",
    resourceId: "authoring-session-1",
    summary: "Interact During Authoring succeeded",
    ...overrides,
  };
}

describe("Session product projection", () => {
  it("keeps list identity small while joining the durable lease", () => {
    const projected = projectSessionSummary(session({ testName: "Checkout" }), [lease()]);

    expect(projected).toMatchObject({
      id: "authoring-session-1",
      title: "Checkout",
      state: "recording",
      target: { kind: "browser", targetId: "browser-1" },
      lease: { id: "lease-1", status: "leased" },
      hasError: false,
      archived: false,
    });
    expect(projected).not.toHaveProperty("take.revisions");
  });

  it("does not attach another actor's lease to a session", () => {
    const projected = projectSessionSummary(session(), [lease({ ownerId: "agent:other" })]);

    expect(projected.lease).toBeNull();
  });

  it("lists durable authoring sessions and does not infer a lease", async () => {
    client.invoke.mockReset();
    client.invoke.mockImplementation(async (operation: string) => {
      if (operation === "authoring.session.list") return { sessions: [session()] };
      if (operation === "lease.list") return { leases: [] };
      throw new Error(`unexpected operation ${operation}`);
    });

    const service = createSessionProductService(platform);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ id: "authoring-session-1", lease: null }),
    ]);
    expect(client.invoke).toHaveBeenCalledWith("authoring.session.list", {});
    expect(client.invoke).toHaveBeenCalledWith("lease.list", { status: "all" });
  });

  it("joins bounded activity context and maps refresh/end to canonical operations", async () => {
    client.invoke.mockReset();
    client.invoke.mockImplementation(async (operation: string) => {
      if (operation === "authoring.session.get") return { session: session() };
      if (operation === "authoring.session.observe")
        return { session: session({ state: "ready" }) };
      if (operation === "authoring.session.cancel")
        return { session: session({ state: "cancelled" }) };
      if (operation === "lease.list") return { leases: [lease()] };
      if (operation === "activity.list") return { items: [activity()] };
      if (operation === "app-map.get") return { appMap: { name: "Checkout" } };
      throw new Error(`unexpected operation ${operation}`);
    });

    const service = createSessionProductService(platform);
    await expect(service.get("authoring-session-1")).resolves.toMatchObject({
      projectId: "default",
      appName: "Checkout",
      activity: [expect.objectContaining({ activityId: "activity-1" })],
    });
    await service.refresh("authoring-session-1");
    await service.end("authoring-session-1");

    expect(client.invoke).toHaveBeenCalledWith(
      "authoring.session.observe",
      { sessionId: "authoring-session-1" },
      { authoringSessionId: "authoring-session-1" },
    );
    expect(client.invoke).toHaveBeenCalledWith(
      "authoring.session.cancel",
      { sessionId: "authoring-session-1" },
      { authoringSessionId: "authoring-session-1" },
    );
  });
});
