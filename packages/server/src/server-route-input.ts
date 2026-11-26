import type http from "node:http";
import type { URL } from "node:url";
import type { RequestContext } from "./security.js";

/** Canonical per-request input shared by every domain route handler. Handlers
 * destructure only the fields they need; the dispatcher builds one object per
 * request instead of reassembling the same literal at every dispatch site. */
export type ServerRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};
