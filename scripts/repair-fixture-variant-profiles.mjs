/** One-time repair of fixture-carrying variants recorded under unsigned
 * profile ids (agent-device-bmr9). Re-keys their targetProfile.id to the
 * overlay-honest id derived from the variant's own frozen environment so
 * fixture Lanes can bind and runtime matching stays fail-closed. */
import { mutateStoredAppMap } from "../packages/core/src/collaboration.js";
import { repairFixtureVariantProfileIds } from "../packages/core/src/app-map-fixture-variant-repair.js";

const [projectId, appMapId] = process.argv.slice(2);
if (!projectId || !appMapId) {
  throw new Error("Usage: repair-fixture-variant-profiles <project> <appMapId>");
}
const next = await mutateStoredAppMap(projectId, appMapId, (current) => {
  const { appMap, repairs } = repairFixtureVariantProfileIds(current);
  for (const repair of repairs) {
    process.stdout.write(
      `${repair.variantId} (${repair.screenId}): ${repair.fromProfileId} -> ${repair.toProfileId}\n`,
    );
  }
  if (!repairs.length) {
    process.stdout.write("no misconfigured variants found\n");
    return current;
  }
  return { ...appMap, revision: current.revision + 1, updatedAt: Date.now() };
});
process.stdout.write(`app map ${appMapId} now at revision ${next.revision}\n`);
