import assert from "node:assert/strict";
import test from "node:test";
import { leaseBelongsToConnection } from "./device-control-session.js";

test("local Relay windows join a project control session without impersonating its owner", () => {
  const lease = {
    ownerId: "system:local-control:cHJvamVjdA",
    controlScope: "local-project" as const,
  };
  assert.equal(
    leaseBelongsToConnection({ actorId: "human:window-a", auth: { type: "none" } }, lease),
    true,
  );
  assert.equal(
    leaseBelongsToConnection(
      { actorId: "agent:local", auth: { type: "service-token", token: "secret" } },
      lease,
    ),
    false,
  );
});

test("actor leases remain exclusive", () => {
  const lease = { ownerId: "agent:runner", controlScope: "actor" as const };
  assert.equal(
    leaseBelongsToConnection({ actorId: "agent:runner", auth: { type: "none" } }, lease),
    true,
  );
  assert.equal(
    leaseBelongsToConnection({ actorId: "human:window", auth: { type: "none" } }, lease),
    false,
  );
});
