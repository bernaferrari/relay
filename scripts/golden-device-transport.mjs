import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fail, isRecord, requiredString } from "./golden-device-contract.mjs";

function withoutBase64(value) {
  if (!isRecord(value)) return value;
  const { base64: _base64, ...rest } = value;
  return rest;
}

/** Artifact writer deliberately writes only under the configured artifact root. */
export class GoldenArtifactWriter {
  constructor(root) {
    this.root = resolve(root);
    this.events = [];
  }

  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  outputPath(relativePath) {
    const output = resolve(this.root, relativePath);
    if (!output.startsWith(`${this.root}${sep}`)) {
      fail("Golden artifact path escaped its root", "GOLDEN_ARTIFACT_PATH_INVALID");
    }
    return output;
  }

  async json(relativePath, value) {
    const output = this.outputPath(relativePath);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async screenshot(relativePath, screenshot) {
    if (!isRecord(screenshot) || typeof screenshot.base64 !== "string" || !screenshot.base64) {
      fail("Golden screenshot capture returned no pixels", "GOLDEN_SCREENSHOT_MISSING");
    }
    const bytes = Buffer.from(screenshot.base64, "base64");
    if (!bytes.byteLength) fail("Golden screenshot capture was empty", "GOLDEN_SCREENSHOT_MISSING");
    const output = this.outputPath(relativePath);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, bytes, { mode: 0o600 });
    await this.json(`${relativePath}.json`, withoutBase64(screenshot));
  }

  event(name, details = {}) {
    this.events.push({ at: Date.now(), name, ...details });
  }

  async manifest(value) {
    await this.json("manifest.json", { ...value, events: this.events });
  }
}

export function createGoldenApi(options) {
  const baseUrl = requiredString(options?.baseUrl, "Relay URL").replace(/\/+$/, "");
  const actorId = options?.actorId?.trim() || "system:golden-device";
  const actorKind = options?.actorKind?.trim() || "system";
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const fetcher = options?.fetch ?? fetch;
  return {
    async request({ operationId, method = "GET", path, body }) {
      const headers = {
        Accept: "application/json",
        "X-Relay-Actor-Id": actorId,
        "X-Relay-Actor-Kind": actorKind,
        "X-Relay-Operation-Id": operationId,
        "X-Relay-Request-Id": randomUUID(),
        "X-Relay-Command-At": String(Date.now()),
        "Idempotency-Key": randomUUID(),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      };
      let response;
      try {
        response = await fetcher(`${baseUrl}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // A fetch exception can contain the complete URL, including the
        // fixture serial. Keep detailed transport diagnostics in the
        // restricted server artifact rather than repeating them in CI logs.
        fail(`Relay request ${operationId} could not reach Relay`, "GOLDEN_RELAY_UNREACHABLE");
      }
      const text = await response.text();
      let value;
      try {
        value = text ? JSON.parse(text) : undefined;
      } catch {
        value = { raw: text };
      }
      if (!response.ok) {
        fail(
          `Relay request ${operationId} returned HTTP ${response.status}; inspect restricted acceptance evidence for details.`,
          "GOLDEN_RELAY_REQUEST_FAILED",
        );
      }
      return value;
    },
  };
}
