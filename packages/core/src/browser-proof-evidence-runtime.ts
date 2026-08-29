import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BROWSER_PROOF_REQUIRED_CHANNELS,
  parseBrowserProofEvidence,
  type BrowserProofEvidence,
  type BrowserProofEvidenceChannel,
  type BrowserProofEvidenceChannelRecord,
  type BrowserCaseProfile,
} from "@relay/protocol";
import { browserProofRuntimeForTarget, type BrowserProofRuntime } from "./browser-proof-runtime.js";

type CaptureInput = Readonly<{
  targetId: string;
  runId: string;
  targetProfileId: string;
  sourceSha: string;
  artifactDigest: string;
  environment: BrowserCaseProfile;
  runDir: string;
}>;

type CapturedFile = Readonly<{
  path: string;
  bytes: number;
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 512);
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function channel(
  status: BrowserProofEvidenceChannelRecord["status"],
  file?: CapturedFile,
  message?: string,
  dropped = 0,
): BrowserProofEvidenceChannelRecord {
  return {
    status,
    entries: file ? 1 : 0,
    bytes: file?.bytes ?? 0,
    dropped,
    redactions: 0,
    artifactRefs: file ? [file.path] : [],
    ...(message ? { message } : {}),
  };
}

async function fileAfter(path: string, write: () => Promise<void>): Promise<CapturedFile> {
  await write();
  const info = await stat(path);
  if (!info.isFile()) throw new Error("browser evidence artifact is not a file");
  return { path, bytes: info.size };
}

function relativeArtifactPath(name: string): string {
  return `browser/${name}`;
}

function absoluteArtifactPath(runDir: string, path: string): string {
  return join(runDir, ...path.split("/"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

function networkSummary(runtime: BrowserProofRuntime) {
  const statusCodes: Record<string, number> = {};
  let failedRequests = 0;
  let pendingRequests = 0;
  for (const entry of runtime.network) {
    if (entry.status === undefined && !entry.failed) pendingRequests += 1;
    if (entry.status !== undefined) {
      const key = String(entry.status);
      statusCodes[key] = (statusCodes[key] ?? 0) + 1;
    }
    // A Playwright requestfailed event has no HTTP status and must remain
    // distinguishable from an HTTP 4xx/5xx response in the raw artifact.
    if (entry.failed === true || (entry.status !== undefined && entry.status >= 400)) {
      failedRequests += 1;
    }
  }
  return {
    requests: runtime.network.length,
    failedRequests,
    pendingRequests,
    statusCodes,
  };
}

/** Collect the Playwright proof session into Run-local files and one strict
 * envelope. A channel is captured only after its bytes are written; every
 * collector failure becomes an explicit partial channel, never a green claim. */
export async function captureBrowserProofEvidence(
  input: CaptureInput,
): Promise<BrowserProofEvidence> {
  const runtime = await browserProofRuntimeForTarget(input.targetId);
  if (!sameValue(runtime.profile, input.environment)) {
    throw new Error("Playwright proof environment differs from the frozen Run profile");
  }
  const channels = {} as Record<BrowserProofEvidenceChannel, BrowserProofEvidenceChannelRecord>;
  const payloads: {
    consoleErrors?: BrowserProofEvidence["consoleErrors"];
    pageErrors?: BrowserProofEvidence["pageErrors"];
    networkSummary?: BrowserProofEvidence["networkSummary"];
    traceReference?: BrowserProofEvidence["traceReference"];
    popupTopology?: BrowserProofEvidence["popupTopology"];
  } = {};
  const artifact = (name: string) => relativeArtifactPath(name);
  const write = async (path: string, operation: () => Promise<void>) => {
    const file = await fileAfter(absoluteArtifactPath(input.runDir, path), operation);
    // Persist portable Run-relative references. The collector may use an
    // absolute path to write bytes, but TracePack closure must never expose
    // the host's temporary/workspace directory.
    return { path, bytes: file.bytes };
  };
  const capture = async (
    name: BrowserProofEvidenceChannel,
    path: string,
    operation: () => Promise<void>,
    dropped = 0,
  ): Promise<CapturedFile | undefined> => {
    try {
      return await write(path, operation);
    } catch (error) {
      channels[name] = channel("partial", undefined, messageOf(error), dropped);
      return undefined;
    }
  };

  const screenshotPath = artifact("checkpoint.png");
  const screenshot = await capture("screenshot", screenshotPath, () =>
    runtime.screenshot(absoluteArtifactPath(input.runDir, screenshotPath)),
  );
  if (screenshot) channels.screenshot = channel("captured", screenshot);

  const accessibilityPath = artifact("accessibility.json");
  let accessibility: string | undefined;
  const accessibilityFile = await capture("accessibility", accessibilityPath, async () => {
    accessibility = await runtime.ariaSnapshot();
    await writeJson(absoluteArtifactPath(input.runDir, accessibilityPath), {
      ariaSnapshot: accessibility,
    });
  });
  if (accessibilityFile) channels.accessibility = channel("captured", accessibilityFile);

  const consoleErrors = runtime.console
    .filter(({ level }) => level.toLowerCase() === "error")
    .map(({ text }) => text)
    .filter(Boolean);
  const consolePath = artifact("console-errors.json");
  const consoleFile = await capture("console-errors", consolePath, () =>
    writeJson(absoluteArtifactPath(input.runDir, consolePath), {
      entries: runtime.console,
      errors: consoleErrors,
    }),
  );
  if (consoleFile) {
    const truncated = consoleErrors.length > 256;
    const incomplete = runtime.consoleDropped > 0 || truncated;
    channels["console-errors"] = channel(
      incomplete ? "partial" : "captured",
      consoleFile,
      incomplete
        ? `console evidence is incomplete (${runtime.consoleDropped} dropped, ${
            truncated ? "summary truncated" : "no summary truncation"
          })`
        : undefined,
      runtime.consoleDropped,
    );
    if (!incomplete) {
      payloads.consoleErrors = {
        messages: consoleErrors,
        truncated: false,
      };
    }
  }

  const pageErrors = runtime.pageErrors.map(({ message }) => message).filter(Boolean);
  const pageErrorsPath = artifact("page-errors.json");
  const pageErrorsFile = await capture("page-errors", pageErrorsPath, () =>
    writeJson(absoluteArtifactPath(input.runDir, pageErrorsPath), {
      entries: runtime.pageErrors,
    }),
  );
  if (pageErrorsFile) {
    const truncated = pageErrors.length > 256;
    const incomplete = runtime.pageErrorsDropped > 0 || truncated;
    channels["page-errors"] = channel(
      incomplete ? "partial" : "captured",
      pageErrorsFile,
      incomplete
        ? `page-error evidence is incomplete (${runtime.pageErrorsDropped} dropped, ${
            truncated ? "summary truncated" : "no summary truncation"
          })`
        : undefined,
      runtime.pageErrorsDropped,
    );
    if (!incomplete) {
      payloads.pageErrors = {
        messages: pageErrors,
        truncated: false,
      };
    }
  }

  const summary = networkSummary(runtime);
  const networkPath = artifact("network.json");
  const networkFile = await capture(
    "network",
    networkPath,
    () =>
      writeJson(absoluteArtifactPath(input.runDir, networkPath), {
        entries: runtime.network,
        dropped: runtime.networkDropped,
        summary,
      }),
    runtime.networkDropped,
  );
  if (networkFile) {
    const bodyTruncated = runtime.network.some((entry) => entry.responseBodyTruncated === true);
    const incomplete = runtime.networkDropped > 0 || summary.pendingRequests > 0 || bodyTruncated;
    channels.network = channel(
      incomplete ? "partial" : "captured",
      networkFile,
      incomplete
        ? `network evidence is incomplete (${[
            runtime.networkDropped > 0 ? `${runtime.networkDropped} dropped` : "",
            summary.pendingRequests > 0 ? `${summary.pendingRequests} pending` : "",
            bodyTruncated ? "response body truncated" : "",
          ]
            .filter(Boolean)
            .join(", ")})`
        : undefined,
      runtime.networkDropped,
    );
    if (!incomplete) payloads.networkSummary = summary;
  }

  const tracePath = artifact("trace.zip");
  const traceFile = await capture("trace", tracePath, () =>
    runtime.stopTrace(absoluteArtifactPath(input.runDir, tracePath)),
  );
  if (traceFile) {
    const bytes = await readFile(absoluteArtifactPath(input.runDir, tracePath));
    channels.trace = channel("captured", { path: tracePath, bytes: bytes.byteLength });
    payloads.traceReference = {
      path: tracePath,
      digest: digest(bytes),
      format: "playwright-trace",
    };
  }

  let pages: Awaited<ReturnType<BrowserProofRuntime["pages"]>>["pages"] = [];
  let pagesDropped = 0;
  const popupPath = artifact("popup-topology.json");
  const popupFile = await capture("popup-topology", popupPath, async () => {
    const projection = await runtime.pages();
    pages = projection.pages;
    pagesDropped = projection.dropped;
    await writeJson(absoluteArtifactPath(input.runDir, popupPath), {
      pages,
      dropped: pagesDropped,
    });
  });
  if (popupFile) {
    channels["popup-topology"] = channel(
      pagesDropped > 0 ? "partial" : "captured",
      popupFile,
      pagesDropped > 0 ? `${pagesDropped} popup pages omitted by the evidence bound` : undefined,
      pagesDropped,
    );
    if (pagesDropped === 0) {
      payloads.popupTopology = {
        pages,
        activePageId: pages.find(({ active }) => active)?.id ?? pages[0]?.id ?? "page-1",
      };
    }
  }

  for (const name of BROWSER_PROOF_REQUIRED_CHANNELS) {
    channels[name] ??= channel("partial", undefined, "browser evidence channel was not captured");
  }
  const captured = BROWSER_PROOF_REQUIRED_CHANNELS.filter(
    (name) => channels[name].status === "captured",
  );
  const missing = BROWSER_PROOF_REQUIRED_CHANNELS.filter((name) => !captured.includes(name));
  return parseBrowserProofEvidence({
    schemaVersion: 1,
    runId: input.runId,
    target: { targetId: input.targetId, targetProfileId: input.targetProfileId },
    build: { sourceSha: input.sourceSha, artifactDigest: input.artifactDigest },
    browser: { engine: runtime.profile.engine, version: runtime.version },
    environment: runtime.profile,
    channels,
    ...payloads,
    completeness: {
      status: missing.length ? "partial" : "complete",
      required: [...BROWSER_PROOF_REQUIRED_CHANNELS],
      captured: [...captured],
      missing: [...missing],
    },
  });
}
