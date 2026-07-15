import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearSuitesForTests,
  createSuiteRunManifest,
  deleteSuite,
  listSuiteHistory,
  listSuites,
  readSuite,
  restoreSuiteHistory,
  saveSuite,
} from "./suites.js";

let previousCwd = "";

before(async () => {
  previousCwd = process.cwd();
  process.chdir(await mkdtemp(join(tmpdir(), "relay-suites-")));
});

after(async () => {
  await clearSuitesForTests();
  process.chdir(previousCwd);
});

describe("test suites", () => {
  it("stores reusable test references and preserves edit history", async () => {
    const created = await saveSuite({
      title: "Release confidence",
      sections: [
        {
          title: "Chat",
          entries: [{ testId: "type-message" }, { testId: "new-chat", enabled: false }],
        },
      ],
    });
    assert.equal((await listSuites()).length, 1);
    assert.equal((await readSuite(created.id))?.sections[0]?.entries[0]?.version, "latest");

    const edited = await saveSuite({
      id: created.id,
      title: created.title,
      sections: [...created.sections, { title: "Settings", entries: [] }],
    });
    assert.equal(edited.sections.length, 2);
    assert.ok(edited.updatedAt > created.updatedAt);
    assert.equal((await listSuiteHistory(created.id))[0]?.updatedAt, created.updatedAt);

    const restored = await restoreSuiteHistory(created.id, created.updatedAt);
    assert.equal(restored.sections.length, 1);
    await deleteSuite(created.id);
    assert.equal(await readSuite(created.id), null);
  });

  it("allows every section to be removed before a suite is rebuilt", async () => {
    const suite = await saveSuite({ title: "Empty release", sections: [] });
    assert.deepEqual(suite.sections, []);
  });

  it("freezes enabled test revisions into a run manifest", async () => {
    const suite = await saveSuite({
      title: "Smoke",
      sections: [
        {
          title: "Chat",
          entries: [
            { testId: "send", inputs: { prompt: "Hello" } },
            { testId: "skip", enabled: false },
            { testId: "pinned", version: 123 },
          ],
        },
      ],
    });
    const manifest = createSuiteRunManifest(suite, [
      { id: "send", updatedAt: 456 },
      { id: "skip", updatedAt: 456 },
      { id: "pinned", updatedAt: 999 },
    ]);
    assert.deepEqual(
      manifest.entries.map((entry) => [entry.testId, entry.testUpdatedAt]),
      [
        ["send", 456],
        ["pinned", 123],
      ],
    );
    assert.deepEqual(manifest.entries[0]?.inputs, { prompt: "Hello" });
  });
});
