import { runsRoot } from "@relay/core";
import { serverOperationManifest } from "./operations.js";
import type { RequestContext } from "./security.js";

export const PRODUCT_VERSION = "0.1.0";

export function serverMeta(scope: RequestContext) {
  return {
    name: "relay",
    description: "Relay app graph authoring and testing server",
    version: PRODUCT_VERSION,
    runsDir: scope.localTrusted ? runsRoot() : "runs",
    operations: serverOperationManifest(),
    resources: [
      { method: "POST", path: "/goal", mediaType: "application/json" },
      { method: "POST", path: "/explore", mediaType: "application/json" },
      { method: "GET", path: "/goal/:id", mediaType: "application/json" },
      { method: "GET", path: "/explore/:id", mediaType: "application/json" },
      { method: "POST", path: "/goal/:id/resume", mediaType: "application/json" },
      { method: "POST", path: "/explore/:id/resume", mediaType: "application/json" },
      { method: "POST", path: "/goal/:id/reproduce", mediaType: "application/json" },
      { method: "POST", path: "/goal/:id/promote", mediaType: "application/json" },
      { method: "GET", path: "/events", mediaType: "text/event-stream" },
      { method: "GET", path: "/device/stream", mediaType: "application/x-relay-h264" },
      { method: "GET", path: "/runs/:id/frames/:file", mediaType: "image/*" },
      { method: "GET", path: "/runs/:id/video/:file", mediaType: "video/*" },
      { method: "GET", path: "/runs/:id/evidence", mediaType: "application/json" },
      { method: "GET", path: "/authoring-evidence/:sha256", mediaType: "image/*|video/*" },
    ],
  };
}
