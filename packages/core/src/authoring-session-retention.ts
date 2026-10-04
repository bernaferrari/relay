import {
  listAuthoringSessionFiles,
  readAuthoringSession,
  readAuthoringSessionRetention,
  removeAuthoringSession,
  type AuthoringSessionRetentionEntry,
} from "./authoring-session-storage.js";
import { abandonedAuthoringSessions } from "./authoring-session-review-lifecycle.js";
import type { AuthoringSession } from "@relay/protocol";
import type { KeyedSerialQueue } from "./coordination-store.js";

type RetentionRuntime = {
  listFiles(): Promise<string[]>;
  readRetention(id: string): Promise<AuthoringSessionRetentionEntry | null>;
  readSession(id: string): Promise<AuthoringSession | null>;
  remove(id: string): Promise<void>;
};

const storage: RetentionRuntime = {
  listFiles: listAuthoringSessionFiles,
  readRetention: readAuthoringSessionRetention,
  readSession: readAuthoringSession,
  remove: removeAuthoringSession,
};

/** Retention must not hydrate every saved recording before a new one starts. */
export async function pruneAbandonedAuthoringSessions(
  projectId: string,
  queue: Pick<KeyedSerialQueue, "run">,
  runtime: RetentionRuntime = storage,
): Promise<void> {
  const configured = Number(process.env.RELAY_ABANDONED_AUTHORING_LIMIT ?? 100);
  const limit = Number.isSafeInteger(configured) && configured >= 0 ? configured : 100;
  const entries = await Promise.all(
    (await runtime.listFiles())
      .filter((name) => name.endsWith(".json"))
      .map((name) => runtime.readRetention(name.slice(0, -5))),
  );
  const ordered = entries
    .filter((entry): entry is AuthoringSessionRetentionEntry => Boolean(entry))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const abandoned = abandonedAuthoringSessions(ordered, projectId, limit);
  await Promise.all(
    abandoned.map((candidate) =>
      queue.run(candidate.id, async () => {
        // Fully validate each deletion candidate again. A concurrent recording,
        // archive, or update must not be removed based on earlier metadata.
        const current = await runtime.readSession(candidate.id);
        if (
          current &&
          current.id === candidate.id &&
          current.updatedAt === candidate.updatedAt &&
          abandonedAuthoringSessions([current], projectId, 0).length
        ) {
          await runtime.remove(current.id);
        }
      }),
    ),
  );
}
