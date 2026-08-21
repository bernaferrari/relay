import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Server jobs can finalize evidence after the request that created them has
// returned. Keep one process-lifetime run store so concurrent tests and late
// finalizers can never fall back to a developer's real workspace catalog.
const runStore = mkdtempSync(join(tmpdir(), "relay-server-test-runs-"));
const stateStore = mkdtempSync(join(tmpdir(), "relay-server-test-state-"));
process.env.RELAY_RUNS_DIR = runStore;
// A server owns its durable state directory for its whole lifetime. Give each
// Node test worker its own one so independent test files can still run in
// parallel without weakening the production singleton boundary.
process.env.RELAY_STATE_DIR = stateStore;

process.once("exit", () => {
  rmSync(runStore, { recursive: true, force: true });
  rmSync(stateStore, { recursive: true, force: true });
});
