/** Read authenticated media without allowing unbounded response buffering. */
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
export async function boundedVideoBlob(
  response: Response,
  maxBytes = MAX_VIDEO_BYTES,
): Promise<Blob> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel("video inspection size limit");
    throw new Error("Recorded video exceeds the inspection limit.");
  }
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("video inspection size limit");
        throw new Error("Recorded video exceeds the inspection limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(
    chunks.map(
      (chunk) =>
        chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer,
    ),
    { type: response.headers.get("content-type") ?? "video/mp4" },
  );
}
