import type http from "node:http";
import type { RequestContext } from "./security.js";

export type AppMapRouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};
