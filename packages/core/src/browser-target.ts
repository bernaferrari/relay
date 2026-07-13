import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContext, Page, Video } from "playwright-core";
import { chromium } from "playwright-core";
import type { Device, SnapshotNode } from "./device.js";
import { browserProfileDir, readTarget } from "./targets.js";

type BrowserSession = {
  context: BrowserContext;
  page: Page;
  targetId: string;
  recordingUnavailable?: string;
  recordingPath?: string;
  recordingVideo?: Video | null;
  console: Array<{ level: string; text: string; at: number }>;
  network: Array<{ method: string; url: string; status?: number; at: number }>;
};

const sessions = new Map<string, Promise<BrowserSession>>();
const INTERACTIVE =
  'button, a[href], input, textarea, select, [role], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

async function createSession(targetId: string): Promise<BrowserSession> {
  const target = await readTarget(targetId);
  if (!target?.browser) throw new Error(`managed browser target not found: ${targetId}`);
  type ContextOptions = Parameters<typeof chromium.launchPersistentContext>[1];
  const baseOptions: ContextOptions = {
    executablePath: target.browser.executablePath,
    headless: target.browser.headless ?? true,
    viewport: target.browser.viewport ?? { width: 1280, height: 800 },
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  };
  let recordingUnavailable: string | undefined;
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(browserProfileDir(targetId), {
      ...baseOptions,
      recordVideo: {
        dir: join(browserProfileDir(targetId), "recordings"),
        size: target.browser.viewport ?? { width: 1280, height: 800 },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ffmpeg|video rendering|recordvideo/i.test(message)) throw error;
    recordingUnavailable =
      "Video recording is unavailable on this machine. Screenshots, steps, and logs are still captured.";
    context = await chromium.launchPersistentContext(browserProfileDir(targetId), baseOptions);
  }
  const page = context.pages()[0] ?? (await context.newPage());
  const session: BrowserSession = {
    context,
    page,
    targetId,
    ...(recordingUnavailable ? { recordingUnavailable } : {}),
    console: [],
    network: [],
  };
  attachEvidence(session, page);
  if (page.url() === "about:blank") {
    await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }
  return session;
}

function attachEvidence(session: BrowserSession, page: Page): void {
  page.on("console", (message) => {
    session.console.push({ level: message.type(), text: message.text(), at: Date.now() });
  });
  page.on("request", (request) => {
    session.network.push({ method: request.method(), url: request.url(), at: Date.now() });
  });
  page.on("response", (response) => {
    const entry = [...session.network]
      .reverse()
      .find((item) => item.url === response.url() && item.status === undefined);
    if (entry) entry.status = response.status();
  });
}

async function sessionFor(targetId: string): Promise<BrowserSession> {
  const existing = sessions.get(targetId);
  if (existing) return existing;
  const pending = createSession(targetId).catch((error) => {
    sessions.delete(targetId);
    throw error;
  });
  sessions.set(targetId, pending);
  return pending;
}

async function activePage(session: BrowserSession): Promise<Page> {
  if (!session.page.isClosed()) return session.page;
  session.page = await session.context.newPage();
  attachEvidence(session, session.page);
  return session.page;
}

async function snapshotPage(page: Page): Promise<SnapshotNode[]> {
  return await page.locator(INTERACTIVE).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
      })
      .map((element, index) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const rect = element.getBoundingClientRect();
        const role = element.getAttribute("role") || element.tagName.toLowerCase();
        const label =
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          (input.labels?.[0]?.textContent ?? "") ||
          html.innerText?.trim() ||
          input.placeholder ||
          input.name ||
          "";
        return {
          ref: `@browser-${index}`,
          index,
          role,
          type: role,
          label: label.slice(0, 500),
          value: input.type === "password" ? "••••••••" : String(input.value ?? "").slice(0, 500),
          identifier: element.id || element.getAttribute("data-testid") || undefined,
          enabled: !(input.disabled || element.getAttribute("aria-disabled") === "true"),
          selected: element.getAttribute("aria-selected") === "true",
          focused: document.activeElement === element,
          visibleToUser: true,
          hittable: true,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }),
  );
}

function indexFromRef(ref?: string): number | undefined {
  const match = ref?.match(/browser-(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function quotedSelector(selector: string): { kind: "exact" | "contains"; value: string } | null {
  const match = selector.match(/label(\*?)="((?:\\.|[^"])*)"/);
  if (!match) return null;
  return {
    kind: match[1] === "*" ? "contains" : "exact",
    value: (match[2] ?? "").replaceAll('\\"', '"'),
  };
}

async function locatorFor(page: Page, input: { ref?: string; selector?: string }) {
  const index = indexFromRef(input.ref);
  if (index !== undefined) return page.locator(INTERACTIVE).nth(index);
  const parsed = input.selector ? quotedSelector(input.selector) : null;
  if (parsed) {
    const exact = parsed.kind === "exact";
    return page
      .getByLabel(parsed.value, { exact })
      .or(page.getByText(parsed.value, { exact }))
      .first();
  }
  throw new Error("browser interaction requires a recorded element or label");
}

function unsupported(capability: string): never {
  throw new Error(`capability unavailable for managed browser: ${capability}`);
}

/**
 * Adapts a managed browser to Relay's existing device contract. This keeps the
 * canonical recipe IR target-neutral while richer TargetAdapter APIs evolve.
 */
export async function getBrowserDevice(targetId: string): Promise<Device> {
  const session = await sessionFor(targetId);
  const api = {
    devices: {
      list: async () => [
        { id: targetId, name: "Managed browser", identifiers: { serial: targetId } },
      ],
    },
    apps: {
      open: async (input: { url?: string; app?: string; relaunch?: boolean }) => {
        const page = await activePage(session);
        if (input.url) await page.goto(input.url, { waitUntil: "domcontentloaded" });
        else if (input.app?.startsWith("http"))
          await page.goto(input.app, { waitUntil: "domcontentloaded" });
        return { ok: true };
      },
      close: async () => {
        await (await activePage(session)).close();
        return { ok: true };
      },
    },
    capture: {
      snapshot: async () => ({ nodes: await snapshotPage(await activePage(session)) }),
      screenshot: async (input: { path?: string }) => {
        const path = input.path;
        if (path) await mkdir(dirname(path), { recursive: true });
        const buffer = await (await activePage(session)).screenshot({ path, fullPage: false });
        return { path, base64: path ? undefined : buffer.toString("base64") };
      },
    },
    interactions: {
      press: async (input: { ref?: string; selector?: string; x?: number; y?: number }) => {
        const page = await activePage(session);
        if (input.x !== undefined && input.y !== undefined)
          await page.mouse.click(input.x, input.y);
        else await (await locatorFor(page, input)).click();
        return { ok: true };
      },
      longPress: async (input: {
        ref?: string;
        selector?: string;
        x?: number;
        y?: number;
        durationMs?: number;
      }) => {
        const page = await activePage(session);
        if (input.x !== undefined && input.y !== undefined) {
          await page.mouse.move(input.x, input.y);
          await page.mouse.down();
          await page.waitForTimeout(input.durationMs ?? 700);
          await page.mouse.up();
        } else {
          const locator = await locatorFor(page, input);
          const box = await locator.boundingBox();
          if (!box) throw new Error("target is not visible");
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(input.durationMs ?? 700);
          await page.mouse.up();
        }
        return { ok: true };
      },
      type: async (input: { text: string; ref?: string; selector?: string }) => {
        const page = await activePage(session);
        if (input.ref || input.selector) await (await locatorFor(page, input)).fill(input.text);
        else await page.keyboard.insertText(input.text);
        return { ok: true };
      },
      find: async (input: { query: string; action?: string }) => {
        const page = await activePage(session);
        const locator = page.getByText(input.query, { exact: false }).first();
        if ((input.action ?? "press") === "press") await locator.click();
        return { ok: true };
      },
      scroll: async (input: { direction?: string; amount?: number }) => {
        const amount = input.amount ?? 600;
        const y = input.direction === "up" ? -amount : amount;
        await (await activePage(session)).mouse.wheel(0, y);
        return { ok: true };
      },
      swipe: async (input: { startX?: number; startY?: number; endX?: number; endY?: number }) => {
        const page = await activePage(session);
        await page.mouse.move(input.startX ?? 640, input.startY ?? 650);
        await page.mouse.down();
        await page.mouse.move(input.endX ?? 640, input.endY ?? 150, { steps: 12 });
        await page.mouse.up();
        return { ok: true };
      },
    },
    command: {
      wait: async (input: { durationMs?: number; text?: string; selector?: string }) => {
        const page = await activePage(session);
        if (input.text) await page.getByText(input.text, { exact: false }).first().waitFor();
        else if (input.selector) await page.locator(input.selector).first().waitFor();
        else await page.waitForTimeout(input.durationMs ?? 0);
        return { ok: true };
      },
      back: async () => ({ ok: await (await activePage(session)).goBack().then(() => true) }),
      home: async () => {
        const target = await readTarget(targetId);
        if (!target?.browser) throw new Error("browser target no longer exists");
        await (await activePage(session)).goto(target.browser.startUrl);
        return { ok: true };
      },
      clipboard: async (input: { action: "read" | "write"; text?: string }) => {
        const page = await activePage(session);
        if (input.action === "write") {
          await page.evaluate((text) => navigator.clipboard.writeText(text), input.text ?? "");
          return { action: "write" };
        }
        return { action: "read", text: await page.evaluate(() => navigator.clipboard.readText()) };
      },
      keyboard: async (input: { action: string }) => {
        await (
          await activePage(session)
        ).keyboard.press(input.action === "enter" ? "Enter" : "Escape");
        return { ok: true };
      },
      alert: async () => unsupported("native alerts"),
      appSwitcher: async () => unsupported("app switcher"),
      rotate: async () => unsupported("rotation"),
    },
    settings: { update: async () => unsupported("device settings") },
    observability: {
      perf: async () => {
        const page = await activePage(session);
        return await page.evaluate(() => ({
          url: location.href,
          title: document.title,
          navigation: performance.getEntriesByType("navigation")[0]?.toJSON?.() ?? null,
          resources: performance.getEntriesByType("resource").length,
        }));
      },
      logs: async () => ({ entries: [...session.console] }),
      network: async () => ({ entries: [...session.network] }),
    },
    recording: {
      record: async (input: { action: "start" | "stop"; path?: string }) => {
        if (input.action === "start") {
          session.recordingPath = input.path;
          if (session.recordingUnavailable) {
            return { started: false, warning: session.recordingUnavailable };
          }
          session.recordingVideo = (await activePage(session)).video();
          return { started: Boolean(session.recordingVideo) };
        }
        const page = await activePage(session);
        const returnUrl = page.url();
        const output = session.recordingPath?.replace(/\.mp4$/i, ".webm");
        await page.close();
        if (output && session.recordingVideo) {
          await mkdir(dirname(output), { recursive: true });
          await session.recordingVideo.saveAs(output);
        }
        session.page = await session.context.newPage();
        attachEvidence(session, session.page);
        if (returnUrl && returnUrl !== "about:blank") {
          await session.page.goto(returnUrl, { waitUntil: "domcontentloaded" });
        }
        session.recordingVideo = null;
        return { stopped: true, path: output };
      },
    },
  };
  return api as unknown as Device;
}

export async function closeBrowserTarget(targetId?: string): Promise<void> {
  const entries: Array<[string, Promise<BrowserSession> | undefined]> = targetId
    ? [[targetId, sessions.get(targetId)]]
    : [...sessions.entries()];
  for (const [id, pending] of entries) {
    if (!pending) continue;
    sessions.delete(id);
    const session = await pending.catch(() => null);
    await session?.context.close().catch(() => undefined);
  }
}
