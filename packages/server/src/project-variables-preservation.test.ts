import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  createAppMap,
  loadRedactionPolicy,
  mutateStoredAppMap,
  readProjectVariables,
  resetControlDatabaseCache,
  writeProjectVariables,
} from "@relay/core";
import { REDACTED } from "@relay/protocol";
import { startServer } from "./index.js";

test("canonical variable update preserves redacted stored definitions with scoped revision fences", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-http-input-preservation-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousPolicy = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_REDACTION_MODE = "on";
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "local",
      projectId: "prompt-project",
      actorId: "human:input-editor",
      actorKind: "human",
    });
    const original = await writeProjectVariables("prompt-project", {
      expectedRevision: 0,
      value: [
        {
          id: "secret",
          name: "secret_input",
          scope: "shared",
          source: "static",
          sensitive: true,
          values: ["Bearer exact-private-token"],
          fallback: "Bearer exact-private-fallback",
        },
        {
          id: "public-token",
          name: "public_token",
          scope: "shared",
          source: "static",
          values: ["Bearer public-token-still-masked"],
        },
        {
          id: "private",
          name: "private_input",
          scope: "private",
          source: "generated",
          prompt: "Supply locally",
        },
      ],
    });
    await writeProjectVariables("other-project", {
      expectedRevision: 0,
      value: [
        {
          id: "other",
          name: "other",
          scope: "shared",
          source: "static",
          values: ["Other Project"],
        },
      ],
    });
    const projection = await client.variables();
    assert.ok(projection.value[0]!.values![0]!.includes(REDACTED));
    assert.ok(projection.value[1]!.values![0]!.includes(REDACTED));
    const values = ["  Prompt one\nwith another line.\n ", "\nPrompt two.  "];
    const saved = await client.updateVariables({
      expectedRevision: projection.revision,
      value: [{ id: "prompt", name: "chat_prompt", scope: "shared", source: "list", values }],
      preserveInputIds: projection.value.map((item) => item.id),
    });
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.value.at(-1)!.values, values);
    const actual = await readProjectVariables("prompt-project");
    assert.deepEqual(actual.value.slice(0, 3), original.value);
    assert.deepEqual(actual.value.at(-1)!.values, values);
    assert.deepEqual((await readProjectVariables("other-project")).value[0]!.values, [
      "Other Project",
    ]);
    await assert.rejects(
      client.updateVariables({
        expectedRevision: 1,
        value: [],
        preserveInputIds: actual.value.map((item) => item.id),
      }),
      (error) => error instanceof ApiError && error.status === 409,
    );
    await assert.rejects(
      client.updateVariables({
        expectedRevision: 2,
        value: [],
        preserveInputIds: ["secret", "secret"],
      }),
      (error) =>
        error instanceof ApiError && error.status === 400 && /duplicated/.test(error.message),
    );
    await createAppMap({
      organizationId: "local",
      projectId: "prompt-project",
      appMapId: "other-app",
      name: "Other App",
    });
    await mutateStoredAppMap("prompt-project", "other-app", (map) => ({
      ...map,
      revision: map.revision + 1,
      variables: {
        linked: {
          id: "linked",
          organizationId: "local",
          projectId: "prompt-project",
          appMapId: map.id,
          createdAt: 1,
          updatedAt: 1,
          name: "Saved prompts",
          kind: "custom",
          apply: { kind: "input", inputId: "prompt" },
          options: [{ id: "value-1", value: values[0]! }],
        },
      },
    }));
    await assert.rejects(
      client.updateVariables({
        expectedRevision: 2,
        value: [
          {
            id: "prompt",
            name: "chat_prompt",
            scope: "shared",
            source: "list",
            values: ["Changed"],
          },
        ],
        preserveInputIds: ["secret", "public-token", "private"],
        requireUnlinkedInputIds: ["prompt"],
      }),
      (error) =>
        error instanceof ApiError &&
        error.status === 409 &&
        /already used by an App/.test(error.message),
    );
    assert.equal((await readProjectVariables("prompt-project")).revision, 2);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousPolicy === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousPolicy;
    await loadRedactionPolicy();
    await rm(root, { recursive: true, force: true });
  }
});
