/** The authenticated XCTest listener wire contract used by adopted usbmux sessions. */
export function isIosRunnerListenerToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
}

export function encodeIosRunnerCommand(token: unknown, command: Record<string, unknown>): Buffer {
  if (!isIosRunnerListenerToken(token)) {
    throw new Error("The iOS runner needs an authenticated listener. Reconnect the device.");
  }
  const body = Buffer.from(JSON.stringify(command), "utf8");
  return Buffer.concat([
    Buffer.from(
      `POST /command HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nX-Agent-Device-Runner-Token: ${token}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      "utf8",
    ),
    body,
  ]);
}

export function decodeIosRunnerReply(raw: Buffer): Record<string, unknown> {
  const separator = raw.indexOf("\r\n\r\n");
  if (separator < 0) throw new Error("Live XCTest listener returned no HTTP body");
  const [statusLine, ...headers] = raw.subarray(0, separator).toString("utf8").split("\r\n");
  const status = Number(statusLine?.match(/^HTTP\/1\.[01] (\d{3})(?: |$)/u)?.[1]);
  const auth = headers.filter((header) => /^x-agent-device-runner-auth:/iu.test(header));
  if (
    !Number.isInteger(status) ||
    auth.length !== 1 ||
    auth[0]!.slice(auth[0]!.indexOf(":") + 1).trim() !== "required" ||
    status === 401 ||
    status === 403
  ) {
    throw new Error(
      "The iOS listener did not confirm runner authentication. Reconnect the device.",
    );
  }
  const payload = raw
    .subarray(separator + 4)
    .toString("utf8")
    .trim();
  if (!payload) throw new Error("Live XCTest listener returned an empty response");
  const result: unknown = JSON.parse(payload);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Live XCTest listener returned an invalid response");
  }
  return result as Record<string, unknown>;
}
