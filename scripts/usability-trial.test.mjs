import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import test from "node:test";
import { prepareUsabilityTrial } from "./usability-trial.mjs";

test("participant fixture opens fresh authoring, retains no invented results and exposes working repair", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "relay-usability-trial-"));
  let appTitle = "Relay";
  const web = http.createServer((_request, response) => response.end(`<title>${appTitle}</title>`));
  await new Promise((done) => web.listen(0, "127.0.0.1", done));
  const webUrl = `http://127.0.0.1:${web.address().port}`;
  let trial;
  try {
    trial = await prepareUsabilityTrial({ port: 0, outputDirectory, webUrl });
    const { manifest } = trial;
    const entry = new URL(manifest.entryUrl);
    assert.equal(entry.hash.split("?")[0], "#/tests/new");
    assert.equal(new URLSearchParams(entry.hash.split("?")[1]).get("site"), manifest.websiteUrl);
    assert.equal(new URLSearchParams(entry.hash.split("?")[1]).get("account"), "");
    assert.equal(manifest.participantObserved, false);
    assert.deepEqual(manifest.visualDecisions, []);
    appTitle = "Another product";
    await assert.rejects(
      prepareUsabilityTrial({ port: 0, outputDirectory, webUrl }),
      /Relay web app is unavailable/u,
    );
    const observations = JSON.parse(
      await readFile(join(trial.output, "observations.json"), "utf8"),
    );
    assert.equal(observations.firstSavedTestAt, null);
    assert.equal(observations.firstRepeatFinishedAt, null);
    const login = await fetch(new URL("/session", manifest.websiteUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "member" }),
      redirect: "manual",
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const settings = () =>
      fetch(new URL("/settings", manifest.websiteUrl), { headers: { cookie } }).then((response) =>
        response.text(),
      );
    assert.match(await settings(), /id="team-seats"[^>]*>5</u);
    const repair = await fetch(manifest.facilitatorControlUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: false }),
    });
    assert.equal(repair.status, 200);
    assert.match(await settings(), /id="team-seats"[^>]*>4</u);
    assert.deepEqual(manifest.visualDecisions, []);
  } finally {
    await trial?.close();
    web.closeAllConnections();
    await new Promise((done) => web.close(done));
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
