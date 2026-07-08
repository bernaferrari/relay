/** Small HTTP helpers shared by the server context. */

export function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export function asArray<T>(value: unknown, key?: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === "object" &&
    key &&
    Array.isArray((value as Record<string, unknown>)[key])
  ) {
    return (value as Record<string, unknown>)[key] as T[];
  }
  return [];
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type LogLevel = "info" | "success" | "error" | "default";

export function levelFromLine(text: string): LogLevel {
  if (/FAIL|error|Error|ERR/i.test(text)) return "error";
  if (/DONE|ok|success|healed/i.test(text)) return "success";
  if (/^==>|^\[|health|poll|job\./i.test(text)) return "info";
  return "default";
}

/**
 * JSON fetch against the local API with timeout + error unwrapping.
 */
export async function apiRequest<T = unknown>(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err instanceof DOMException || err instanceof Error) && err.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
