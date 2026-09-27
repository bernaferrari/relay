import { describe, expect, it, vi } from "vitest";
import { boundedVideoBlob } from "./run-video-loader";

describe("bounded video transport", () => {
  it("reads chunked media and preserves its content type", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "video/webm" },
    });
    const blob = await boundedVideoBlob(response, 4);
    expect(blob.size).toBe(3);
    expect(blob.type).toBe("video/webm");
  });
  it("cancels a chunked response that exceeds its declared length", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel,
      }),
      { headers: { "content-length": "1" } },
    );
    await expect(boundedVideoBlob(response, 2)).rejects.toThrow("inspection limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels an oversized response before reading it", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": "10" },
    });
    await expect(boundedVideoBlob(response, 2)).rejects.toThrow("inspection limit");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
