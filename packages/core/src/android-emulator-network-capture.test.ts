import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveAndroidAvdDirectory,
  startAndroidEmulatorNetworkCapture,
  stopAndroidEmulatorNetworkCapture,
  reapStaleAndroidEmulatorNetworkCaptures,
  reapStaleAndroidEmulatorNetworkCapturesAtStartup,
  type AndroidEmulatorNetworkCaptureRuntime,
} from "./android-emulator-network-capture.js";

const liveSerial = process.env.RELAY_ANDROID_EMULATOR_CAPTURE_LIVE_SERIAL?.trim();
const liveAvdName = process.env.RELAY_ANDROID_EMULATOR_CAPTURE_LIVE_AVD?.trim();

function tcpPcap(): Buffer {
  const frame = Buffer.alloc(14 + 20 + 20);
  frame.writeUInt16BE(0x0800, 12);
  frame[14] = 0x45;
  frame.writeUInt16BE(40, 16);
  frame[23] = 6;
  Buffer.from([10, 0, 2, 15]).copy(frame, 26);
  Buffer.from([93, 184, 216, 34]).copy(frame, 30);
  frame.writeUInt16BE(40_000, 34);
  frame.writeUInt16BE(443, 36);
  frame[46] = 0x50;
  frame[47] = 0x12;

  return pcapForFrame(frame);
}

function dnsPcap(): Buffer {
  const question = Buffer.concat([
    Buffer.from([7]),
    Buffer.from("example"),
    Buffer.from([3]),
    Buffer.from("com"),
    Buffer.from([0, 0, 1, 0, 1]),
  ]);
  const dns = Buffer.alloc(12 + question.length);
  dns.writeUInt16BE(1, 4);
  question.copy(dns, 12);
  const frame = Buffer.alloc(14 + 20 + 8 + dns.length);
  frame.writeUInt16BE(0x0800, 12);
  frame[14] = 0x45;
  frame.writeUInt16BE(20 + 8 + dns.length, 16);
  frame[23] = 17;
  Buffer.from([10, 0, 2, 15]).copy(frame, 26);
  Buffer.from([8, 8, 8, 8]).copy(frame, 30);
  frame.writeUInt16BE(53_000, 34);
  frame.writeUInt16BE(53, 36);
  frame.writeUInt16BE(8 + dns.length, 38);
  dns.copy(frame, 42);
  return pcapForFrame(frame);
}

function vlanIpv6QuicPcap(): Buffer {
  const frame = Buffer.alloc(14 + 4 + 40 + 8);
  frame.writeUInt16BE(0x8100, 12);
  frame.writeUInt16BE(0x0001, 14);
  frame.writeUInt16BE(0x86dd, 16);
  frame[18] = 0x60;
  frame.writeUInt16BE(8, 22);
  frame[24] = 17;
  frame[25] = 64;
  Buffer.from("20010db8000000000000000000000001", "hex").copy(frame, 26);
  Buffer.from("26064700000000000000000000001111", "hex").copy(frame, 42);
  frame.writeUInt16BE(54_321, 58);
  frame.writeUInt16BE(443, 60);
  frame.writeUInt16BE(8, 62);
  return pcapForFrame(frame);
}

function pcapWithTruncatedRecord(): Buffer {
  const complete = tcpPcap();
  const truncatedHeader = Buffer.alloc(16);
  truncatedHeader.writeUInt32LE(2, 0);
  truncatedHeader.writeUInt32LE(32, 8);
  truncatedHeader.writeUInt32LE(32, 12);
  return Buffer.concat([complete, truncatedHeader, Buffer.alloc(4)]);
}

function pcapForFrame(frame: Buffer): Buffer {
  return pcapForFrameWithOptions(frame);
}

function pcapForFrameWithOptions(
  frame: Buffer,
  options: {
    endian?: "little" | "big";
    nanos?: boolean;
    fraction?: number;
    linkType?: number;
  } = {},
): Buffer {
  const endian = options.endian ?? "little";
  const nanos = options.nanos ?? false;
  const pcap = Buffer.alloc(24 + 16 + frame.length);
  const write16 = (value: number, offset: number) =>
    endian === "little" ? pcap.writeUInt16LE(value, offset) : pcap.writeUInt16BE(value, offset);
  const write32 = (value: number, offset: number) =>
    endian === "little" ? pcap.writeUInt32LE(value, offset) : pcap.writeUInt32BE(value, offset);
  const magic = nanos ? 0xa1b23c4d : 0xa1b2c3d4;
  write32(magic, 0);
  write16(2, 4);
  write16(4, 6);
  write32(65_535, 16);
  write32(options.linkType ?? 1, 20);
  write32(1, 24);
  write32(options.fraction ?? 0, 28);
  write32(frame.length, 32);
  write32(frame.length, 36);
  frame.copy(pcap, 40);
  return pcap;
}

function pcapWithManyFrames(count: number): Buffer {
  const frame = tcpPcap().subarray(40);
  const recordLength = 16 + frame.length;
  const pcap = Buffer.alloc(24 + count * recordLength);
  pcap.writeUInt32LE(0xa1b2c3d4, 0);
  pcap.writeUInt16LE(2, 4);
  pcap.writeUInt16LE(4, 6);
  pcap.writeUInt32LE(65_535, 16);
  pcap.writeUInt32LE(1, 20);
  for (let index = 0; index < count; index += 1) {
    const offset = 24 + index * recordLength;
    pcap.writeUInt32LE(index + 1, offset);
    pcap.writeUInt32LE(0, offset + 4);
    pcap.writeUInt32LE(frame.length, offset + 8);
    pcap.writeUInt32LE(frame.length, offset + 12);
    frame.copy(pcap, offset + 16);
  }
  return pcap;
}

function pcapWithOversizedRecord(): Buffer {
  const pcap = pcapForFrame(Buffer.alloc(0));
  pcap.writeUInt32LE(16 * 1024 * 1024 + 1, 32);
  pcap.writeUInt32LE(16 * 1024 * 1024 + 1, 36);
  return pcap;
}

function pcapBeyondAnalysisBound(): Buffer {
  const pcap = Buffer.alloc(16 * 1024 * 1024 + 1);
  pcap.writeUInt32LE(0xa1b2c3d4, 0);
  pcap.writeUInt16LE(2, 4);
  pcap.writeUInt16LE(4, 6);
  pcap.writeUInt32LE(65_535, 16);
  pcap.writeUInt32LE(1, 20);
  pcap.writeUInt32LE(1, 24);
  pcap.writeUInt32LE(16 * 1024 * 1024, 32);
  pcap.writeUInt32LE(16 * 1024 * 1024, 36);
  return pcap;
}

function runtime(
  directory: string,
  commands: string[][],
  now: number,
): AndroidEmulatorNetworkCaptureRuntime {
  return {
    now: () => now,
    resolveAvdDirectory: async () => directory,
    readLocalAddresses: async () => ["10.0.2.15"],
    execAdb: async (args) => {
      commands.push(args);
      return { stdout: "OK\n", stderr: "" };
    },
  };
}

test("captures one bounded emulator Run window and deletes transient packet bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-"));
  const commands: string[][] = [];
  try {
    const stalePath = join(directory, "console_out", "relay-0123456789abcdef01234567.pcap");
    await mkdir(join(directory, "console_out"), { recursive: true });
    await writeFile(stalePath, "stale packet bytes");
    await utimes(stalePath, 0, 0);
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-1", serial: "emulator-5554", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await assert.rejects(stat(stalePath));
    await writeFile(handle.sourcePath, tcpPcap());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );

    assert.deepEqual(commands, [
      ["-s", "emulator-5554", "emu", "network", "capture", "start", handle.fileName],
      ["-s", "emulator-5554", "emu", "network", "capture", "stop"],
    ]);
    assert.equal(result.summary.coverage, "partial");
    assert.equal(result.summary.scope, "entire-emulator");
    assert.equal(result.summary.packets, 1);
    assert.equal(result.summary.flows[0]?.protocol, "tls");
    assert.equal(result.summary.flows[0]?.host, undefined);
    assert.equal(result.summary.rawCapture.status, "not-requested");
    assert.equal(result.summary.rawCapture.retention, "ephemeral");
    await assert.rejects(stat(handle.sourcePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reaps only stale Relay PCAP files and preserves foreign or non-file entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-emulator-network-reaper-"));
  const directory = join(root, "console_out");
  try {
    await mkdir(directory, { recursive: true });
    const stale = "relay-0123456789abcdef01234567.pcap";
    const foreign = "capture.pcap";
    const malformed = "relay-0123456789abcdef0123456.pcap";
    const nested = "relay-fedcba9876543210fedcba98.pcap";
    const fresh = "relay-bbbbbbbbbbbbbbbbbbbbbbbb.pcap";
    await writeFile(join(directory, stale), "stale");
    await utimes(join(directory, stale), 0, 0);
    await writeFile(join(directory, foreign), "foreign");
    await writeFile(join(directory, malformed), "not Relay-owned");
    await writeFile(join(directory, fresh), "fresh");
    await mkdir(join(directory, nested));
    await writeFile(join(root, "symlink-target"), "do not follow");
    await symlink(
      join(root, "symlink-target"),
      join(directory, "relay-aaaaaaaaaaaaaaaaaaaaaaaa.pcap"),
    );

    assert.deepEqual(await reapStaleAndroidEmulatorNetworkCaptures(directory), [stale]);
    await assert.rejects(stat(join(directory, stale)));
    assert.equal((await stat(join(directory, foreign))).isFile(), true);
    assert.equal((await stat(join(directory, malformed))).isFile(), true);
    assert.equal((await stat(join(directory, fresh))).isFile(), true);
    assert.equal((await stat(join(directory, nested))).isDirectory(), true);
    assert.equal(
      (await stat(join(directory, "relay-aaaaaaaaaaaaaaaaaaaaaaaa.pcap"))).isFile(),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reaper protects the active capture while clearing a prior process's file", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-emulator-network-reaper-active-"));
  const commands: string[][] = [];
  try {
    const captureRuntime = runtime(root, commands, 1_000);
    const active = await startAndroidEmulatorNetworkCapture(
      { runId: "reaper-active", serial: "emulator-5564", avdName: "medium_phone" },
      captureRuntime,
    );
    const stalePath = join(root, "console_out", "relay-0123456789abcdef01234567.pcap");
    await writeFile(active.sourcePath, tcpPcap());
    await writeFile(stalePath, "stale");
    await utimes(stalePath, 0, 0);

    assert.deepEqual(await reapStaleAndroidEmulatorNetworkCaptures(join(root, "console_out")), [
      "relay-0123456789abcdef01234567.pcap",
    ]);
    assert.equal((await stat(active.sourcePath)).isFile(), true);
    await stopAndroidEmulatorNetworkCapture(active, {}, runtime(root, commands, 2_000));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup sweep reaps stale captures across configured AVD directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-emulator-network-startup-reaper-"));
  try {
    const avd = join(root, "phone.avd", "console_out");
    await mkdir(avd, { recursive: true });
    const stalePath = join(avd, "relay-0123456789abcdef01234567.pcap");
    await writeFile(stalePath, "stale");
    await utimes(stalePath, 0, 0);
    await writeFile(join(avd, "capture.pcap"), "foreign");

    assert.equal(await reapStaleAndroidEmulatorNetworkCapturesAtStartup(root), 1);
    await assert.rejects(stat(join(avd, "relay-0123456789abcdef01234567.pcap")));
    assert.equal((await stat(join(avd, "capture.pcap"))).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains private raw PCAP only with explicit network-raw consent and an owned destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-raw-"));
  const runDirectory = join(directory, "run");
  const rawPath = join(runDirectory, "network", "capture.pcap");
  try {
    await mkdir(runDirectory, { recursive: true });
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-raw", serial: "emulator-5556", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, tcpPcap());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {
        retainRawPath: rawPath,
        rawArtifact: "network/capture.pcap",
        rawConsent: { grantedAt: 1, grantedBy: "human:test", reason: "fixture" },
      },
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.rawPath, rawPath);
    assert.deepEqual(result.summary.rawCapture, {
      status: "captured",
      retention: "retained",
      artifact: { path: "network/capture.pcap", bytes: tcpPcap().byteLength },
      bytes: tcpPcap().byteLength,
    });
    assert.deepEqual(await readFile(rawPath), tcpPcap());
    assert.equal((await stat(rawPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps packet capture ephemeral when raw consent is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-ephemeral-"));
  const rawPath = join(directory, "run", "network", "capture.pcap");
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-ephemeral", serial: "emulator-5574", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, tcpPcap());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      { retainRawPath: rawPath, rawArtifact: "network/capture.pcap" },
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.rawPath, undefined);
    assert.equal(result.summary.rawCapture.status, "denied");
    assert.equal(result.summary.rawCapture.retention, "ephemeral");
    assert.match(result.summary.rawCapture.reason ?? "", /explicit network-raw consent/u);
    await assert.rejects(stat(rawPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summarizes DNS transport facts without promoting them to HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-dns-"));
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-dns", serial: "emulator-5557", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, dnsPcap());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );

    assert.deepEqual(result.summary.domains, ["example.com"]);
    assert.equal(result.summary.flows[0]?.protocol, "dns");
    assert.equal(result.summary.flows[0]?.host, "example.com");
    assert.equal("method" in result.summary.flows[0]!, false);
    assert.equal("status" in result.summary.flows[0]!, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("summarizes VLAN-tagged IPv6 QUIC traffic without inventing HTTP fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-ipv6-"));
  try {
    const commands: string[][] = [];
    const captureRuntime = {
      ...runtime(directory, commands, 1_000),
      readLocalAddresses: async () => ["2001:db8::1"],
    };
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-ipv6", serial: "emulator-5563", avdName: "medium_phone" },
      captureRuntime,
    );
    await writeFile(handle.sourcePath, vlanIpv6QuicPcap());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      {
        ...captureRuntime,
        now: () => 2_000,
      },
    );

    assert.equal(result.summary.packets, 1);
    assert.equal(result.summary.flows[0]?.protocol, "quic");
    assert.equal(result.summary.flows[0]?.remoteAddress, "2606:4700::1111");
    assert.equal(result.summary.flows[0]?.port, 443);
    assert.equal(result.summary.flows[0]?.sentBytes, 66);
    assert.equal("method" in result.summary.flows[0]!, false);
    assert.equal("headers" in result.summary.flows[0]!, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts big-endian nanosecond PCAP timestamps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-pcap-endian-"));
  try {
    const commands: string[][] = [];
    const frame = tcpPcap().subarray(40);
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-big-endian", serial: "emulator-5566", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(
      handle.sourcePath,
      pcapForFrameWithOptions(frame, {
        endian: "big",
        nanos: true,
        fraction: 500_000_000,
      }),
    );
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.summary.packets, 1);
    assert.equal(result.summary.flows[0]?.protocol, "tls");
    assert.equal(result.summary.flows[0]?.startedAtMs, 500);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("marks an incomplete PCAP record as dropped instead of trusting partial bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-truncated-record-"));
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-truncated-record", serial: "emulator-5565", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, pcapWithTruncatedRecord());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.summary.packets, 1);
    assert.equal(result.summary.dropped, 1);
    assert.equal(result.summary.coverage, "partial");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounds oversized records before allocating or trusting their payload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-pcap-bound-"));
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-oversized-record", serial: "emulator-5567", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, pcapWithOversizedRecord());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.summary.packets, 0);
    assert.equal(result.summary.dropped, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounds transient PCAP reads and labels consented raw output as truncated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-pcap-file-bound-"));
  const rawPath = join(directory, "run", "network", "capture.pcap");
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-file-bound", serial: "emulator-5570", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, pcapBeyondAnalysisBound());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {
        retainRawPath: rawPath,
        rawArtifact: "network/capture.pcap",
        rawConsent: { grantedAt: 1, grantedBy: "human:test", reason: "fixture" },
      },
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.summary.rawCapture.status, "truncated");
    assert.equal(result.summary.rawCapture.bytes, 16 * 1024 * 1024);
    assert.equal(result.summary.dropped, 1);
    assert.match(result.summary.limitations.join(" "), /16 MiB analysis bound/u);
    assert.equal((await stat(rawPath)).size, 16 * 1024 * 1024);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("caps parsed packets and reports the overflow as dropped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-pcap-packet-bound-"));
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-many-packets", serial: "emulator-5568", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, pcapWithManyFrames(100_001));
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.summary.packets, 100_000);
    assert.equal(result.summary.dropped, 1);
    assert.equal(result.summary.flows.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retains unsupported link types as typed partial packet parse failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-pcap-link-"));
  try {
    const commands: string[][] = [];
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "run-link-type", serial: "emulator-5569", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, pcapForFrameWithOptions(Buffer.alloc(0), { linkType: 101 }));
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      runtime(directory, commands, 2_000),
    );
    assert.equal(result.summary.source.kind, "emulator-packet");
    assert.equal(result.summary.coverage, "partial");
    assert.equal(result.summary.parseFailure?.kind, "packet-parse-failure");
    assert.match(result.summary.parseFailure?.message ?? "", /link type 101 is unsupported/u);
    await assert.rejects(stat(handle.sourcePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed capture bytes remain typed partial, clean up, and release ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-invalid-"));
  try {
    const commands: string[][] = [];
    const captureRuntime = runtime(directory, commands, 1_000);
    const first = await startAndroidEmulatorNetworkCapture(
      { runId: "invalid-1", serial: "emulator-5562", avdName: "medium_phone" },
      captureRuntime,
    );
    await writeFile(first.sourcePath, "not a packet capture");
    const malformed = await stopAndroidEmulatorNetworkCapture(first, {}, captureRuntime);
    assert.equal(malformed.summary.source.kind, "emulator-packet");
    assert.equal(malformed.summary.coverage, "partial");
    assert.equal(malformed.summary.parseFailure?.kind, "packet-parse-failure");
    assert.match(
      malformed.summary.parseFailure?.message ?? "",
      /no PCAP header|unsupported format/u,
    );
    await assert.rejects(stat(first.sourcePath));

    const second = await startAndroidEmulatorNetworkCapture(
      { runId: "invalid-2", serial: "emulator-5562", avdName: "medium_phone" },
      captureRuntime,
    );
    await writeFile(second.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(second, {}, runtime(directory, commands, 2_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleans a partially created output and releases ownership when start fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-start-failure-"));
  const commands: string[][] = [];
  let attemptedPath: string | undefined;
  try {
    await assert.rejects(
      startAndroidEmulatorNetworkCapture(
        { runId: "start-failure-1", serial: "emulator-5571", avdName: "medium_phone" },
        {
          ...runtime(directory, commands, 1_000),
          execAdb: async (args) => {
            commands.push(args);
            if (args.includes("start")) {
              attemptedPath = join(directory, "console_out", args.at(-1)!);
              await writeFile(attemptedPath!, Buffer.from("partial capture"));
              throw new Error("emulator rejected packet capture");
            }
            return { stdout: "OK\n", stderr: "" };
          },
        },
      ),
      /emulator rejected packet capture/u,
    );
    assert.ok(attemptedPath);
    await assert.rejects(stat(attemptedPath!));

    const retry = await startAndroidEmulatorNetworkCapture(
      { runId: "start-failure-2", serial: "emulator-5571", avdName: "medium_phone" },
      runtime(directory, commands, 2_000),
    );
    await writeFile(retry.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(retry, {}, runtime(directory, commands, 3_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an emulator console KO response even when adb exits successfully", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-console-ko-"));
  const commands: string[][] = [];
  try {
    await assert.rejects(
      startAndroidEmulatorNetworkCapture(
        { runId: "console-ko", serial: "emulator-5573", avdName: "medium_phone" },
        {
          ...runtime(directory, commands, 1_000),
          execAdb: async (args) => {
            commands.push(args);
            return {
              stdout: "KO: capture filename must be bare\n",
              stderr: "",
            };
          },
        },
      ),
      /Android emulator rejected packet capture: KO: capture filename must be bare/u,
    );

    const retry = await startAndroidEmulatorNetworkCapture(
      { runId: "console-ko-retry", serial: "emulator-5573", avdName: "medium_phone" },
      runtime(directory, commands, 2_000),
    );
    await writeFile(retry.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(retry, {}, runtime(directory, commands, 3_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("marks a stop-command failure interrupted while preserving bounded packet facts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-stop-failure-"));
  const commands: string[][] = [];
  try {
    const handle = await startAndroidEmulatorNetworkCapture(
      { runId: "stop-failure", serial: "emulator-5572", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await writeFile(handle.sourcePath, tcpPcap());
    const result = await stopAndroidEmulatorNetworkCapture(
      handle,
      {},
      {
        ...runtime(directory, commands, 2_000),
        execAdb: async (args) => {
          commands.push(args);
          if (args.at(-1) === "stop") throw new Error("emulator console stop timed out");
          return { stdout: "OK\n", stderr: "" };
        },
      },
    );

    assert.equal(result.summary.coverage, "interrupted");
    assert.equal(result.summary.packets, 1);
    assert.match(result.summary.limitations.join(" "), /packet capture stop command failed/u);
    await assert.rejects(stat(handle.sourcePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses physical targets and concurrent capture ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-owner-"));
  try {
    await assert.rejects(
      startAndroidEmulatorNetworkCapture(
        { runId: "physical", serial: "R5CW123", avdName: "medium_phone" },
        runtime(directory, [], 1_000),
      ),
      /requires one Android emulator/u,
    );
    const commands: string[][] = [];
    const first = await startAndroidEmulatorNetworkCapture(
      { runId: "owner-1", serial: "emulator-5558", avdName: "medium_phone" },
      runtime(directory, commands, 1_000),
    );
    await assert.rejects(
      startAndroidEmulatorNetworkCapture(
        { runId: "owner-2", serial: "emulator-5558", avdName: "medium_phone" },
        runtime(directory, [], 1_000),
      ),
      /already has a Relay packet capture/u,
    );
    await writeFile(first.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(first, {}, runtime(directory, commands, 2_000));

    const second = await startAndroidEmulatorNetworkCapture(
      { runId: "owner-2", serial: "emulator-5558", avdName: "medium_phone" },
      runtime(directory, commands, 3_000),
    );
    const commandsBeforeStaleStop = commands.length;
    await assert.rejects(
      stopAndroidEmulatorNetworkCapture(first, {}, runtime(directory, commands, 3_500)),
      /no longer owned by Run owner-1/u,
    );
    assert.equal(commands.length, commandsBeforeStaleStop);
    await writeFile(second.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(second, {}, runtime(directory, commands, 4_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reserves one emulator atomically before asynchronous capture startup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-race-"));
  const commands: string[][] = [];
  try {
    const captureRuntime = runtime(directory, commands, 1_000);
    const [first, second] = await Promise.all([
      startAndroidEmulatorNetworkCapture(
        { runId: "race-1", serial: "emulator-5560", avdName: "medium_phone" },
        captureRuntime,
      )
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason: unknown) => ({ status: "rejected" as const, reason })),
      startAndroidEmulatorNetworkCapture(
        { runId: "race-2", serial: "emulator-5560", avdName: "medium_phone" },
        captureRuntime,
      )
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason: unknown) => ({ status: "rejected" as const, reason })),
    ]);
    const winner = first.status === "fulfilled" ? first : second;
    const loser = first.status === "rejected" ? first : second;
    assert.equal(winner.status, "fulfilled");
    assert.equal(loser.status, "rejected");
    assert.match(String(loser.reason), /already has a Relay packet capture/u);
    assert.equal(commands.filter((command) => command.includes("start")).length, 1);

    await writeFile(winner.value.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(winner.value, {}, runtime(directory, commands, 2_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps a serial reserved while its packet capture stop is in flight", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-stop-race-"));
  const commands: string[][] = [];
  let releaseStop!: () => void;
  let markStopStarted!: () => void;
  const stopStarted = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const stopEntered = new Promise<void>((resolve) => {
    markStopStarted = resolve;
  });
  try {
    const captureRuntime = runtime(directory, commands, 1_000);
    const first = await startAndroidEmulatorNetworkCapture(
      { runId: "stop-race-1", serial: "emulator-5561", avdName: "medium_phone" },
      captureRuntime,
    );
    await writeFile(first.sourcePath, tcpPcap());

    const stopping = stopAndroidEmulatorNetworkCapture(
      first,
      {},
      {
        ...captureRuntime,
        execAdb: async (args) => {
          commands.push(args);
          if (args.at(-1) === "stop") {
            markStopStarted();
            await stopStarted;
          }
          return { stdout: "OK\n", stderr: "" };
        },
      },
    );
    const second = startAndroidEmulatorNetworkCapture(
      { runId: "stop-race-2", serial: "emulator-5561", avdName: "medium_phone" },
      captureRuntime,
    ).then(
      () => ({ status: "fulfilled" as const }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    const [, startResult] = await Promise.all([stopEntered, second]);
    assert.equal(startResult.status, "rejected");
    assert.match(String(startResult.reason), /already has a Relay packet capture/u);
    releaseStop();
    await stopping;

    const next = await startAndroidEmulatorNetworkCapture(
      { runId: "stop-race-2", serial: "emulator-5561", avdName: "medium_phone" },
      captureRuntime,
    );
    await writeFile(next.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(next, {}, runtime(directory, commands, 2_000));
  } finally {
    releaseStop();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "writes a live emulator console capture to the resolved AVD output path",
  {
    skip:
      liveSerial && liveAvdName
        ? false
        : "set RELAY_ANDROID_EMULATOR_CAPTURE_LIVE_SERIAL and RELAY_ANDROID_EMULATOR_CAPTURE_LIVE_AVD",
  },
  async () => {
    if (!liveSerial || !liveAvdName) return;
    const avdDirectory = await resolveAndroidAvdDirectory(liveAvdName);
    const handle = await startAndroidEmulatorNetworkCapture({
      runId: `live-path-${randomUUID()}`,
      serial: liveSerial,
      avdName: liveAvdName,
    });
    let stopped = false;
    try {
      await delay(250);
      assert.equal(dirname(handle.sourcePath), join(avdDirectory, "console_out"));
      assert.equal((await stat(handle.sourcePath)).isFile(), true);
      const result = await stopAndroidEmulatorNetworkCapture(handle);
      stopped = true;
      assert.deepEqual(result.summary.source, {
        kind: "emulator-packet",
        backend: "android-emulator-console",
      });
      await assert.rejects(stat(handle.sourcePath), /ENOENT/u);
    } finally {
      if (!stopped) await stopAndroidEmulatorNetworkCapture(handle).catch(() => undefined);
    }
  },
);
