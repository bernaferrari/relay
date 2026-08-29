import type http from "node:http";

export function setCorsOrigin(response: http.ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  const existing = response.getHeader("Vary");
  const vary = Array.isArray(existing) ? existing.join(", ") : existing;
  response.setHeader("Vary", vary ? `${vary}, Origin` : "Origin");
}

/** Browser preflights cannot carry the bearer itself. They may be reflected
 * only when the browser declares it will send Authorization on the real
 * request, which remains fully authenticated before any route is invoked. */
export function requestsBearerAuthentication(req: http.IncomingMessage): boolean {
  const requestedMethod = req.headers["access-control-request-method"];
  const requestedHeaders = req.headers["access-control-request-headers"];
  const headerList = Array.isArray(requestedHeaders)
    ? requestedHeaders.join(",")
    : (requestedHeaders ?? "");
  return (
    Boolean(requestedMethod) &&
    headerList.split(",").some((value) => value.trim().toLowerCase() === "authorization")
  );
}
