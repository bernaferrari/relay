import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";

const PACKET_HEADER_BYTES = 16;

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

/** Turn Relay's chunked HTTP framing back into timestamped scrcpy packets. */
export function relayVideoPacketStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<ScrcpyMediaStreamPacket> {
  const bytes = new ByteReader(body);
  return new ReadableStream<ScrcpyMediaStreamPacket>({
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
      else throw new Error(`Unknown video packet kind: ${kind}`);
    },
    cancel() {
      return bytes.cancel();
    },
  });
}
