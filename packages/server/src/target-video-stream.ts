import type http from "node:http";
import { devicePlatformForSerial, iosLivePreviewUsesStream } from "@relay/core";
import { HttpError } from "./http.js";
import { streamAndroidVideo } from "./live-video.js";
import { readIosLivePreviewBackend, streamIosGoIosMjpeg } from "./ios-live-video.js";

export async function streamTargetVideo(
  response: http.ServerResponse,
  serial: string,
): Promise<void> {
  const platform = await devicePlatformForSerial(serial);
  if (platform === "android") return streamAndroidVideo(response, serial);
  if (platform !== "ios") {
    throw new HttpError(400, `Live video is not available for platform ${platform}`);
  }
  const backend = await readIosLivePreviewBackend();
  if (iosLivePreviewUsesStream(backend)) return streamIosGoIosMjpeg(response, serial);
  throw new HttpError(
    409,
    "iOS live H.264/MJPEG preview is off. Enable go-ios MJPEG in Device settings, or use PNG preview.",
  );
}
