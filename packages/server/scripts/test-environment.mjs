import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Server jobs can finalize evidence after the request that created them has
// returned. Keep one process-lifetime run store so concurrent tests and late
// finalizers can never fall back to a developer's real workspace catalog.
const runStore = mkdtempSync(join(tmpdir(), "relay-server-test-runs-"));
process.env.RELAY_RUNS_DIR = runStore;

process.once("exit", () => {
  rmSync(runStore, { recursive: true, force: true });
});
