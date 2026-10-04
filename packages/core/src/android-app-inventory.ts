import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execAndroidAdb } from "./android-adb-host.js";

const PROTOCOL = "relay-android-app-inventory-v1";
const PACKAGE = "dev.relay.appinventory";
const RUNNER = `${PACKAGE}/.InstalledAppsInstrumentation`;
const ASSET = "relay-android-app-inventory-1.0.0";
const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_CHUNKS = MAX_PAYLOAD_BYTES / 2048;

/** Accept complete, bounded helper output only. Package identities still come
 * from the canonical launcher inventory, never from this optional enrichment. */
export function parseAndroidApplicationLabels(output: string): Map<string, string> | undefined {
  if (Buffer.byteLength(output) > 4 * 1024 * 1024) return undefined;
  const chunks = new Map<number, Buffer>();
  let expected: number | undefined;
  let record: Record<string, string> = {};
  let ok = false;
  let completed = false;
  let invalid = false;
  const flush = () => {
    const metadataMatches =
      record.relayProtocol === PROTOCOL && record.outputFormat === "application-labels-json";
    if (metadataMatches && record.payloadBase64 !== undefined) {
      const index = Number(record.chunkIndex);
      const count = Number(record.chunkCount);
      const payload = Buffer.from(record.payloadBase64, "base64");
      if (
        !Number.isInteger(index) ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > MAX_CHUNKS ||
        index < 0 ||
        index >= count ||
        chunks.has(index) ||
        (expected !== undefined && expected !== count) ||
        payload.length < 1 ||
        payload.length > 2048 ||
        payload.toString("base64") !== record.payloadBase64
      ) {
        invalid = true;
      } else {
        expected = count;
        chunks.set(index, payload);
      }
    }
    if (metadataMatches && record.ok === "true") ok = true;
    record = {};
  };
  for (const line of output.split(/\r?\n/u)) {
    if (
      line.startsWith("INSTRUMENTATION_STATUS: ") ||
      line.startsWith("INSTRUMENTATION_RESULT: ")
    ) {
      const body = line.slice(line.indexOf(": ") + 2);
      const equals = body.indexOf("=");
      if (equals > 0) record[body.slice(0, equals)] = body.slice(equals + 1);
    } else if (line.startsWith("INSTRUMENTATION_STATUS_CODE:")) {
      flush();
    } else if (line.startsWith("INSTRUMENTATION_CODE:")) {
      completed = /^INSTRUMENTATION_CODE:\s*0\s*$/u.test(line);
      flush();
    }
  }
  if (invalid || !ok || !completed || expected === undefined || chunks.size !== expected) {
    return undefined;
  }
  try {
    const payload = Buffer.concat(
      Array.from({ length: expected }, (_, index) => chunks.get(index)!),
    );
    if (payload.length > MAX_PAYLOAD_BYTES) return undefined;
    const rows: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    if (!Array.isArray(rows) || rows.length > 2048) return undefined;
    const labels = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const { package: packageName, name } = row;
      if (
        typeof packageName !== "string" ||
        packageName.length > 255 ||
        !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/u.test(packageName) ||
        typeof name !== "string" ||
        name.length > 256
      )
        continue;
      const label = name.replace(/\s+/gu, " ").trim();
      if (!label || label === packageName || /\p{Cc}/u.test(label) || ambiguous.has(packageName))
        continue;
      if (labels.has(packageName) && labels.get(packageName) !== label) {
        labels.delete(packageName);
        ambiguous.add(packageName);
      } else labels.set(packageName, label);
    }
    return labels;
  } catch {
    return undefined;
  }
}

async function bundledInventoryHelper(): Promise<
  { apkPath: string; versionName: string } | undefined
> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  for (const directory of [
    join(moduleDirectory, "..", "android-helpers", "app-inventory"),
    join(moduleDirectory, "android-helpers", "app-inventory"),
  ]) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, `${ASSET}.manifest.json`), "utf8"),
      );
      const apkPath = join(directory, `${ASSET}.apk`);
      if (
        manifest.assetName === `${ASSET}.apk` &&
        manifest.packageName === PACKAGE &&
        manifest.instrumentationRunner === RUNNER &&
        manifest.statusProtocol === PROTOCOL &&
        typeof manifest.sourceSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(manifest.sourceSha256) &&
        manifest.versionName === `1.0.0-${manifest.sourceSha256.slice(0, 12)}` &&
        createHash("sha256")
          .update(await readFile(apkPath))
          .digest("hex") === manifest.sha256
      )
        return { apkPath, versionName: manifest.versionName };
    } catch {
      // The source checkout and packaged server have different asset roots.
    }
  }
  return undefined;
}

/** Labels are observed afresh so locale changes and app updates cannot reuse
 * stale names. The isolated helper has no launcher, Activity, or UiAutomation. */
export async function readAndroidApplicationLabels(
  serial: string,
  execute: typeof execAndroidAdb = execAndroidAdb,
): Promise<Map<string, string> | undefined> {
  try {
    const helper = await bundledInventoryHelper();
    if (!helper) return undefined;
    const installed = await execute(["-s", serial, "shell", "dumpsys", "package", PACKAGE], {
      timeout: 2_000,
      maxBuffer: 256 * 1024,
    });
    const versionName = /^\s*versionName=(\S+)\s*$/mu.exec(installed.stdout)?.[1];
    if (versionName !== helper.versionName) {
      await execute(["-s", serial, "install", "-r", "-t", helper.apkPath], {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      });
    }
    const { stdout } = await execute(["-s", serial, "shell", "am", "instrument", "-w", RUNNER], {
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseAndroidApplicationLabels(stdout);
  } catch {
    // Metadata is optional; an unavailable helper must not hide launchable apps.
    return undefined;
  }
}
