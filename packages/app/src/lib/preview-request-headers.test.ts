import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewRequestHeaders } from "./preview-request-headers.js";

describe("previewRequestHeaders", () => {
  it("keeps project and viewer attribution in headers, not a stream URL", () => {
    assert.deepEqual(
      previewRequestHeaders({
        organizationId: "org-a",
        projectId: "project-a",
        actorId: "human:viewer",
        actorKind: "human",
        auth: { type: "bearer", token: "secret" },
      }),
      {
        "X-Organization-Id": "org-a",
        "X-Project-Id": "project-a",
        "X-Relay-Actor-Id": "human:viewer",
        "X-Relay-Actor-Kind": "human",
        Authorization: "Bearer secret",
      },
    );
  });

  it("supports trusted-local preview without manufacturing credentials", () => {
    assert.deepEqual(
      previewRequestHeaders({
        organizationId: "local",
        projectId: "default",
        actorId: "human:local",
        actorKind: "human",
        auth: { type: "none" },
      }),
      {
        "X-Organization-Id": "local",
        "X-Project-Id": "default",
        "X-Relay-Actor-Id": "human:local",
        "X-Relay-Actor-Kind": "human",
      },
    );
  });

  it("does not guess a connection", () => {
    assert.deepEqual(previewRequestHeaders(undefined), {});
  });
});
