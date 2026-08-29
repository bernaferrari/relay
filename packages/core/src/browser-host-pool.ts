import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  LaunchOptions,
} from "playwright-core";
import type { BrowserEngine } from "@relay/protocol";

/** The immutable identity of a browser process. Context-only settings must not
 * appear here: they are applied to a fresh context for each proof Run. */
export type BrowserHostIdentity = Readonly<{
  engine: BrowserEngine;
  channel?: string;
  revision?: string;
  launchOptions: LaunchOptions;
}>;

export type BrowserHostPoolOptions = Readonly<{
  maxHosts?: number;
  maxContextsPerHost?: number;
  launchBrowser?: (browserType: BrowserType, options: LaunchOptions) => Promise<Browser>;
}>;

export type BrowserContextLease = Readonly<{
  context: BrowserContext;
  browser: Browser;
  identity: BrowserHostIdentity;
  close: () => Promise<void>;
}>;

export type BrowserHostPoolStats = Readonly<{
  hosts: number;
  contexts: number;
  drainingHosts: number;
  maxHosts: number;
  maxContextsPerHost: number;
}>;

export class BrowserHostPoolLimitError extends Error {
  readonly code = "BROWSER_HOST_POOL_LIMIT" as const;

  constructor(message: string) {
    super(message);
    this.name = "BrowserHostPoolLimitError";
  }
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

/** Convert launch options into a deterministic key. LaunchOptions is a broad
 * Playwright type and can contain a signal or other non-JSON values; those
 * values are intentionally represented as type markers rather than causing
 * two compatible hosts to share accidentally. */
const objectIdentity = new WeakMap<object, number>();
let nextObjectIdentity = 1;

function canonicalLaunchValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") {
    const existing = objectIdentity.get(value);
    if (existing !== undefined) return `[function#${existing}]`;
    const id = nextObjectIdentity++;
    objectIdentity.set(value, id);
    return `[function#${id}]`;
  }
  if (typeof value !== "object") return `[${typeof value}]`;
  if (value instanceof Date) return `[date:${value.toISOString()}]`;
  if (Buffer.isBuffer(value)) return `[buffer:${value.toString("base64")}]`;
  if (seen.has(value)) return "[circular]";
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && !Array.isArray(value)) {
    const existing = objectIdentity.get(value);
    if (existing !== undefined) return `[object#${existing}]`;
    const id = nextObjectIdentity++;
    objectIdentity.set(value, id);
    return `[${prototype?.constructor?.name ?? "object"}#${id}]`;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => canonicalLaunchValue(item, seen));
    seen.delete(value);
    return result;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "signal")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalLaunchValue(item, seen)] as const);
  seen.delete(value);
  return Object.fromEntries(entries);
}

function hostKey(identity: BrowserHostIdentity): string {
  return JSON.stringify({
    engine: identity.engine,
    channel: identity.channel ?? null,
    revision: identity.revision ?? null,
    launchOptions: canonicalLaunchValue(identity.launchOptions),
  });
}

type HostRecord = {
  key: string;
  identity: BrowserHostIdentity;
  activeContexts: number;
  draining: boolean;
  disconnected: boolean;
  browser?: Browser;
  ready: Promise<Browser>;
  closePromise?: Promise<void>;
  resolveClosed: () => void;
  closed: Promise<void>;
};

/**
 * Reuses browser processes while keeping proof state in fresh contexts.
 *
 * A host is selected only by its complete launch identity. Context admission
 * reserves a slot before launching/creating anything, so concurrent callers
 * cannot exceed either bound. A disconnected browser is immediately evicted;
 * it is never returned for a later Run.
 */
export class BrowserHostPool {
  readonly maxHosts: number;
  readonly maxContextsPerHost: number;
  private readonly launchBrowser: (
    browserType: BrowserType,
    options: LaunchOptions,
  ) => Promise<Browser>;
  private readonly hosts = new Set<HostRecord>();
  private closed = false;

  constructor(options: BrowserHostPoolOptions = {}) {
    this.maxHosts = positiveLimit(options.maxHosts, 4, "maxHosts");
    this.maxContextsPerHost = positiveLimit(options.maxContextsPerHost, 16, "maxContextsPerHost");
    this.launchBrowser =
      options.launchBrowser ?? ((browserType, launchOptions) => browserType.launch(launchOptions));
  }

  getStats(): BrowserHostPoolStats {
    return {
      hosts: this.hosts.size,
      contexts: [...this.hosts].reduce((total, host) => total + host.activeContexts, 0),
      drainingHosts: [...this.hosts].filter((host) => host.draining).length,
      maxHosts: this.maxHosts,
      maxContextsPerHost: this.maxContextsPerHost,
    };
  }

  async openContext(input: {
    identity: BrowserHostIdentity;
    browserType: BrowserType;
    contextOptions: BrowserContextOptions;
  }): Promise<BrowserContextLease> {
    if (this.closed) throw new Error("browser host pool is closed");
    const key = hostKey(input.identity);
    const host = this.reserveHost(key, input);
    try {
      const browser = await host.ready;
      if (host.disconnected || host.draining || this.closed) {
        throw new Error("browser host became unavailable while opening a context");
      }
      const context = await browser.newContext(input.contextOptions);
      let released = false;
      const close = async (): Promise<void> => {
        if (released) return;
        released = true;
        let firstError: unknown;
        try {
          await context.close();
        } catch (error) {
          // A host crash already destroyed its contexts. Do not turn cleanup
          // after that crash into a second, misleading failure.
          if (!host.disconnected) firstError = error;
        } finally {
          this.releaseContext(host);
        }
        if (firstError) throw firstError;
      };
      return { context, browser, identity: input.identity, close };
    } catch (error) {
      this.releaseContext(host);
      throw error;
    }
  }

  /** Stop admitting new contexts for matching hosts and wait for active
   * contexts to close. The pool itself remains usable for later hosts. */
  async drain(identity?: BrowserHostIdentity): Promise<void> {
    const key = identity ? hostKey(identity) : undefined;
    const selected = [...this.hosts].filter((host) => key === undefined || host.key === key);
    await Promise.all(selected.map((host) => this.beginDrain(host)));
  }

  /** Force every browser process to close. This is intended for process
   * shutdown; outstanding context leases become inert and cannot reopen hosts. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const closers = [...this.hosts].map((host) => this.closeHost(host));
    await Promise.all(closers);
  }

  private reserveHost(
    key: string,
    input: {
      identity: BrowserHostIdentity;
      browserType: BrowserType;
      contextOptions: BrowserContextOptions;
    },
  ): HostRecord {
    const existing = [...this.hosts].find(
      (host) => host.key === key && !host.draining && host.activeContexts < this.maxContextsPerHost,
    );
    if (existing) {
      existing.activeContexts += 1;
      return existing;
    }
    if (this.hosts.size >= this.maxHosts) {
      throw new BrowserHostPoolLimitError(
        `browser host pool exhausted (${this.maxHosts} hosts, ${this.maxContextsPerHost} contexts per host)`,
      );
    }
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const host: HostRecord = {
      key,
      identity: input.identity,
      activeContexts: 1,
      draining: false,
      disconnected: false,
      ready: Promise.resolve(undefined as never),
      resolveClosed,
      closed,
    };
    this.hosts.add(host);
    host.ready = this.launchBrowser(input.browserType, input.identity.launchOptions).then(
      (browser) => {
        host.browser = browser;
        browser.on("disconnected", () => {
          host.disconnected = true;
          host.draining = true;
          this.hosts.delete(host);
          host.resolveClosed();
        });
        if (host.draining || this.closed) void this.closeHost(host);
        return browser;
      },
      (error) => {
        this.hosts.delete(host);
        host.disconnected = true;
        host.resolveClosed();
        throw error;
      },
    );
    return host;
  }

  private releaseContext(host: HostRecord): void {
    host.activeContexts = Math.max(0, host.activeContexts - 1);
    if (host.draining && host.activeContexts === 0) void this.closeHost(host);
  }

  private async beginDrain(host: HostRecord): Promise<void> {
    host.draining = true;
    if (host.activeContexts === 0) await this.closeHost(host);
    else await host.closed;
  }

  private closeHost(host: HostRecord): Promise<void> {
    if (host.closePromise) return host.closePromise;
    host.draining = true;
    this.hosts.delete(host);
    host.closePromise = (async () => {
      try {
        const browser = host.browser ?? (await host.ready.catch(() => undefined));
        if (browser && !host.disconnected) await browser.close();
      } finally {
        this.hosts.delete(host);
        host.resolveClosed();
      }
    })();
    return host.closePromise;
  }
}

export const browserHostPool = new BrowserHostPool();

export async function closeBrowserHostPool(): Promise<void> {
  await browserHostPool.close();
}
