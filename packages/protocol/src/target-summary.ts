import type { DeviceSummary } from "./operations.js";

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

export function summarizeTargetOperationResult(operationId: string, result: unknown): unknown {
  if (operationId === "target.snapshot.capture") {
    if (!result || typeof result !== "object" || Array.isArray(result)) return result;
    const body = result as {
      serial?: unknown;
      bounds?: unknown;
      nodes?: unknown;
      inspectable?: unknown;
      source?: unknown;
      inspectionState?: unknown;
      screenIdentity?: { fingerprint?: unknown };
      visualFingerprint?: unknown;
      proposedRows?: unknown;
      inspectionError?: unknown;
    };
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const chrome = describeSnapshotChrome(nodes);
    const inspectable = body.inspectable !== false && nodes.length > 0;
    const visualFingerprint =
      typeof body.visualFingerprint === "string"
        ? body.visualFingerprint
        : typeof body.screenIdentity?.fingerprint === "string" && !inspectable
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
    return {
      serial: body.serial,
      bounds: body.bounds,
      inspectable,
      ...(typeof body.source === "string" ? { source: body.source } : {}),
      ...(typeof body.inspectionState === "string"
        ? { inspectionState: body.inspectionState }
        : {}),
      fingerprint:
        typeof body.screenIdentity?.fingerprint === "string"
          ? body.screenIdentity.fingerprint.slice(0, 16)
          : visualFingerprint
            ? visualFingerprint.slice(0, 16)
            : undefined,
      ...(visualFingerprint ? { visualFingerprint: visualFingerprint.slice(0, 16) } : {}),
      ...(chrome.app ? { app: chrome.app } : {}),
      ...(chrome.header ? { header: chrome.header } : {}),
      controls: snapshotControlSummary(nodes),
      ...(proposedRows.length ? { proposedRows } : {}),
      ...(inspectionError ? { inspectionError } : {}),
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
    devices: available.map((device) => ({
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
    })),
    hiddenUnavailableCount: devices.length - available.length,
  };
}
