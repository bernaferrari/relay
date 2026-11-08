import type { Page } from "playwright-core";
import { hasSensitiveEvidenceConsent } from "./evidence-policy.js";
import type { EvidenceCollectionPolicy, StepTarget } from "@relay/protocol";
import { locatorFor } from "./browser-target-locator.js";
import { browserUploadLocatorInput } from "./browser-live-controls.js";

export function assertAudioOutputConsent(
  frozen: EvidenceCollectionPolicy,
  current: EvidenceCollectionPolicy,
): void {
  if (
    !hasSensitiveEvidenceConsent(frozen, "audio") ||
    !hasSensitiveEvidenceConsent(current, "audio")
  )
    throw new Error("audio-record requires explicit audio evidence consent");
  if (frozen.redaction?.enabled !== false || current.redaction?.enabled !== false)
    throw new Error("audio-record cannot capture audio while evidence redaction is enabled");
}

export const MAX_AUDIO_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Records one selected HTML media element, not WebAudio, speechSynthesis, or OS speakers. */
export async function recordHtmlMediaAudio(
  page: Page,
  target: StepTarget,
  durationMs: number,
): Promise<Buffer> {
  if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > 30_000)
    throw new Error("audio-record durationMs must be between 250 and 30000");
  const media = await locatorFor(page, browserUploadLocatorInput(target));
  if ((await media.count()) !== 1)
    throw new Error("audio-record requires exactly one HTML audio or video element");
  const base64 = await media.evaluate(
    async (element, options) => {
      if (!(element instanceof HTMLMediaElement))
        throw new Error(
          "audio-record target must be an HTML audio/video element; WebAudio and speech synthesis are unsupported",
        );
      if (element.paused || element.ended || element.muted || element.volume === 0)
        throw new Error("audio-record media must be playing and unmuted");
      if (!("captureStream" in element) || typeof element.captureStream !== "function")
        throw new Error("audio-record HTML media capture is unsupported by this browser");
      const captured: unknown = element.captureStream();
      if (!(captured instanceof MediaStream))
        throw new Error("audio-record did not receive a media stream");
      const tracks = captured.getAudioTracks();
      if (!tracks.length) {
        captured.getTracks().forEach((track) => track.stop());
        throw new Error("audio-record selected media has no accessible audio track");
      }
      const stream = new MediaStream(tracks);
      const mimeType = "audio/webm;codecs=opus";
      let recorder: MediaRecorder | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!MediaRecorder.isTypeSupported(mimeType))
          throw new Error("audio-record Opus recording is unsupported");
        recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 });
        const chunks: Blob[] = [];
        let size = 0;
        const completed = new Promise<Blob>((resolve, reject) => {
          const recording = recorder!;
          recording.ondataavailable = (event) => {
            size += event.data.size;
            if (size > options.maxBytes) {
              reject(new Error("audio-record exceeded its byte limit"));
              if (recording.state !== "inactive") recording.stop();
              return;
            }
            chunks.push(event.data);
          };
          recording.onerror = () => reject(new Error("audio-record browser recorder failed"));
          recording.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
          deadline = setTimeout(
            () => reject(new Error("audio-record timed out")),
            options.durationMs + 5_000,
          );
          recording.start(100);
          timer = setTimeout(() => {
            if (recording.state !== "inactive") recording.stop();
          }, options.durationMs);
        });
        const blob = await completed;
        if (blob.size === 0) throw new Error("audio-record produced no audio bytes");
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("audio-record could not read recorded bytes"));
          reader.onload = () => {
            if (typeof reader.result !== "string") {
              reject(new Error("audio-record invalid recorded data"));
              return;
            }
            resolve(reader.result.slice(reader.result.indexOf(",") + 1));
          };
          reader.readAsDataURL(blob);
        });
      } finally {
        if (timer) clearTimeout(timer);
        if (deadline) clearTimeout(deadline);
        if (recorder && recorder.state !== "inactive") recorder.stop();
        captured.getTracks().forEach((track) => track.stop());
      }
    },
    { durationMs, maxBytes: MAX_AUDIO_OUTPUT_BYTES },
  );
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_AUDIO_OUTPUT_BYTES)
    throw new Error("audio-record invalid byte count");
  return bytes;
}
