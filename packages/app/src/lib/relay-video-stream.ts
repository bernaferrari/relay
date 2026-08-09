import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";

const PACKET_HEADER_BYTES = 16;

export type RelayJpegPacket = {
  type: "jpeg";
  pts: bigint;
  data: Uint8Array;
};

export type RelayAnnexBPacket = {
  type: "annexb";
  pts: bigint;
  keyframe: boolean;
  data: Uint8Array;
};

export type RelayVideoPacket = ScrcpyMediaStreamPacket | RelayJpegPacket | RelayAnnexBPacket;

class ByteReader {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #chunk: Uint8Array = new Uint8Array(0);
  #offset = 0;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.#reader = stream.getReader();
  }

  async readExactly(length: number): Promise<Uint8Array | undefined> {
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (this.#offset === this.#chunk.byteLength) {
        const result = await this.#reader.read();
        if (result.done)
          return written === 0 ? undefined : Promise.reject(new Error("Truncated video packet"));
        this.#chunk = result.value;
        this.#offset = 0;
      }
      const available = this.#chunk.byteLength - this.#offset;
      const count = Math.min(available, length - written);
      output.set(this.#chunk.subarray(this.#offset, this.#offset + count), written);
      this.#offset += count;
      written += count;
    }
    return output;
  }

  cancel(): Promise<void> {
    return this.#reader.cancel().then(() => undefined);
  }
}

/** Packets DeviceVideoStream can draw: JPEG frames or Android scrcpy H.264. */
export function relayPreviewPacketIsPaintable(packet: RelayVideoPacket): boolean {
  return packet.type === "jpeg" || packet.type === "configuration" || packet.type === "data";
}

/** Turn Relay's chunked HTTP framing into H.264 (Android) or JPEG (iOS go-ios) packets. */
export function relayVideoPacketStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<RelayVideoPacket> {
  const bytes = new ByteReader(body);
  return new ReadableStream<RelayVideoPacket>({
    async pull(controller) {
      const header = await bytes.readExactly(PACKET_HEADER_BYTES);
      if (!header) {
        controller.close();
        return;
      }
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      const kind = view.getUint8(0);
      const keyframe = view.getUint8(1) === 1;
      const pts = view.getBigUint64(4);
      const length = view.getUint32(12);
      const data = await bytes.readExactly(length);
      if (!data) throw new Error("Video packet payload is missing");
      if (kind === 0) controller.enqueue({ type: "configuration", data });
      else if (kind === 1) controller.enqueue({ type: "data", keyframe, pts, data });
      else if (kind === 2) controller.enqueue({ type: "jpeg", pts, data });
      else if (kind === 3) controller.enqueue({ type: "annexb", pts, keyframe, data });
      else throw new Error(`Unknown video packet kind: ${kind}`);
    },
    cancel() {
      return bytes.cancel();
    },
  });
}

/** H.264-only view for the Android WebCodecs decoder. */
export function relayH264PacketStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<ScrcpyMediaStreamPacket> {
  const mixed = relayVideoPacketStream(body);
  return new ReadableStream<ScrcpyMediaStreamPacket>({
    async start(controller) {
      const reader = mixed.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) {
            controller.close();
            return;
          }
          if (result.value.type === "jpeg" || result.value.type === "annexb") continue;
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      return mixed.cancel();
    },
  });
}
