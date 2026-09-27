import { describe, expect, it, vi } from "vitest";
import { coalesceGets } from "./product-client";

describe("coalesceGets", () => {
  it("shares one request between identical GETs in flight", async () => {
    let release!: () => void;
    const base = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response("maps"));
        }),
    );
    const fetcher = coalesceGets(base as unknown as typeof fetch);
    const first = fetcher("http://relay/app-maps");
    const second = fetcher("http://relay/app-maps");
    release();
    expect(await (await first).text()).toBe("maps");
    expect(await (await second).text()).toBe("maps");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("does not cache after the request settles or share writes", async () => {
    const base = vi.fn(async () => new Response("ok"));
    const fetcher = coalesceGets(base as unknown as typeof fetch);
    await fetcher("http://relay/runs");
    await fetcher("http://relay/runs");
    await Promise.all([
      fetcher("http://relay/runs", { method: "POST" }),
      fetcher("http://relay/runs", { method: "POST" }),
    ]);
    expect(base).toHaveBeenCalledTimes(4);
  });
});
