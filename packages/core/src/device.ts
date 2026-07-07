/**
 * Thin agent-device SDK helpers.
 * Pattern: open → snapshot/find → press → re-check. Failures throw.
 * All long waits honor job cancel/pause via control.ts.
 */
import { createAgentDeviceClient } from "agent-device";
import { cooperativeCheckpoint, raceCancel, throwIfCancelled } from "./control.js";
import { withRetry } from "./retry.js";

export const PLATFORM = "android" as const;
export const GROK_PACKAGE = "ai.x.grok";
export const PLAY_PACKAGE = "com.android.vending";
export const WORK_ACCOUNT_MATCH = process.env.WORK_ACCOUNT_MATCH?.trim() || "teachx.ai";

export type Device = ReturnType<typeof createAgentDeviceClient>;

export type SnapshotNode = {
  label?: string;
  value?: string;
  identifier?: string;
  enabled?: boolean;
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  ref?: string;
};

// Singleton client — reusing one client avoids "session already bound"
// conflicts that arise when each operation creates a fresh client that
// tries to re-bind the session to the device. Recipes call `open` once
// to establish the binding; subsequent captures/interactions reuse it.
let _device: Device | null = null;
export function createDevice(): Device {
  if (!_device) {
    _device = createAgentDeviceClient({
      session: process.env.AGENT_DEVICE_SESSION?.trim() || "grok-actions",
    });
  }
  return _device;
}

export function base() {
  const serial =
    process.env.AGENT_DEVICE_SERIAL?.trim() || process.env.ANDROID_SERIAL?.trim() || undefined;
  return {
    platform: PLATFORM,
    ...(serial ? { serial, device: serial } : {}),
  } as const;
}

/** Run a device promise under cancel race, pause checkpoints, and flake retries. */
async function controlled<T>(op: () => Promise<T>): Promise<T> {
  return withRetry(
    async () => {
      await cooperativeCheckpoint();
      throwIfCancelled();
      return await raceCancel(op());
    },
    {
      attempts: Number(process.env.GROK_DEVICE_RETRY_ATTEMPTS ?? 3),
      baseDelayMs: Number(process.env.GROK_DEVICE_RETRY_DELAY_MS ?? 350),
    },
  );
}

export async function sleep(ms: number, device: Device = createDevice()): Promise<void> {
  // Small chunks = faster cancel/pause response
  const chunk = 100;
  let left = Math.max(0, ms);
  while (left > 0) {
    await cooperativeCheckpoint();
    const step = Math.min(chunk, left);
    await raceCancel(device.command.wait({ ...base(), durationMs: step }));
    left -= step;
  }
  await cooperativeCheckpoint();
}

export async function snapshot(
  device: Device,
  opts?: { interactiveOnly?: boolean; raw?: boolean },
): Promise<SnapshotNode[]> {
  const result = await controlled(() =>
    device.capture.snapshot({
      ...base(),
      interactiveOnly: opts?.interactiveOnly ?? false,
      raw: opts?.raw,
    }),
  );
  return (result.nodes ?? []) as SnapshotNode[];
}

export async function openApp(
  device: Device,
  app: string,
  opts?: { relaunch?: boolean },
): Promise<void> {
  await controlled(() =>
    device.apps.open({
      ...base(),
      app,
      relaunch: opts?.relaunch ?? true,
    }),
  );
  await sleep(2000, device);
}

export async function openUrl(device: Device, url: string): Promise<void> {
  await controlled(() => device.apps.open({ ...base(), url }));
  await sleep(2500, device);
}

export async function pressLabel(device: Device, label: string): Promise<void> {
  await controlled(() =>
    device.interactions.press({
      ...base(),
      selector: `label="${label}"`,
    }),
  );
}

export async function pressPoint(device: Device, x: number, y: number): Promise<void> {
  await controlled(() => device.interactions.press({ ...base(), x, y }));
}

export async function pressRef(device: Device, ref: string): Promise<void> {
  const normalized = ref.startsWith("@") ? ref : `@${ref}`;
  await controlled(() => device.interactions.press({ ...base(), ref: normalized }));
}

export async function findClick(
  device: Device,
  query: string,
  opts?: { first?: boolean; last?: boolean },
): Promise<void> {
  await controlled(() =>
    device.interactions.find({
      ...base(),
      query,
      action: "click",
      first: opts?.first ?? true,
      last: opts?.last,
    }),
  );
}

export async function exists(device: Device, query: string): Promise<boolean> {
  try {
    await controlled(() =>
      device.interactions.find({
        ...base(),
        query,
        action: "exists",
        first: true,
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "JobCancelledError") throw err;
    return false;
  }
}

export async function waitFor(
  device: Device,
  selectorOrText: { selector?: string; text?: string; query?: string },
  timeoutMs = 30_000,
): Promise<void> {
  if (selectorOrText.selector) {
    const selector = selectorOrText.selector;
    await controlled(() =>
      device.command.wait({
        ...base(),
        selector,
        timeoutMs,
      }),
    );
    return;
  }
  if (selectorOrText.text) {
    const text = selectorOrText.text;
    await controlled(() =>
      device.command.wait({
        ...base(),
        text,
        timeoutMs,
      }),
    );
    return;
  }
  const query = selectorOrText.query;
  if (!query) throw new Error("waitFor requires selector, text, or query");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await cooperativeCheckpoint();
    if (await exists(device, query)) return;
    await sleep(400, device);
  }
  throw new Error(`Timed out waiting for: ${query}`);
}

export async function scrollDown(device: Device, amount = 0.5): Promise<void> {
  await controlled(() =>
    device.interactions.scroll({
      ...base(),
      direction: "down",
      amount,
    }),
  );
}

export async function screenshot(device: Device, path: string): Promise<void> {
  await controlled(() => device.capture.screenshot({ path }));
}

export function nodesMatch(nodes: SnapshotNode[], substring: string): SnapshotNode | undefined {
  const q = substring.toLowerCase();
  return nodes.find((n) => {
    const blob = `${n.label ?? ""} ${n.value ?? ""}`.toLowerCase();
    return blob.includes(q);
  });
}

export function center(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

export async function pressMatchingText(device: Device, match: string): Promise<void> {
  if (await exists(device, match)) {
    try {
      await findClick(device, match);
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "JobCancelledError") throw err;
    }
  }

  const nodes = await snapshot(device);
  const textNode = nodesMatch(nodes, match);
  if (!textNode?.rect) {
    throw new Error(`No UI node matching "${match}"`);
  }

  const { x: tx, y: ty, width: tw, height: th } = textNode.rect;
  let best: { area: number; x: number; y: number; width: number; height: number } | undefined;

  for (const n of nodes) {
    if (!n.hittable || !n.rect) continue;
    const { x, y, width, height } = n.rect;
    if (x <= tx && y <= ty && x + width >= tx + tw && y + height >= ty + th && width >= 400) {
      const area = width * height;
      if (!best || area < best.area) {
        best = { area, x, y, width, height };
      }
    }
  }

  const rect = best ?? textNode.rect;
  const p = center(rect);
  await pressPoint(device, p.x, p.y);
}

export async function anyExists(device: Device, queries: string[]): Promise<string | undefined> {
  for (const q of queries) {
    if (await exists(device, q)) return q;
  }
  return undefined;
}
