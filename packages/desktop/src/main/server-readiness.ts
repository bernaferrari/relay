import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type ServerProbeOptions = {
  product: string;
  version: string;
  timeoutMs?: number;
  authorizationToken?: string;
};

export async function isCompatibleServer(
  url: string,
  options: ServerProbeOptions,
): Promise<boolean> {
  const healthUrl = new URL(`${url.replace(/\/+$/, "")}/health`);
  const request = healthUrl.protocol === "https:" ? httpsRequest : httpRequest;

  return await new Promise((resolveHealthy) => {
    const requestId = crypto.randomUUID();
    const req = request(
      healthUrl,
      {
        method: "GET",
        headers: {
          "X-Relay-Actor-Id": "system:desktop-main",
          "X-Relay-Actor-Kind": "system",
          "X-Relay-Operation-Id": "system.health.get",
          "X-Relay-Request-Id": requestId,
          "X-Relay-Command-At": String(Date.now()),
          "Idempotency-Key": requestId,
          ...(options.authorizationToken
            ? { Authorization: `Bearer ${options.authorizationToken}` }
            : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes <= 64 * 1024) chunks.push(chunk);
        });
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            resolveHealthy(false);
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              product?: unknown;
              version?: unknown;
            };
            resolveHealthy(body.product === options.product && body.version === options.version);
          } catch {
            resolveHealthy(false);
          }
        });
      },
    );
    req.setTimeout(options.timeoutMs ?? 800, () => {
      req.destroy();
      resolveHealthy(false);
    });
    req.on("error", () => resolveHealthy(false));
    req.end();
  });
}

export async function waitForCompatibleServer(
  url: string,
  options: ServerProbeOptions & { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 200;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isCompatibleServer(url, options)) return true;
    if (attempt + 1 < attempts) {
      await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
    }
  }
  return false;
}
