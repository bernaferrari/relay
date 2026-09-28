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
// agent-device otherwise starts every parallel server test worker against the
// same developer/runner daemon directory. Two goal tests can replace each
// other's startup metadata and report "Failed to start daemon".
process.env.AGENT_DEVICE_STATE_DIR = join(stateStore, "agent-device");
process.env.RELAY_SKIP_BROWSER_WARMUP = "1";

process.once("exit", () => {
  rmSync(runStore, { recursive: true, force: true });
  rmSync(stateStore, { recursive: true, force: true });
});
