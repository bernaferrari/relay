import { onCleanup, onMount } from "solid-js";
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
  type VideoFrameRenderer,
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { relayPreviewPacketIsPaintable, relayVideoPacketStream } from "../lib/relay-video-stream";
import {
  inspectVisualFrame,
  type VisualFrameDetectorState,
  type VisualFrameSignal,
  visualFrameSampleDue,
} from "../lib/visual-frame-signal";

export type DeviceVideoVisualSignal = VisualFrameSignal & {
  /** Wall-clock time for proof/freshness presentation outside the decoder. */
  observedAt: number;
};

export function DeviceVideoStream(props: {
  src: string;
  onReady: () => void;
  onFailure: () => void;
  onSize: (width: number, height: number) => void;
  /** Initial and materially changed preview fingerprints, capped at 2.5Hz. */
  onVisualFingerprint?: (signal: DeviceVideoVisualSignal) => void;
  /** Material preview changes only; small animation/compression noise is ignored. */
  onVisualChange?: (signal: DeviceVideoVisualSignal) => void;
}) {
  let canvas: HTMLCanvasElement | undefined;

  onMount(() => {
    if (!canvas) {
      props.onFailure();
      return;
    }

    const abort = new AbortController();
    let disposed = false;
    let readyFrame = 0;
    let reportedReady = false;
    let decoder: WebCodecsVideoDecoder | undefined;
    let removeSizeListener: (() => void) | undefined;
    let visualAnalysisFrame = 0;
    let visualState: VisualFrameDetectorState = {};
    // This stays deliberately tiny. It is allocated only when a consumer asks
    // for freshness and read on the animation frame at a capped cadence,
    // never once for every decoded device frame.
    let analysisCanvas: HTMLCanvasElement | undefined;
    let analysisContext: CanvasRenderingContext2D | null | undefined;

    const markReady = () => {
      if (reportedReady || disposed) return;
      reportedReady = true;
      readyFrame = requestAnimationFrame(props.onReady);
    };

    const notifyVisualSignal = (signal: VisualFrameSignal) => {
      const observed = { ...signal, observedAt: Date.now() };
      props.onVisualFingerprint?.(observed);
      if (signal.previousFingerprint) props.onVisualChange?.(observed);
    };

    const scheduleVisualAnalysis = () => {
      if ((!props.onVisualFingerprint && !props.onVisualChange) || visualAnalysisFrame || disposed)
        return;
      if (!visualFrameSampleDue(visualState, performance.now())) return;
      visualAnalysisFrame = requestAnimationFrame(() => {
        visualAnalysisFrame = 0;
        const sampledAt = performance.now();
        if (disposed || !canvas || !visualFrameSampleDue(visualState, sampledAt)) return;
        try {
          if (!analysisCanvas) {
            analysisCanvas = document.createElement("canvas");
            analysisCanvas.width = 24;
            analysisCanvas.height = 24;
            analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
          }
          if (!analysisContext) {
            visualState = { ...visualState, lastSampledAt: sampledAt };
            return;
          }
          // Sampling the final paint target makes this transport-agnostic:
          // JPEG and H.264 both feed the same bounded signal. It also means
          // a burst of decoded frames collapses to the newest visible frame.
          analysisContext.drawImage(canvas, 0, 0, analysisCanvas.width, analysisCanvas.height);
          const imageData = analysisContext.getImageData(
            0,
            0,
            analysisCanvas.width,
            analysisCanvas.height,
          );
          const result = inspectVisualFrame(
            visualState,
            {
              width: imageData.width,
              height: imageData.height,
              data: imageData.data,
            },
            sampledAt,
          );
          visualState = result.state;
          if (result.signal) notifyVisualSignal(result.signal);
        } catch {
          // A visual freshness hint must never take the video transport down.
          // Canvas readback can fail transiently while a browser tears down a
          // WebGL frame; the next bounded sample can still prove a change.
          visualState = { ...visualState, lastSampledAt: sampledAt };
        }
      });
    };

    const drawJpeg = async (data: Uint8Array) => {
      if (!canvas) return;
      // This frame is decoded directly; assigning it an object URL only keeps
      // an additional native-backed URL allocation alive until the next frame.
      // Long MJPEG sessions can otherwise accumulate substantial renderer
      // memory without the URL ever being used by an element.
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      const blob = new Blob([bytes.buffer], { type: "image/jpeg" });
      const image = await createImageBitmap(blob);
      try {
        if (canvas.width !== image.width || canvas.height !== image.height) {
          canvas.width = image.width;
          canvas.height = image.height;
          props.onSize(image.width, image.height);
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable");
        ctx.drawImage(image, 0, 0);
        scheduleVisualAnalysis();
        markReady();
      } finally {
        image.close();
      }
    };

    void fetch(props.src, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Video stream failed (${response.status})`);
        if (!response.body) throw new Error("Video stream has no response body");

        const reader = relayVideoPacketStream(response.body).getReader();
        let h264Writer: WritableStreamDefaultWriter<ScrcpyMediaStreamPacket> | undefined;

        const ensureH264Writer = () => {
          if (h264Writer) return h264Writer;
          if (!WebCodecsVideoDecoder.isSupported) throw new Error("WebCodecs unavailable");
          const renderer: VideoFrameRenderer = WebGLVideoFrameRenderer.isSupported
            ? new WebGLVideoFrameRenderer(canvas!)
            : new BitmapVideoFrameRenderer(canvas!);
          decoder = new WebCodecsVideoDecoder({ codec: ScrcpyVideoCodecId.H264, renderer });
          removeSizeListener = decoder.sizeChanged(({ width, height }) => {
            props.onSize(width, height);
            markReady();
          });
          h264Writer = decoder.writable.getWriter();
          return h264Writer;
        };

        try {
          while (!disposed) {
            const result = await reader.read();
            if (result.done) break;
            const packet = result.value;
            if (packet.type === "jpeg") {
              await drawJpeg(packet.data);
              continue;
            }
            if (packet.type === "annexb") {
              // Raw annex-B is not WebCodecs-ready. Fail to PNG poll
              // instead of leaving the overlay blank while the socket stays open.
              if (!reportedReady && !relayPreviewPacketIsPaintable(packet)) {
                props.onFailure();
                disposed = true;
                abort.abort();
              }
              continue;
            }
            await ensureH264Writer().write(packet);
            scheduleVisualAnalysis();
          }
        } finally {
          await h264Writer?.close().catch(() => undefined);
          reader.releaseLock();
        }
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
      cancelAnimationFrame(visualAnalysisFrame);
      removeSizeListener?.();
      decoder?.dispose();
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
