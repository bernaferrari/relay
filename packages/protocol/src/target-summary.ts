import type { DeviceSummary } from "./operations.js";
import type { IosSessionOperationLifecycle } from "./target-contract.js";

export type DeviceCatalogSummary = Pick<
  DeviceSummary,
  | "id"
  | "serial"
  | "name"
  | "kind"
  | "booted"
  | "platform"
  | "connectionState"
  | "osVersion"
  | "developerMode"
  | "developerServicesAvailable"
  | "readiness"
>;

/** Keep an agent's default device catalog focused on hardware it can act on.
 * The UI still receives the full discovery response and can offer stopped
 * simulators explicitly; CLI/MCP callers should not spend context on dozens of
 * unavailable runtimes while looking for a connected phone. */
const snapshotNavHint =
  /tab|nav|sidebar|settings|language|close|back|menu|compose|imagine|build|ask|home|switcher|picker|done|cancel/i;

function snapshotControlScore(control: {
  identifier?: string;
  label?: string;
  type?: string;
  hittable: boolean;
}): number {
  const identifier = control.identifier ?? "";
  const label = control.label ?? "";
  let score = 0;
  if (snapshotNavHint.test(identifier) || snapshotNavHint.test(label)) score += 100;
  if (control.hittable) score += 40;
  if (control.type && /button|tab|link|barbutton|cell/i.test(control.type)) score += 20;
  if (identifier) score += 10;
  if (/scroll bar/i.test(label)) score -= 80;
  return score;
}

function snapshotControlSummary(nodes: unknown[]): Array<Record<string, unknown>> {
  const ranked: Array<{
    control: Record<string, unknown>;
    score: number;
    index: number;
    key: string;
  }> = [];
  for (const [index, node] of nodes.entries()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const item = node as {
      identifier?: unknown;
      label?: unknown;
      hittable?: unknown;
      type?: unknown;
      rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    };
    const identifier = typeof item.identifier === "string" ? item.identifier.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!identifier && !label) continue;
    const rect = item.rect;
    const x = Number(rect?.x);
    const y = Number(rect?.y);
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    const cx = Number.isFinite(x) && Number.isFinite(width) ? Math.round(x + width / 2) : undefined;
    const cy =
      Number.isFinite(y) && Number.isFinite(height) ? Math.round(y + height / 2) : undefined;
    const type = typeof item.type === "string" ? item.type : undefined;
    const hittable = item.hittable === true;
    ranked.push({
      index,
      score: snapshotControlScore({
        ...(identifier ? { identifier } : {}),
        ...(label ? { label } : {}),
        ...(type ? { type } : {}),
        hittable,
      }),
      key: `${identifier}\0${label}\0${type ?? ""}\0${cx ?? ""}\0${cy ?? ""}`,
      control: {
        ...(identifier ? { identifier } : {}),
        ...(label ? { label } : {}),
        ...(type ? { type } : {}),
        hittable,
        ...(cx != null && cy != null ? { x: cx, y: cy } : {}),
      },
    });
  }
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  const controls: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    controls.push(item.control);
    if (controls.length >= 48) break;
  }
  return controls;
}

/** Pixels-only frames have no AX chrome. Last-launched app plus a visual
 * fingerprint is still enough to name Grok's login wordmark. Do not invent
 * Settings or other nav titles from a bundle id. */
export function describePixelsOnlySnapshotChrome(input: {
  foregroundApp?: string;
  visualFingerprint?: string;
}): { app?: string; header?: string } {
  const app = input.foregroundApp?.trim() || undefined;
  const visual = input.visualFingerprint?.trim();
  if (!app) return {};
  if (visual && /grok/i.test(app)) return { app, header: "Grok" };
  return { app };
}

function compactInteractResolution(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const point =
    record.point && typeof record.point === "object" && !Array.isArray(record.point)
      ? record.point
      : undefined;
  const bounds =
    record.bounds && typeof record.bounds === "object" && !Array.isArray(record.bounds)
      ? record.bounds
      : undefined;
  if (typeof record.method !== "string" && !point && !bounds) return undefined;
  return {
    ...(typeof record.method === "string" ? { method: record.method } : {}),
    ...(point ? { point } : {}),
    ...(bounds ? { bounds } : {}),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Interact preview must stay a digest. HTTP /interact already returns mime+base64;
 * when a wrapper strips the PNG, do not dump path/nodes/tree. CLI `--preview --file`
 * writes the raster. */
function interactPreviewDigest(result: unknown): Record<string, unknown> | undefined {
  const seen = new Set<unknown>();
  let current: unknown = result;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object" || Array.isArray(current) || seen.has(current)) {
      return undefined;
    }
    seen.add(current);
    const record = current as Record<string, unknown>;
    const preview = record.preview === true;
    const hasPng = record.mime === "image/png" && typeof record.base64 === "string";
    if (preview || hasPng) {
      const resolution = compactInteractResolution(record.resolution);
      const bytes = finiteNumber(record.bytes);
      const width = finiteNumber(record.width);
      const height = finiteNumber(record.height);
      return {
        ...(record.ok === true ? { ok: true } : {}),
        ...(preview ? { preview: true } : {}),
        ...(typeof record.mime === "string" ? { mime: record.mime } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(typeof record.inspectable === "boolean" ? { inspectable: record.inspectable } : {}),
        ...(resolution ? { resolution } : {}),
        nextHint: preview
          ? "Commit with target.interact (preview:false). Then screenshot again."
          : "Tap with target.interact (preview:true marks only). Do not start with test run.",
        ...(!hasPng && preview
          ? {
              note: "Preview PNG is not inlined. Use CLI --preview --file.",
            }
          : {}),
      };
    }
    current = record.result ?? record.data ?? record.payload;
  }
  return undefined;
}

export function describeSnapshotChrome(nodes: unknown[]): { app?: string; header?: string } {
  let app: string | undefined;
  let header: string | undefined;
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const item = node as {
      type?: unknown;
      role?: unknown;
      identifier?: unknown;
      label?: unknown;
      rect?: { y?: unknown };
    };
    const type = String(item.type ?? item.role ?? "").toLocaleLowerCase();
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const identifier = typeof item.identifier === "string" ? item.identifier.trim() : "";
    const y = Number(item.rect?.y);
    if (!app && type === "application" && label) app = label;
    if (!header && type === "navigationbar" && identifier && identifier.length < 40)
      header = identifier;
    if (
      !header &&
      type === "statictext" &&
      label &&
      label.length < 40 &&
      Number.isFinite(y) &&
      y < 140 &&
      !/close|search|grok-|back/i.test(label)
    ) {
      header = label;
    }
  }
  return { ...(app ? { app } : {}), ...(header ? { header } : {}) };
}

function inspectionRecoveryNote(
  inspectionState: string | undefined,
  hasProposedRows: boolean,
): string {
  if (inspectionState === "keyguard") {
    return "Unlock the phone, then snapshot again — or relay device recover <serial>.";
  }
  if (inspectionState === "asleep") {
    return "Screen is off. relay device recover <serial> wakes it, then snapshot again.";
  }
  if (hasProposedRows) {
    return "Names unavailable on this frame. proposedRows are screenshot tap targets. relay device recover <serial> retries labels.";
  }
  return "Names unavailable. Screenshot and tap by point still work. relay device recover <serial> retries.";
}

/**
 * Snapshot capture deliberately emits only product-safe inspection errors.
 * Keep the CLI/MCP summary bounded too: it is an agent-facing status, not a
 * channel for arbitrary host or Xcode diagnostics.
 */
function inspectionErrorSummary(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  if (!message) return undefined;
  return message.slice(0, 480);
}

const readinessModes = new Set(["pixels", "accessibility", "evidence"]);
const readinessStates = new Set(["unproven", "proven", "unavailable"]);
const readinessFreshness = new Set(["current", "stale", "unproven"]);
const readinessModeByCapability = {
  previewPixels: "pixels",
  semanticControl: "accessibility",
  evidenceCapture: "evidence",
} as const;
const readinessReasons = new Set([
  "not-yet-proven",
  "target-stopped",
  "developer-mode-disabled",
  "developer-services-unavailable",
  "probe-failed",
  "probe-in-flight",
  "input-changed",
  "visual-changed",
]);

const iosSessionOperations = new Set<IosSessionOperationLifecycle["operation"]>([
  "preview",
  "snapshot",
  "screenshot",
  "interaction",
  "evidence",
]);
const iosSessionOutcomes = new Set<IosSessionOperationLifecycle["outcome"]>([
  "passed",
  "unavailable",
  "in-flight",
]);
const iosSessionCodes = new Set<IosSessionOperationLifecycle["code"]>([
  "IOS_SESSION_OPERATION_READY",
  "IOS_SESSION_OPERATION_UNAVAILABLE",
  "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT",
]);
const iosSessionStages = new Set<IosSessionOperationLifecycle["stages"][number]["stage"]>([
  "preview",
  "xctest-availability",
  "accessibility-query",
  "repair",
]);
const iosSessionStageOutcomes = new Set<IosSessionOperationLifecycle["stages"][number]["outcome"]>([
  "passed",
  "failed",
  "skipped",
  "in-flight",
]);

/** Keep bounded session state visible to agents without passing through a
 * native/Xcode diagnostic. In-flight AX is specifically not a reconnect cue. */
function iosSessionLifecycleSummary(value: unknown): IosSessionOperationLifecycle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const lifecycle = value as Record<string, unknown>;
  const operation = lifecycle.operation;
  const outcome = lifecycle.outcome;
  const code = lifecycle.code;
  const durationMs = Number(lifecycle.durationMs);
  if (
    typeof operation !== "string" ||
    !iosSessionOperations.has(operation as IosSessionOperationLifecycle["operation"]) ||
    typeof outcome !== "string" ||
    !iosSessionOutcomes.has(outcome as IosSessionOperationLifecycle["outcome"]) ||
    typeof code !== "string" ||
    !iosSessionCodes.has(code as IosSessionOperationLifecycle["code"]) ||
    lifecycle.attempts !== 1 ||
    lifecycle.repairAttempted !== false ||
    !Number.isFinite(durationMs) ||
    !Array.isArray(lifecycle.stages)
  ) {
    return undefined;
  }
  const stages = lifecycle.stages.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const stage = value as Record<string, unknown>;
    if (
      typeof stage.stage !== "string" ||
      !iosSessionStages.has(
        stage.stage as IosSessionOperationLifecycle["stages"][number]["stage"],
      ) ||
      typeof stage.outcome !== "string" ||
      !iosSessionStageOutcomes.has(
        stage.outcome as IosSessionOperationLifecycle["stages"][number]["outcome"],
      )
    ) {
      return [];
    }
    return [
      {
        stage: stage.stage as IosSessionOperationLifecycle["stages"][number]["stage"],
        outcome: stage.outcome as IosSessionOperationLifecycle["stages"][number]["outcome"],
      },
    ];
  });
  if (stages.length !== lifecycle.stages.length) return undefined;
  const expectedCode =
    outcome === "passed"
      ? "IOS_SESSION_OPERATION_READY"
      : outcome === "unavailable"
        ? "IOS_SESSION_OPERATION_UNAVAILABLE"
        : "IOS_SESSION_OPERATION_ACCESSIBILITY_IN_FLIGHT";
  if (code !== expectedCode) return undefined;
  if (
    outcome === "in-flight" &&
    (!stages.some(
      (stage) => stage.stage === "xctest-availability" && stage.outcome === "skipped",
    ) ||
      !stages.some(
        (stage) => stage.stage === "accessibility-query" && stage.outcome === "in-flight",
      ))
  ) {
    return undefined;
  }
  return {
    operation: operation as IosSessionOperationLifecycle["operation"],
    outcome: outcome as IosSessionOperationLifecycle["outcome"],
    code: code as IosSessionOperationLifecycle["code"],
    attempts: 1,
    repairAttempted: false,
    durationMs,
    stages,
  };
}

/** Keep runtime readiness useful to an agent while refusing arbitrary host
 * diagnostics or expanded trees in the default device/snapshot summary. */
function runtimeReadinessSummary(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const readiness = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const capability of Object.keys(readinessModeByCapability) as Array<
    keyof typeof readinessModeByCapability
  >) {
    const raw = readiness[capability];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const fact = raw as Record<string, unknown>;
    if (
      !readinessModes.has(String(fact.mode)) ||
      !readinessStates.has(String(fact.state)) ||
      !readinessFreshness.has(String(fact.freshness))
    ) {
      return undefined;
    }
    const state = String(fact.state);
    const freshness = String(fact.freshness);
    const proven = state === "proven";
    if (
      fact.mode !== readinessModeByCapability[capability] ||
      (proven && freshness === "unproven") ||
      (!proven && freshness !== "unproven") ||
      (!proven && fact.proof !== undefined)
    ) {
      return undefined;
    }
    const summarized: Record<string, unknown> = {
      mode: fact.mode,
      state: fact.state,
      freshness: fact.freshness,
    };
    if (readinessReasons.has(String(fact.reason))) summarized.reason = fact.reason;
    if (fact.proof && typeof fact.proof === "object" && !Array.isArray(fact.proof)) {
      const proof = fact.proof as Record<string, unknown>;
      const at = Number(proof.at);
      if (Number.isFinite(at)) {
        summarized.proof = {
          at,
          ...(Number.isFinite(Number(proof.observedNodeCount))
            ? { observedNodeCount: Number(proof.observedNodeCount) }
            : {}),
          ...(Number.isFinite(Number(proof.durationMs))
            ? { durationMs: Number(proof.durationMs) }
            : {}),
        };
      } else {
        return undefined;
      }
    }
    if (proven && summarized.proof === undefined) return undefined;
    if (proven && fact.lastError !== undefined) return undefined;
    let lastErrorReason: string | undefined;
    if (fact.lastError !== undefined) {
      if (!fact.lastError || typeof fact.lastError !== "object" || Array.isArray(fact.lastError)) {
        return undefined;
      }
      const lastError = fact.lastError as Record<string, unknown>;
      const at = Number(lastError.at);
      lastErrorReason = String(lastError.reason);
      if (!Number.isFinite(at) || !readinessReasons.has(lastErrorReason)) return undefined;
      summarized.lastError = {
        at,
        reason: lastError.reason,
        ...(Number.isFinite(Number(lastError.observedNodeCount))
          ? { observedNodeCount: Number(lastError.observedNodeCount) }
          : {}),
        ...(Number.isFinite(Number(lastError.durationMs))
          ? { durationMs: Number(lastError.durationMs) }
          : {}),
        ...(typeof lastError.message === "string" && lastError.message.trim()
          ? { message: lastError.message.trim().slice(0, 480) }
          : {}),
      };
    }
    if (fact.invalidated !== undefined) {
      if (
        !fact.invalidated ||
        typeof fact.invalidated !== "object" ||
        Array.isArray(fact.invalidated) ||
        !proven ||
        freshness !== "stale" ||
        capability !== "semanticControl"
      ) {
        return undefined;
      }
      const invalidated = fact.invalidated as Record<string, unknown>;
      const at = Number(invalidated.at);
      if (
        Number.isFinite(at) &&
        (invalidated.reason === "input-changed" || invalidated.reason === "visual-changed")
      ) {
        summarized.invalidated = { at, reason: invalidated.reason };
      } else {
        return undefined;
      }
    }
    if (proven && freshness === "stale" && summarized.invalidated === undefined) return undefined;
    if (fact.nextProbeAt !== undefined) {
      const nextProbeAt = Number(fact.nextProbeAt);
      if (
        !Number.isFinite(nextProbeAt) ||
        capability !== "semanticControl" ||
        state !== "unavailable" ||
        lastErrorReason !== "probe-failed"
      ) {
        return undefined;
      }
      summarized.nextProbeAt = nextProbeAt;
    }
    result[capability] = summarized;
  }
  return result;
}

/** CLI/MCP presentation flag: keep the raw snapshot (including `nodes`) when set. */
function surveyFrameLabels(nodes: unknown[]): string[] {
  const labels: string[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const label =
      typeof (node as { label?: unknown }).label === "string"
        ? (node as { label: string }).label.trim()
        : "";
    if (!label || /^(back|home|recents)$/iu.test(label)) continue;
    if (/notification:/iu.test(label)) continue;
    labels.push(label);
    if (labels.length >= 12) break;
  }
  return labels;
}

function summarizeScrollSurveyResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const body = result as {
    status?: unknown;
    reason?: unknown;
    message?: unknown;
    restoredStartViewport?: unknown;
    frames?: unknown;
    stitched?: unknown;
    mergedNodes?: unknown;
    persist?: unknown;
  };
  if (!Array.isArray(body.frames) || body.frames.length === 0) return result;
  const frames = body.frames.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const frame = value as {
      index?: unknown;
      offsetY?: unknown;
      appendedHeight?: unknown;
      screenshot?: { width?: unknown; height?: unknown };
      snapshot?: { nodes?: unknown };
    };
    const index = Number(frame.index);
    if (!Number.isInteger(index)) return [];
    const nodes = Array.isArray(frame.snapshot?.nodes) ? frame.snapshot.nodes : [];
    return [
      {
        index,
        offsetY: Number(frame.offsetY) || 0,
        appendedHeight: Number(frame.appendedHeight) || 0,
        ...(Number.isFinite(Number(frame.screenshot?.width))
          ? { width: Number(frame.screenshot?.width) }
          : {}),
        ...(Number.isFinite(Number(frame.screenshot?.height))
          ? { height: Number(frame.screenshot?.height) }
          : {}),
        labels: surveyFrameLabels(nodes),
      },
    ];
  });
  if (!frames.length) return result;
  const stitched =
    body.stitched && typeof body.stitched === "object" && !Array.isArray(body.stitched)
      ? (body.stitched as { width?: unknown; height?: unknown })
      : undefined;
  const mergedNodes = Array.isArray(body.mergedNodes) ? body.mergedNodes : [];
  const persist =
    body.persist && typeof body.persist === "object" && !Array.isArray(body.persist)
      ? (body.persist as Record<string, unknown>)
      : undefined;
  return {
    status: body.status,
    reason: body.reason,
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    restoredStartViewport: body.restoredStartViewport === true,
    frameCount: frames.length,
    frames,
    ...(stitched &&
    Number.isFinite(Number(stitched.width)) &&
    Number.isFinite(Number(stitched.height))
      ? {
          full: {
            width: Number(stitched.width),
            height: Number(stitched.height),
            nodeCount: mergedNodes.length,
          },
        }
      : {}),
    ...(persist?.dir && typeof persist.dir === "string"
      ? {
          persist: {
            dir: persist.dir,
            ...(persist.full && typeof persist.full === "object" && !Array.isArray(persist.full)
              ? { full: persist.full }
              : {}),
          },
        }
      : {}),
  };
}

function normalizeLaunchAppToken(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function launchAppPackageTail(value: string): string {
  const parts = normalizeLaunchAppToken(value).split(".");
  return parts[parts.length - 1] ?? "";
}

/** Package ids and display names are both valid launch requests. Chrome vs
 * Settings must stay a miss; `ai.x.GrokApp` vs the Application label `Grok`
 * is a hit. */
export function launchedAppMatchesObserved(requested: string, observed: string): boolean {
  const req = normalizeLaunchAppToken(requested);
  const obs = normalizeLaunchAppToken(observed);
  if (!req || !obs) return false;
  if (req === obs) return true;
  const reqTail = launchAppPackageTail(req);
  const obsTail = launchAppPackageTail(obs);
  if (reqTail && obsTail && reqTail === obsTail) return true;
  const shorter = reqTail.length <= obsTail.length ? reqTail : obsTail;
  const longer = reqTail.length <= obsTail.length ? obsTail : reqTail;
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/** Launch acknowledgement is not foreground proof. Agents need the observed
 * app so a bounce (Chrome → Settings) is visible without a second snapshot. */
export function summarizeLaunchedForeground(
  requested: string,
  snapshot:
    | {
        nodes?: unknown;
        foregroundApp?: unknown;
        treeApp?: unknown;
      }
    | undefined,
): { app?: string; matched: boolean } {
  if (!snapshot) return { matched: false };
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const chrome = describeSnapshotChrome(nodes);
  const treeApp = typeof snapshot.treeApp === "string" ? snapshot.treeApp.trim() : "";
  const foregroundApp =
    typeof snapshot.foregroundApp === "string" ? snapshot.foregroundApp.trim() : "";
  const app = chrome.app || treeApp || foregroundApp || undefined;
  const candidates = [chrome.app, treeApp, foregroundApp].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    ...(app ? { app } : {}),
    matched: candidates.some((candidate) => launchedAppMatchesObserved(requested, candidate)),
  };
}

export function wantsFullSnapshotTree(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const full = (input as { full?: unknown }).full;
  return full === true || full === "true" || full === "1";
}

export function summarizeTargetOperationResult(operationId: string, result: unknown): unknown {
  if (operationId === "target.snapshot.capture") {
    if (!result || typeof result !== "object" || Array.isArray(result)) return result;
    const body = result as {
      serial?: unknown;
      bounds?: unknown;
      nodes?: unknown;
      inspectable?: unknown;
      source?: unknown;
      androidTreeBackend?: unknown;
      inspectionState?: unknown;
      screenIdentity?: { fingerprint?: unknown };
      visualFingerprint?: unknown;
      proposedRows?: unknown;
      inspectionError?: unknown;
      readiness?: unknown;
      iosSessionLifecycle?: unknown;
      foregroundApp?: unknown;
      treeApp?: unknown;
      app?: unknown;
      header?: unknown;
    };
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const chrome = describeSnapshotChrome(nodes);
    const treeApp = typeof body.treeApp === "string" ? body.treeApp.trim() : "";
    const foregroundApp = typeof body.foregroundApp === "string" ? body.foregroundApp.trim() : "";
    const visualFingerprint =
      typeof body.visualFingerprint === "string" ? body.visualFingerprint : undefined;
    const pixelsChrome = describePixelsOnlySnapshotChrome({
      foregroundApp: chrome.app || treeApp || foregroundApp || undefined,
      visualFingerprint,
    });
    const namedApp = typeof body.app === "string" ? body.app.trim() : "";
    const namedHeader = typeof body.header === "string" ? body.header.trim() : "";
    const app = chrome.app || treeApp || foregroundApp || namedApp || pixelsChrome.app || undefined;
    const header = chrome.header || namedHeader || pixelsChrome.header || undefined;
    const inspectable = body.inspectable !== false && nodes.length > 0;
    // A screen-identity digest is derived from accessibility semantics. In an
    // uninspectable/empty response it is merely the deterministic digest of
    // no usable nodes, not evidence that Relay captured pixels. Do not
    // relabel it as a visual fingerprint: callers use that field to decide
    // whether a point-based follow-up has fresh raster evidence.
    const semanticFingerprint =
      inspectable && typeof body.screenIdentity?.fingerprint === "string"
        ? body.screenIdentity.fingerprint
        : undefined;
    const proposedRows = Array.isArray(body.proposedRows)
      ? body.proposedRows.flatMap((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return [];
          const item = row as {
            x?: unknown;
            y?: unknown;
            top?: unknown;
            bottom?: unknown;
            height?: unknown;
          };
          const x = Number(item.x);
          const y = Number(item.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
          return [
            {
              x,
              y,
              ...(Number.isFinite(Number(item.top)) ? { top: Number(item.top) } : {}),
              ...(Number.isFinite(Number(item.bottom)) ? { bottom: Number(item.bottom) } : {}),
              ...(Number.isFinite(Number(item.height)) ? { height: Number(item.height) } : {}),
            },
          ];
        })
      : [];
    const inspectionError = inspectionErrorSummary(body.inspectionError);
    const readiness = runtimeReadinessSummary(body.readiness);
    const iosSessionLifecycle = iosSessionLifecycleSummary(body.iosSessionLifecycle);
    return {
      serial: body.serial,
      bounds: body.bounds,
      inspectable,
      ...(typeof body.source === "string" ? { source: body.source } : {}),
      ...(body.androidTreeBackend === "helper" || body.androidTreeBackend === "dump"
        ? { androidTreeBackend: body.androidTreeBackend }
        : {}),
      ...(typeof body.inspectionState === "string"
        ? { inspectionState: body.inspectionState }
        : {}),
      fingerprint: semanticFingerprint
        ? semanticFingerprint.slice(0, 16)
        : visualFingerprint
          ? visualFingerprint.slice(0, 16)
          : undefined,
      ...(visualFingerprint ? { visualFingerprint: visualFingerprint.slice(0, 16) } : {}),
      ...(app ? { app } : {}),
      ...(header ? { header } : {}),
      controls: snapshotControlSummary(nodes),
      ...(proposedRows.length ? { proposedRows } : {}),
      ...(inspectionError ? { inspectionError } : {}),
      ...(readiness ? { readiness } : {}),
      ...(iosSessionLifecycle ? { iosSessionLifecycle } : {}),
      nodeCount: nodes.length,
      ...(!inspectable
        ? {
            note:
              inspectionError ??
              inspectionRecoveryNote(
                typeof body.inspectionState === "string" ? body.inspectionState : undefined,
                proposedRows.length > 0,
              ),
          }
        : {}),
    };
  }
  if (operationId === "target.scroll-survey.capture") {
    return summarizeScrollSurveyResult(result);
  }
  if (operationId === "target.interact") {
    return interactPreviewDigest(result) ?? result;
  }
  if (operationId !== "target.devices.list") return result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const devices = (result as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return result;
  if (
    devices.some(
      (device) =>
        !device ||
        typeof device !== "object" ||
        Array.isArray(device) ||
        typeof (device as DeviceSummary).id !== "string" ||
        typeof (device as DeviceSummary).platform !== "string",
    )
  )
    return result;

  const available = (devices as DeviceSummary[]).filter(
    (device) => device.kind?.toLocaleLowerCase() !== "simulator" || device.booted === true,
  );
  return {
    ...(result as Record<string, unknown>),
    devices: available.map((device) => {
      const readiness = runtimeReadinessSummary(device.readiness);
      return {
        id: device.id,
        serial: device.serial,
        name: device.name,
        kind: device.kind,
        booted: device.booted,
        platform: device.platform,
        ...(device.connectionState ? { connectionState: device.connectionState } : {}),
        ...(device.osVersion ? { osVersion: device.osVersion } : {}),
        ...(device.developerMode ? { developerMode: device.developerMode } : {}),
        ...(device.developerServicesAvailable !== undefined
          ? { developerServicesAvailable: device.developerServicesAvailable }
          : {}),
        ...(readiness ? { readiness } : {}),
      };
    }),
    hiddenUnavailableCount: devices.length - available.length,
  };
}
