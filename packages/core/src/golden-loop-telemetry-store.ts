/**
 * Local-only golden-loop telemetry sink.
 *
 * Events are privacy-safe protocol records. Journey and project identities
 * are salted pseudonyms; the store refuses raw labels, serials, or paths.
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  GOLDEN_LOOP_MAX_EVENTS,
  GOLDEN_LOOP_RETENTION_MS,
  parseGoldenLoopTelemetryEvent,
  parseGoldenLoopTelemetryStore,
  projectGoldenLoopTelemetry,
  type GoldenLoopTelemetryEvent,
  type GoldenLoopTelemetryReport,
  type GoldenLoopTelemetryStore,
} from "@relay/protocol";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type GoldenLoopTelemetryRecordInput = DistributiveOmit<
  GoldenLoopTelemetryEvent,
  "schemaVersion" | "sequence" | "projectScopeId" | "journeyId" | "at"
> & {
  projectKey: string;
  journeyKey: string;
  at?: number;
};

export type GoldenLoopTelemetrySink = {
  record(event: GoldenLoopTelemetryRecordInput): GoldenLoopTelemetryEvent;
  report(now?: number): GoldenLoopTelemetryReport;
  store(): GoldenLoopTelemetryStore;
};

function saltPath(root: string): string {
  return join(root, ".relay", "golden-loop.salt");
}

function storePath(root: string): string {
  return join(root, ".relay", "golden-loop.json");
}

function readOrCreateSalt(root: string): string {
  const path = saltPath(root);
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (/^[a-f0-9]{64}$/u.test(existing)) return existing;
  } catch {
    // Create below.
  }
  mkdirSync(dirname(path), { recursive: true });
  const salt = randomBytes(32).toString("hex");
  writeFileSync(path, `${salt}\n`, { mode: 0o600 });
  return salt;
}

export function goldenLoopPseudonym(salt: string, key: string): `local:${string}` {
  return `local:${createHmac("sha256", salt).update(key).digest("hex")}`;
}

function loadStore(path: string, now: number): GoldenLoopTelemetryStore {
  try {
    const parsed = parseGoldenLoopTelemetryStore(JSON.parse(readFileSync(path, "utf8")));
    const cutoff = now - GOLDEN_LOOP_RETENTION_MS;
    return {
      ...parsed,
      events: parsed.events.filter((event) => event.at >= cutoff).slice(-GOLDEN_LOOP_MAX_EVENTS),
    };
  } catch {
    return { schemaVersion: 1, createdAt: now, events: [] };
  }
}

export function createGoldenLoopTelemetrySink(root: string): GoldenLoopTelemetrySink {
  const salt = readOrCreateSalt(root);
  const path = storePath(root);
  let current = loadStore(path, Date.now());

  const persist = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(current)}\n`, { mode: 0o600 });
  };

  return {
    record(input) {
      const now = input.at ?? Date.now();
      current = loadStore(path, now);
      const { projectKey, journeyKey, at: _at, ...payload } = input;
      const event = parseGoldenLoopTelemetryEvent({
        ...payload,
        schemaVersion: 1,
        sequence: (current.events.at(-1)?.sequence ?? 0) + 1,
        at: now,
        projectScopeId: goldenLoopPseudonym(salt, projectKey),
        journeyId: goldenLoopPseudonym(salt, journeyKey),
      });
      current = {
        ...current,
        events: [...current.events, event].slice(-GOLDEN_LOOP_MAX_EVENTS),
      };
      persist();
      return event;
    },
    report(now = Date.now()) {
      current = loadStore(path, now);
      return projectGoldenLoopTelemetry(current.events, now);
    },
    store() {
      current = loadStore(path, Date.now());
      return current;
    },
  };
}
