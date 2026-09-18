/**
 * Small usbmuxd transport used by the live iOS XCTest listener.
 *
 * The command module owns XCTest semantics; this module owns only the
 * process/socket framing needed to reach the already-running listener.
 */
import { createConnection, type Socket } from "node:net";

const USBMUXD_SOCKET_PATH = "/var/run/usbmuxd";
const USBMUX_HEADER_BYTES = 16;
const USBMUX_PROTOCOL_VERSION = 1;
const USBMUX_MESSAGE_PLIST = 8;

function hostToNetworkPort(port: number): number {
  return ((port & 0xff) << 8) | ((port >>> 8) & 0xff);
}

function buildUsbmuxPlist(fields: Record<string, string | number>): Buffer {
  const entries = Object.entries(fields)
    .map(([key, value]) =>
      typeof value === "number"
        ? `<key>${key}</key><integer>${value}</integer>`
        : `<key>${key}</key><string>${escapeXml(value)}</string>`,
    )
    .join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries}</dict></plist>\n`,
    "utf8",
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function usbmuxPacket(tag: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(USBMUX_HEADER_BYTES);
  header.writeUInt32LE(USBMUX_HEADER_BYTES + payload.length, 0);
  header.writeUInt32LE(USBMUX_PROTOCOL_VERSION, 4);
  header.writeUInt32LE(USBMUX_MESSAGE_PLIST, 8);
  header.writeUInt32LE(tag, 12);
  return Buffer.concat([header, payload]);
}

export async function openUsbmuxRunnerSocket(
  serial: string,
  port: number,
  timeoutMs: number,
): Promise<Socket> {
  const deviceId = await listUsbmuxDeviceId(serial, timeoutMs);
  const socket = await connectUsbmuxd(timeoutMs);
  try {
    await writeAll(
      socket,
      usbmuxPacket(
        2,
        buildUsbmuxPlist({
          MessageType: "Connect",
          ClientVersionString: "relay",
          ProgName: "relay",
          DeviceID: deviceId,
          PortNumber: hostToNetworkPort(port),
        }),
      ),
    );
    const listed = await readUsbmuxPacket(socket, timeoutMs);
    const result = Number(
      listed.toString("utf8").match(/<key>Number<\/key>\s*<integer>(\d+)<\/integer>/u)?.[1],
    );
    if (result !== 0) {
      socket.destroy();
      throw new Error(`usbmux connect to live XCTest listener failed (${result})`);
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function listUsbmuxDeviceId(serial: string, timeoutMs: number): Promise<number> {
  const socket = await connectUsbmuxd(timeoutMs);
  try {
    await writeAll(
      socket,
      usbmuxPacket(
        1,
        buildUsbmuxPlist({
          MessageType: "ListDevices",
          ClientVersionString: "relay",
          ProgName: "relay",
        }),
      ),
    );
    const xml = (await readUsbmuxPacket(socket, timeoutMs)).toString("utf8");
    const deviceId = readUsbmuxDeviceId(xml, serial);
    if (deviceId === undefined)
      throw new Error(`iOS device ${serial} is not available through usbmux`);
    return deviceId;
  } finally {
    socket.destroy();
  }
}

export function readUsbmuxDeviceId(xml: string, serial: string): number | undefined {
  for (const chunk of xml.split("<key>DeviceID</key>").slice(1)) {
    const id = Number(chunk.match(/<integer>(\d+)<\/integer>/u)?.[1]);
    const listed = chunk.match(/<key>SerialNumber<\/key>\s*<string>([^<]+)<\/string>/u)?.[1];
    if (listed === serial && Number.isInteger(id) && id > 0) return id;
  }
  return undefined;
}

async function connectUsbmuxd(timeoutMs: number): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(USBMUXD_SOCKET_PATH);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to usbmuxd"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function writeAll(socket: Socket, payload: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(payload, (error) => (error ? reject(error) : resolve()));
  });
}

async function readUsbmuxPacket(socket: Socket, timeoutMs: number): Promise<Buffer> {
  const header = await readExact(socket, USBMUX_HEADER_BYTES, timeoutMs);
  const length = header.readUInt32LE(0);
  if (length < USBMUX_HEADER_BYTES) throw new Error("Invalid usbmux packet length");
  return await readExact(socket, length - USBMUX_HEADER_BYTES, timeoutMs);
}

async function readExact(socket: Socket, size: number, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let got = 0;
  const deadline = Date.now() + timeoutMs;
  while (got < size) {
    const remaining = Math.max(1, deadline - Date.now());
    const chunk = await readChunk(socket, remaining);
    if (!chunk.length) throw new Error("usbmux closed");
    chunks.push(chunk);
    got += chunk.length;
  }
  const all = Buffer.concat(chunks);
  if (all.length > size) socket.unshift(all.subarray(size));
  return all.subarray(0, size);
}

export async function readUntilClose(socket: Socket, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await readChunk(socket, Math.max(1, deadline - Date.now())).catch(
      (error: unknown) => {
        if (error instanceof Error && error.message === "usbmux closed") return Buffer.alloc(0);
        throw error;
      },
    );
    if (!chunk.length) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readChunk(socket: Socket, timeoutMs: number): Promise<Buffer> {
  const pending = socket.read() as Buffer | null;
  if (pending?.length) return pending;
  return await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out reading usbmux"));
    }, timeoutMs);
    const onReadable = () => {
      const chunk = socket.read() as Buffer | null;
      if (!chunk?.length) return;
      cleanup();
      resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.alloc(0));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("readable", onReadable);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    socket.on("readable", onReadable);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}
