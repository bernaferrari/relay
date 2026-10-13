import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile, readFile, readdir, symlink, rm } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runE2EProject } from "../src/run-project.js";
import { runDirectory } from "../src/import-run.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(packageRoot, "../../.relay/e2e-conformance");
await mkdir(root, { recursive: true });
await rm(join(root, "node_modules"), { force: true, recursive: true });
await symlink(join(packageRoot, "node_modules"), join(root, "node_modules"), "dir");
await writeFile(
  join(root, "package.json"),
  JSON.stringify({ name: "relay-e2e-conformance", type: "module" }),
);
await mkdir(join(root, "tests"), { recursive: true });
let retries = 0;
const server = createServer((req, res) => {
  const message = req.url === "/retry" && ++retries === 1 ? "not ready" : "ready";
  res.setHeader("content-type", "text/html");
  res.end(
    `<h1>QA fixture</h1><button onclick="document.querySelector('[role=status]').textContent='clicked'">Continue</button><p role="status">${message}</p>`,
  );
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}`;
const source = `import { test as base, expect } from 'e2e';
const test=base.extend({seed: async ({},use)=>{await use('fixture-ready')}});
test.beforeEach(async ({app})=>{await app.open()});
for(const variant of ['blue','green']) test('variant '+variant,async({app,screen,seed})=>{
 if(seed!=='fixture-ready') throw Error('fixture missing');
 if(variant==='blue') {await screen.getByRole('button',{name:'Continue'}).click();await expect(screen.getByRole('status')).toContainText('clicked')}
 else await expect(screen.getByRole('status')).toContainText('ready');
 await app.screenshot('variant-'+variant);
});
test('screenshot only',async({app})=>{await app.screenshot('checkpoint')});
test('seeded failure',async({screen})=>{await expect(screen.getByRole('status')).toContainText('impossible')});
test('retry',async({app,screen})=>{await app.open('/retry');await expect(screen.getByRole('status')).toContainText('ready')});
test.skip('not selected for execution',async()=>{});
`;
await writeFile(join(root, "tests/parity.e2e.ts"), source);
await writeFile(
  join(root, "tests/cancel.e2e.ts"),
  `import {test,expect} from 'e2e';test('cancel',async({app,screen})=>{await app.open();await expect(screen.getByRole('status')).toContainText('never')});`,
);
const reporterPath = join(packageRoot, "dist/index.js");
const reports: any[] = [];
try {
  for (const kind of ["direct", "relay"]) {
    retries = 0;
    const output = join(root, kind),
      imported = join(root, kind + "-import");
    await writeFile(
      join(root, "e2e.config.ts"),
      `import {web} from '@e2e-dev/web';import {relayReporter} from ${JSON.stringify(reporterPath)};export default {projectId:'conformance',targets:[{name:'web',engine:web(),app:{url:${JSON.stringify(url)}}}],tests:'tests/parity.e2e.ts',workers:1,retries:1,assertionTimeout:150,cache:'off',output:${JSON.stringify(output)},reporters:['json'${kind === "relay" ? `,relayReporter({directory:${JSON.stringify(imported)},requireHumanReview:true})` : ""}]};`,
    );
    const result = await runE2EProject({
      projectRoot: root,
      trust: "trusted-project",
      onOutput: (_, text) => process.stdout.write(text),
    });
    assert.equal(result.exitCode, 1, "seeded assertion failure must remain failure");
    const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
    reports.push(report);
    if (kind === "relay") {
      const folders = [basename(runDirectory(imported, report.run.id))];
      const receipt = JSON.parse(
        await readFile(join(imported, folders[0]!, "receipt.json"), "utf8"),
      );
      assert.equal(receipt.upstream.status, report.run.status);
      assert.equal(receipt.acceptance.state, "execution-not-passed");
      assert.equal(receipt.acceptance.humanReview, "pending");
      assert(
        receipt.artifacts.some(
          (a: any) => a.state === "available" && a.source.kind === "screenshot",
        ),
      );
      assert.deepEqual(
        JSON.parse(await readFile(join(imported, folders[0]!, "report.json"), "utf8")),
        report,
      );
    }
  }
  const normalize = (report: any) =>
    report.run.results.map((r: any) => ({
      title: r.titlePath,
      status: r.status,
      attempts: r.attempts.map((a: any) => ({
        status: a.status,
        steps: a.steps.map((s: any) => ({
          api: s.api,
          label: s.label,
          status: s.status,
          phase: s.phase,
        })),
      })),
    }));
  assert.deepEqual(normalize(reports[0]), normalize(reports[1]));
  const cancellations: any[] = [];
  for (const kind of ["direct", "relay"]) {
    const output = join(root, kind + "-cancel"),
      imported = join(root, kind + "-cancel-import");
    const controller = new AbortController();
    await writeFile(
      join(root, "e2e.config.ts"),
      `import {web} from '@e2e-dev/web';import {relayReporter} from ${JSON.stringify(reporterPath)};export default {targets:[{name:'web',engine:web(),app:{url:${JSON.stringify(url)}}}],tests:'tests/cancel.e2e.ts',workers:1,assertionTimeout:30000,cache:'off',output:${JSON.stringify(output)},reporters:['json',{name:'ready',onEvent(e){if(e.type==='test-started')console.log('CANCEL_READY')}}${kind === "relay" ? `,relayReporter({directory:${JSON.stringify(imported)}})` : ""}]};`,
    );
    await runE2EProject({
      projectRoot: root,
      trust: "trusted-project",
      signal: controller.signal,
      onOutput: (_, text) => {
        if (text.includes("CANCEL_READY")) setTimeout(() => controller.abort(), 250);
      },
    });
    const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
    cancellations.push(report.run.status);
    assert.equal(report.run.status, "interrupted");
    if (kind === "relay") {
      const folder = basename(runDirectory(imported, report.run.id));
      const receipt = JSON.parse(await readFile(join(imported, folder!, "receipt.json"), "utf8"));
      assert.equal(receipt.upstream.status, "interrupted");
    }
  }
  const proof = {
    upstreamRunner: "0.20.0",
    reviewedUpstreamSource: "fc9064415d427060fad1d406c4c491dda248ad4f",
    testSourceSha256: createHash("sha256").update(source).digest("hex"),
    semanticsEqual: true,
    results: normalize(reports[0]),
    cancellationStatuses: cancellations,
  };
  await writeFile(join(root, "proof.json"), JSON.stringify(proof, null, 2));
  console.log("Upstream parity proof:", join(root, "proof.json"));
} finally {
  await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
}
