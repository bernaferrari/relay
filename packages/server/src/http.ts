import { createHash } from "node:crypto";
import type http from "node:http";
import { redactPrivateJobs, redactValue } from "@relay/core";
import { validateOperationBody, validateOperationResponse } from "./operations.js";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Organization-Id, X-Project-Id, X-Relay-Actor-Id, X-Relay-Actor-Kind, X-Relay-Operation-Id, X-Relay-Request-Id, X-Relay-Command-At, X-Relay-Causation-Id, X-Relay-Correlation-Id, X-Relay-Authoring-Session-Id, Idempotency-Key, Last-Event-ID",
  "Access-Control-Expose-Headers": "Content-Length, ETag, X-Relay-Browser-Device-Transport",
  "Access-Control-Max-Age": "600",
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  validateOperationResponse(res, status, body);
  const payload = JSON.stringify(redactValue(redactPrivateJobs(body)));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
    ...CORS_HEADERS,
  });
  res.end(payload);
}

/**
 * A GET whose body is fully determined by `version` (for example App Map ids
 * and revisions). Clients revalidate with If-None-Match; an unchanged body is
 * answered with 304 before it is validated, redacted, or serialized.
 */
export function jsonIfChanged(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  version: string,
  body: () => unknown,
): void {
  const etag = `W/"${createHash("sha1").update(version).digest("base64url")}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache" };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { ...headers, ...CORS_HEADERS });
    res.end();
    return;
  }
  json(res, 200, body(), headers);
}

export function text(
  res: http.ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

export function parseLimit(raw: string | null, fallback: number, max = 200): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, `Request body too large (max ${maxBytes} bytes)`));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        settle(() => reject(new HttpError(413, `Request body too large (max ${maxBytes} bytes)`)));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => settle(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (error) => settle(() => reject(error)));
  });
}

export async function parseJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const raw = await readBody(req, maxBytes);
  if (!raw.trim()) {
    const body = {};
    validateOperationBody(req, body);
    return body;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  validateOperationBody(req, body);
  return body;
}

export function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index++) {
    const segment = expected[index]!;
    const value = actual[index]!;
    if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }
  return params;
}
