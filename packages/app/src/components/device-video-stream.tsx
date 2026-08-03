import { onCleanup, onMount } from "solid-js";
import { ScrcpyVideoCodecId } from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
  type VideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { relayVideoPacketStream } from "../lib/relay-video-stream";

export function DeviceVideoStream(props: {
  src: string;
  onReady: () => void;
  onFailure: () => void;
  onSize: (width: number, height: number) => void;
}) {
  let canvas: HTMLCanvasElement | undefined;

  onMount(() => {
    if (!canvas || !WebCodecsVideoDecoder.isSupported) {
      props.onFailure();
      return;
    }

    const abort = new AbortController();
    let disposed = false;
    let readyFrame = 0;
    let reportedReady = false;
    const renderer: VideoFrameRenderer = WebGLVideoFrameRenderer.isSupported
      ? new WebGLVideoFrameRenderer(canvas)
      : new BitmapVideoFrameRenderer(canvas);
    const decoder = new WebCodecsVideoDecoder({ codec: ScrcpyVideoCodecId.H264, renderer });
    const removeSizeListener = decoder.sizeChanged(({ width, height }) => {
      props.onSize(width, height);
      // sizeChanged is emitted by the first decoded VideoFrame, immediately
      // before it is drawn. Reveal the canvas on the following paint. This is
      // more reliable across Electron versions than polling a frame counter.
      if (!reportedReady) {
        reportedReady = true;
        readyFrame = requestAnimationFrame(props.onReady);
      }
    });

    void fetch(props.src, { signal: abort.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Video stream failed (${response.status})`);
        if (!response.body) throw new Error("Video stream has no response body");
        return relayVideoPacketStream(response.body).pipeTo(decoder.writable);
      })
      .then(() => {
        if (!disposed) props.onFailure();
      })
      .catch((error) => {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          props.onFailure();
        }
      });

    onCleanup(() => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(readyFrame);
      removeSizeListener();
      decoder.dispose();
      // Reconnects must release GPU textures and decoded backing stores now,
      // rather than waiting for a future Chromium GC pass.
      const gl =
        canvas?.getContext("webgl2") ??
        (canvas?.getContext("webgl") as WebGLRenderingContext | null | undefined);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    });
  });

  return (
    <canvas
      ref={(element) => {
        canvas = element;
      }}
      class="pointer-events-none absolute inset-0 z-[1] block h-full w-full object-contain"
      data-device-video="true"
      aria-hidden="true"
    />
  );
}
