/** Relay's small iOS-preview packet dialect and bounded MJPEG parser. */

const PACKET_HEADER_BYTES = 16;
const MAX_MJPEG_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_MJPEG_BUFFER_BYTES = MAX_MJPEG_FRAME_BYTES + 256 * 1024;

/** Encode one JPEG as Relay framed packet (kind 2). */
export function encodeRelayJpegPacket(jpeg: Uint8Array, ptsNs = 0n): Buffer {
  const header = Buffer.allocUnsafe(PACKET_HEADER_BYTES);
  header.writeUInt8(2, 0);
  header.writeUInt8(1, 1);
  header.writeUInt16BE(0, 2);
  header.writeBigUInt64BE(ptsNs, 4);
  header.writeUInt32BE(jpeg.byteLength, 12);
  return Buffer.concat([header, Buffer.from(jpeg)]);
}

/** Encode raw H.264 access unit / annex-B chunk (kind 3). Client may ignore if undecodable. */
export function encodeRelayAnnexBPacket(data: Uint8Array, ptsNs = 0n, keyframe = false): Buffer {
  const header = Buffer.allocUnsafe(PACKET_HEADER_BYTES);
  header.writeUInt8(3, 0);
  header.writeUInt8(keyframe ? 1 : 0, 1);
  header.writeUInt16BE(0, 2);
  header.writeBigUInt64BE(ptsNs, 4);
  header.writeUInt32BE(data.byteLength, 12);
  return Buffer.concat([header, Buffer.from(data)]);
}

function assertMjpegBufferLimit(buffer: Buffer): void {
  if (buffer.byteLength > MAX_MJPEG_BUFFER_BYTES) {
    throw new Error(
      `MJPEG parser buffer exceeded ${MAX_MJPEG_BUFFER_BYTES} bytes without a complete frame`,
    );
  }
}

/**
 * Accept the bounded multipart variants produced by go-ios and a few
 * compatible local providers. The buffer limit prevents a malformed source
 * from converting a missing boundary into unbounded Relay memory.
 */
export async function* readMjpegJpegs(
  body: AsyncIterable<Buffer>,
): AsyncGenerator<Buffer, void, void> {
  let buffer = Buffer.alloc(0);
  const boundaryMarkers = [
    Buffer.from("--BoundaryString"),
    Buffer.from("--RelayFrame"),
    Buffer.from("--ffmpeg"),
    Buffer.from("--frame"),
  ];
  for await (const chunk of body) {
    buffer = Buffer.concat([buffer, chunk]);
    assertMjpegBufferLimit(buffer);
    while (true) {
      const headerSep = buffer.indexOf("\r\n\r\n");
      if (headerSep < 0) break;
      const header = buffer.subarray(0, headerSep).toString("latin1");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        // Some servers use multipart without Content-Length: scan SOI/EOI.
        const soi = buffer.indexOf(Buffer.from([0xff, 0xd8]), headerSep + 4);
        if (soi < 0) {
          buffer = buffer.subarray(Math.max(0, buffer.length - 1));
          break;
        }
        const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
        if (eoi < 0) break;
        const jpeg = Buffer.from(buffer.subarray(soi, eoi + 2));
        buffer = buffer.subarray(eoi + 2);
        yield jpeg;
        continue;
      }
      const length = Number(lengthMatch[1]);
      if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_MJPEG_FRAME_BYTES) {
        throw new Error(`MJPEG frame has invalid Content-Length ${lengthMatch[1]}`);
      }
      const start = headerSep + 4;
      const end = start + length;
      if (buffer.length < end) break;
      const jpeg = Buffer.from(buffer.subarray(start, end));
      buffer = buffer.subarray(end);
      if (buffer.subarray(0, 2).equals(Buffer.from("\r\n"))) buffer = buffer.subarray(2);
      for (const marker of boundaryMarkers) {
        if (buffer.subarray(0, marker.length).equals(marker)) {
          const nl = buffer.indexOf("\n");
          buffer = nl >= 0 ? buffer.subarray(nl + 1) : Buffer.alloc(0);
          break;
        }
      }
      if (jpeg.length > 2 && jpeg[0] === 0xff && jpeg[1] === 0xd8) yield jpeg;
    }
  }
}
