import { describe, expect, it, vi } from "vitest";
import type { Platform } from "../platform/types";
import { createGoalProductService } from "./goal-product-service";

function platform(fetch: typeof globalThis.fetch): Platform {
  return {
    platform: "web",
    getServerUrl: () => "http://relay.test",
    getServerConnection: () => ({
      url: "http://relay.test",
      auth: { type: "bearer", token: "secret" },
      organizationId: "org-1",
      projectId: "project-1",
      actorId: "human:test",
      actorKind: "human",
    }),
    storage: { get: () => null, set: () => undefined },
    fetch,
  };
}

describe("goal product service", () => {
  it("uses the single OpenRouter-backed goal route for one worker", async () => {
    let request: Request | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ sessionId: "goal-1", status: "running" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const service = createGoalProductService(platform(fetch));

    await service.start({
      goal: "Find checkout",
      startUrl: "https://example.test",
      agents: 1,
      confirmControl: true,
    });

    expect(request?.url).toBe("http://relay.test/goal");
    expect(request?.headers.get("authorization")).toBe("Bearer secret");
    expect(request?.headers.get("x-relay-actor-id")).toBe("human:test");
    expect(JSON.parse(await request!.text())).toEqual({
      goal: "Find checkout",
      startUrl: "https://example.test",
      confirmControl: true,
    });
  });

  it("uses isolated exploration for multiple workers", async () => {
    let init: RequestInit | undefined;
    const fetch = vi.fn(async (_input: RequestInfo | URL, nextInit?: RequestInit) => {
      init = nextInit;
      return new Response(JSON.stringify({ id: "explore-1", status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const service = createGoalProductService(platform(fetch));

    await service.start({
      goal: "Find checkout",
      startUrl: "https://example.test",
      agents: 4,
      confirmControl: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://relay.test/explore",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({ agents: 4, confirmControl: true });
  });
});
