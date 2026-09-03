import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  startAndroidEmulatorNetworkCapture,
  stopAndroidEmulatorNetworkCapture,
  type AndroidEmulatorNetworkCaptureRuntime,
} from "./android-emulator-network-capture.js";

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

function pcapForFrame(frame: Buffer): Buffer {
  const pcap = Buffer.alloc(24 + 16 + frame.length);
  pcap.writeUInt32LE(0xa1b2c3d4, 0);
  pcap.writeUInt16LE(2, 4);
  pcap.writeUInt16LE(4, 6);
  pcap.writeUInt32LE(65_535, 16);
  pcap.writeUInt32LE(1, 20);
  pcap.writeUInt32LE(1, 24);
  pcap.writeUInt32LE(0, 28);
  pcap.writeUInt32LE(frame.length, 32);
  pcap.writeUInt32LE(frame.length, 36);
  frame.copy(pcap, 40);
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
    await assert.rejects(stat(handle.sourcePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retains private raw PCAP only when an owned destination is explicitly supplied", async () => {
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
      { retainRawPath: rawPath, rawArtifact: "network/capture.pcap" },
      runtime(directory, commands, 2_000),
    );

    assert.equal(result.rawPath, rawPath);
    assert.deepEqual(result.summary.rawCapture, {
      status: "captured",
      artifact: { path: "network/capture.pcap", bytes: tcpPcap().byteLength },
      bytes: tcpPcap().byteLength,
    });
    assert.deepEqual(await readFile(rawPath), tcpPcap());
    assert.equal((await stat(rawPath)).mode & 0o777, 0o600);
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

test("malformed capture bytes fail closed, clean up, and release ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-emulator-network-invalid-"));
  try {
    const commands: string[][] = [];
    const captureRuntime = runtime(directory, commands, 1_000);
    const first = await startAndroidEmulatorNetworkCapture(
      { runId: "invalid-1", serial: "emulator-5562", avdName: "medium_phone" },
      captureRuntime,
    );
    await writeFile(first.sourcePath, "not a packet capture");
    await assert.rejects(
      stopAndroidEmulatorNetworkCapture(first, {}, captureRuntime),
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
    const results = await Promise.allSettled([
      startAndroidEmulatorNetworkCapture(
        { runId: "race-1", serial: "emulator-5560", avdName: "medium_phone" },
        captureRuntime,
      ),
      startAndroidEmulatorNetworkCapture(
        { runId: "race-2", serial: "emulator-5560", avdName: "medium_phone" },
        captureRuntime,
      ),
    ]);
    const winner = results.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof startAndroidEmulatorNetworkCapture>>
      > => result.status === "fulfilled",
    );
    const loser = results.find((result) => result.status === "rejected");
    assert.ok(winner);
    assert.ok(loser);
    assert.match(String(loser.reason), /already has a Relay packet capture/u);
    assert.equal(commands.filter((command) => command.includes("start")).length, 1);

    await writeFile(winner.value.sourcePath, tcpPcap());
    await stopAndroidEmulatorNetworkCapture(winner.value, {}, runtime(directory, commands, 2_000));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
