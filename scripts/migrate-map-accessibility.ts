/** One-time promotion of retained capture pairs into v2 accessibility references. */
import { createHash } from "node:crypto";
import { readControlStore, withControlStore } from "../packages/core/src/collaboration-store.js";
import { readAuthoringEvidence } from "../packages/core/src/authoring-evidence.js";
import { mutateAppMap } from "../packages/core/src/app-map/mutation.js";

const [projectId, appMapId] = process.argv.slice(2);
if (!projectId || !appMapId) throw new Error("Usage: migrate-map-accessibility <project> <map>");
const key = `${projectId}:${appMapId}`;
const map = await readControlStore((store) => store.appMap(key));
if (!map) throw new Error("App Map not found");
const references = new Map();
for (const variant of Object.values(map.screenVariants)) {
  if (variant.rawAccessibilityTree) continue;
  const index = variant.evidenceUris?.indexOf(variant.screenshotUri ?? "") ?? -1;
  const uri = index > 0 ? variant.evidenceUris?.[index - 1] : undefined;
  if (!uri) throw new Error(`No paired snapshot for ${variant.id}`);
  const bytes = await readAuthoringEvidence(uri.replace("relay-evidence://", ""));
  if (!bytes) throw new Error(`Snapshot bytes missing for ${variant.id}`);
  const tree = JSON.parse(bytes.toString("utf8"));
  const screen = map.screens[variant.screenId];
  const fingerprints = [
    variant.observation.fingerprint,
    screen?.identity?.fingerprint,
    ...(screen?.identity?.aliases ?? []),
  ];
  if (!Array.isArray(tree.nodes) || !tree.bounds || !fingerprints.includes(tree.fingerprint))
    throw new Error(`Snapshot identity mismatch for ${variant.id}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (uri !== `relay-evidence://${sha256}`) throw new Error("Evidence digest mismatch");
  references.set(variant.id, {
    id: `evidence-${sha256.slice(0, 24)}`,
    uri,
    sha256,
    mime: "application/json" as const,
    bytes: bytes.length,
  });
}
if (references.size)
  await withControlStore((store) => {
    const current = store.appMap(key);
    if (!current || current.revision !== map.revision)
      throw new Error("Map changed during migration; retry");
    const next = mutateAppMap(
      current,
      {
        expectedRevision: map.revision,
        eventId: `migrate-accessibility-${Date.now()}`,
        actorId: "agent:accessibility-migration",
        actorKind: "agent",
        at: Date.now(),
      },
      {
        eventType: "app-map.updated",
        subject: { kind: "app-map", id: map.id },
        summary: `Migrated ${references.size} retained accessibility trees to v2`,
      },
      (draft) => {
        for (const [id, reference] of references)
          draft.screenVariants[id]!.rawAccessibilityTree = reference;
      },
    );
    store.upsertAppMap(key, next);
  });
console.log(JSON.stringify({ appMapId, migrated: references.size }));
