import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RevisionConflict, type TestData } from "@relay/protocol";
import {
  createAppMap,
  mutateStoredAppMap,
  readProjectVariables,
  resetControlDatabaseCache,
  writeProjectVariables,
} from "./collaboration.js";
import { withControlStore } from "./collaboration-store.js";
import { validateProjectVariables } from "./project-variable-update.js";

const prompt: TestData = {
  id: "prompt",
  name: "chat_prompt",
  scope: "shared",
  source: "list",
  values: ["Original prompt"],
};
const secret: TestData = {
  id: "secret",
  name: "secret_input",
  scope: "shared",
  source: "static",
  sensitive: true,
  values: ["  Bearer exact-original-secret  "],
  fallback: "  Secret fallback  ",
};
const generated: TestData = {
  id: "generated",
  name: "generated_prompt",
  scope: "shared",
  source: "generated",
  values: ["  Stored legacy spacing  "],
  prompt: "  Generate one prompt  ",
};

async function fixture(run: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-project-preservation-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  try {
    await withControlStore((store) =>
      store.upsertVariables("project", {
        revision: 7,
        updatedAt: 1,
        value: [secret, prompt, generated],
      }),
    );
    await run();
  } finally {
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("partial Project variable update preserves exact stored records and replacement position", async () => {
  await fixture(async () => {
    const values = ["  First line\nSecond line.\n ", "\nSecond prompt.  "];
    const edited = { ...prompt, values };
    const next = await writeProjectVariables("project", {
      expectedRevision: 7,
      value: [edited],
      preserveInputIds: [secret.id, generated.id],
    });
    assert.equal(next.revision, 8);
    assert.deepEqual(next.value, [secret, edited, generated]);
    assert.deepEqual((await readProjectVariables("project")).value, next.value);
    assert.equal((await readProjectVariables("another-project")).revision, 0);
  });
});

test("preservation rejects duplicate, missing, overlapping, malformed IDs and name conflicts atomically", async () => {
  await fixture(async () => {
    const attempts = [
      { value: [prompt], preserveInputIds: [secret.id, secret.id], message: /duplicated/ },
      { value: [prompt], preserveInputIds: ["missing"], message: /does not exist/ },
      { value: [prompt], preserveInputIds: [prompt.id], message: /edited and preserved/ },
      { value: [prompt], preserveInputIds: [" secret"], message: /exact nonempty/ },
      { value: [prompt, prompt], preserveInputIds: [secret.id], message: /duplicated/ },
      {
        value: [{ ...prompt, name: secret.name }],
        preserveInputIds: [secret.id],
        message: /duplicated/,
      },
    ];
    for (const attempt of attempts) {
      await assert.rejects(
        writeProjectVariables("project", { expectedRevision: 7, ...attempt }),
        attempt.message,
      );
      assert.deepEqual((await readProjectVariables("project")).value, [secret, prompt, generated]);
      assert.equal((await readProjectVariables("project")).revision, 7);
    }
  });
});

test("preservation resolves stored IDs only under the expected current revision", async () => {
  await fixture(async () => {
    await assert.rejects(
      writeProjectVariables("project", {
        expectedRevision: 6,
        value: [{ ...prompt, values: ["Changed"] }],
        preserveInputIds: ["missing"],
      }),
      (error) => error instanceof RevisionConflict && error.current.revision === 7,
    );
    assert.deepEqual((await readProjectVariables("project")).value, [secret, prompt, generated]);
  });
});

test("preserved legacy names retain their stored text while rejecting duplicate trimmed aliases", async () => {
  await fixture(async () => {
    const legacy = { ...secret, name: `  ${secret.name}  ` };
    await withControlStore((store) =>
      store.upsertVariables("project", {
        revision: 7,
        updatedAt: 1,
        value: [legacy, prompt, generated],
      }),
    );
    await assert.rejects(
      writeProjectVariables("project", {
        expectedRevision: 7,
        value: [{ ...prompt, name: secret.name }],
        preserveInputIds: [secret.id, generated.id],
      }),
      /duplicated/,
    );
    assert.deepEqual((await readProjectVariables("project")).value, [legacy, prompt, generated]);
  });
});

test("omitting preservation retains full replacement semantics", async () => {
  await fixture(async () => {
    const next = await writeProjectVariables("project", { expectedRevision: 7, value: [prompt] });
    assert.deepEqual(next.value, [prompt]);
  });
});

test("preservation idempotency fingerprints the request rather than a later stored catalog", async () => {
  await fixture(async () => {
    const write = {
      expectedRevision: 7,
      value: [{ ...prompt, values: ["First edit"] }],
      preserveInputIds: [secret.id, generated.id],
      idempotencyKey: "same-edit",
      actorId: "human:test",
    };
    const saved = await writeProjectVariables("project", write);
    const repeated = await writeProjectVariables("project", write);
    assert.deepEqual(repeated, saved);
    await assert.rejects(
      writeProjectVariables("project", {
        ...write,
        value: [{ ...prompt, values: ["Different edit"] }],
      }),
      /different variable input/,
    );
    assert.deepEqual((await readProjectVariables("project")).value, saved.value);
  });
});

test("only public static/list literals retain authored whitespace during ordinary validation", () => {
  const value = "  First\nSecond  ";
  const result = validateProjectVariables([
    { ...prompt, values: [value, " \n "] },
    { ...secret, values: [value] },
    { ...generated, values: [value] },
    { id: "private", name: "private", scope: "private", source: "static" },
  ]);
  assert.deepEqual(result[0]!.values, [value]);
  assert.deepEqual(result[1]!.values, [value.trim()]);
  assert.deepEqual(result[2]!.values, [value.trim()]);
  assert.equal(result[3]!.values, undefined);
});

test("unlinked edit guard rejects a Project App linking after the catalog read", async () => {
  await fixture(async () => {
    const before = await readProjectVariables("project");
    await createAppMap({
      organizationId: "local",
      projectId: "project",
      appMapId: "other-app",
      name: "Other App",
    });
    await mutateStoredAppMap("project", "other-app", (map) => ({
      ...map,
      revision: map.revision + 1,
      variables: {
        linked: {
          id: "linked",
          organizationId: "local",
          projectId: "project",
          appMapId: map.id,
          createdAt: 1,
          updatedAt: 1,
          name: "Saved prompts",
          kind: "custom",
          apply: { kind: "input", inputId: prompt.id },
          options: [{ id: "value-1", value: prompt.values![0]! }],
        },
      },
    }));
    assert.equal((await readProjectVariables("project")).revision, before.revision);
    await assert.rejects(
      writeProjectVariables("project", {
        expectedRevision: before.revision,
        value: [{ ...prompt, values: ["Changed after link"] }],
        preserveInputIds: [secret.id, generated.id],
        requireUnlinkedInputIds: [prompt.id],
      }),
      /already used by an App in this Project/,
    );
    assert.deepEqual(await readProjectVariables("project"), before);
    // Advanced callers without this optional editor guard retain deliberate
    // replacement semantics; Run admission independently checks approval.
    const advanced = await writeProjectVariables("project", {
      expectedRevision: before.revision,
      value: [{ ...prompt, values: ["Explicit advanced edit"] }],
      preserveInputIds: [secret.id, generated.id],
    });
    assert.equal(advanced.revision, before.revision + 1);
  });
});

test("unlinked guard rejects missing, duplicate IDs and unreadable Project Maps", async () => {
  await fixture(async () => {
    for (const requireUnlinkedInputIds of [["missing"], [prompt.id, prompt.id]])
      await assert.rejects(
        writeProjectVariables("project", {
          expectedRevision: 7,
          value: [prompt],
          preserveInputIds: [secret.id, generated.id],
          requireUnlinkedInputIds,
        }),
        /does not exist|duplicated/,
      );
    const map = await createAppMap({
      organizationId: "local",
      projectId: "project",
      appMapId: "unreadable",
      name: "Unreadable App",
    });
    await withControlStore((store) => {
      // @ts-expect-error Deliberately corrupt the stored schema to exercise unreadable App admission.
      return store.upsertAppMap("project:unreadable", { ...map, schemaVersion: 999 });
    });
    await assert.rejects(
      writeProjectVariables("project", {
        expectedRevision: 7,
        value: [prompt],
        preserveInputIds: [secret.id, generated.id],
        requireUnlinkedInputIds: [prompt.id],
      }),
      /Apps are unavailable/,
    );
    assert.equal((await readProjectVariables("project")).revision, 7);
  });
});

test("unlinked admission is part of the idempotency request identity", async () => {
  await fixture(async () => {
    const write = {
      expectedRevision: 7,
      value: [prompt],
      preserveInputIds: [secret.id, generated.id],
      requireUnlinkedInputIds: [prompt.id],
      idempotencyKey: "unlinked-edit",
    };
    await writeProjectVariables("project", write);
    await assert.rejects(
      writeProjectVariables("project", { ...write, requireUnlinkedInputIds: [] }),
      /different variable input/,
    );
  });
});
