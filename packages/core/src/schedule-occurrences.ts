import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scheduleOccurrenceSchema, type ScheduleOccurrence } from "@relay/protocol";
import { findWorkspaceRoot } from "./workspace-root.js";
import { syncRunPath } from "./run-manifest.js";
import { readPersistedRun, type PersistedRun } from "./runs.js";
import { getJob } from "./session.js";
import type { LocalSchedule } from "./schedules.js";

const processId = randomUUID();
const owners = new Map<string, string>();
function directory(scope: { projectId: string; scheduleId: string }): string {
  const key = createHash("sha256")
    .update(JSON.stringify([scope.projectId, scope.scheduleId]))
    .digest("hex");
  return join(findWorkspaceRoot(), ".relay", "schedule-occurrences", key);
}
function filename(
  record: Pick<ScheduleOccurrence, "id" | "projectId" | "scheduleId" | "scheduledAt">,
): string {
  return join(
    directory(record),
    `${String(record.scheduledAt).padStart(16, "0")}-${createHash("sha256").update(record.id).digest("hex")}.json`,
  );
}

export async function saveScheduleOccurrence(value: ScheduleOccurrence): Promise<void> {
  const occurrence = scheduleOccurrenceSchema.parse(value);
  const file = filename(occurrence);
  await mkdir(join(file, ".."), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(occurrence), { flag: "wx", mode: 0o600 });
    await syncRunPath(temporary);
    await rename(temporary, file);
    await syncRunPath(join(file, ".."));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Persist the intent before starting work, so a crash cannot erase a due cycle. */
export async function beginScheduleOccurrence(
  schedule: LocalSchedule,
  at: number,
): Promise<ScheduleOccurrence> {
  const id = `schedule:${schedule.id}:${schedule.nextRunAt}`;
  const occurrence: ScheduleOccurrence = {
    id,
    scheduleId: schedule.id,
    projectId: schedule.projectId,
    scheduledAt: schedule.nextRunAt,
    createdAt: at,
    updatedAt: at,
    ...(schedule.appMapId ? { appMapId: schedule.appMapId } : {}),
    ...(schedule.combineId ? { combineId: schedule.combineId } : {}),
    ...(schedule.recipeId ? { recipeId: schedule.recipeId } : {}),
    state: "admitting",
    jobs: [],
    expectedCaseCount: 0,
  };
  try {
    const previous = scheduleOccurrenceSchema.parse(
      JSON.parse(await readFile(filename(occurrence), "utf8")),
    );
    // An uncertain admission must be inspected, never repeated automatically.
    if (previous.state !== "blocked" && previous.state !== "skipped-busy") {
      throw new Error(
        `Occurrence ${previous.id} already exists (${previous.state}); inspect it before retrying`,
      );
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  await saveScheduleOccurrence(occurrence);
  owners.set(id, processId);
  return occurrence;
}

export function finishScheduleOccurrenceAdmission(id: string): void {
  owners.delete(id);
}

type OccurrenceRunEvidence = Pick<
  PersistedRun,
  "id" | "projectId" | "schemaVersion" | "status" | "outcome" | "review"
>;

export function projectScheduleOccurrence(
  occurrence: ScheduleOccurrence,
  evidence: readonly { run: OccurrenceRunEvidence | null; active: boolean }[],
  admissionActive = false,
): ScheduleOccurrence {
  if (occurrence.state === "blocked" || occurrence.state === "skipped-busy") return occurrence;
  if (occurrence.state === "admitting")
    return admissionActive
      ? occurrence
      : {
          ...occurrence,
          state: "interrupted",
          detail: "Admission was interrupted; inspect before retrying.",
        };
  const complete =
    occurrence.jobs.length > 0 &&
    occurrence.jobs.length === occurrence.expectedCaseCount &&
    evidence.length === occurrence.jobs.length &&
    evidence.every(
      ({ run }, index) =>
        run?.id === occurrence.jobs[index]?.id &&
        run?.projectId === occurrence.projectId &&
        run?.schemaVersion === 5 &&
        ["ok", "error", "healed", "cancelled"].includes(run.status),
    );
  const { verdict: _verdict, ...base } = occurrence;
  if (!complete)
    return {
      ...base,
      state: evidence.some(({ active }) => active) ? "running" : "interrupted",
      detail: "Every expected case needs a committed Run before this cycle can complete.",
    };
  const failed = evidence.some(
    ({ run }) =>
      run?.status === "error" ||
      run?.status === "cancelled" ||
      run?.outcome === "product-failure" ||
      run?.outcome === "harness-failure" ||
      run?.outcome === "cancelled",
  );
  const passed = evidence.every(
    ({ run }) => run?.outcome === "passed" && run.review?.status !== "pending",
  );
  return {
    ...base,
    state: "completed",
    verdict: failed ? "failed" : passed ? "passed" : "review-required",
  };
}

/** Bounded newest-first projection from exact immutable manifests, never historical siblings. */
export async function listScheduleOccurrences(input: {
  projectId: string;
  scheduleId: string;
}): Promise<ScheduleOccurrence[]> {
  let files: string[];
  try {
    files = await readdir(directory(input));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const records: ScheduleOccurrence[] = [];
  for (const file of files
    .filter((name) => /^\d{16}-[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .reverse()
    .slice(0, 100)) {
    const record = scheduleOccurrenceSchema.parse(
      JSON.parse(await readFile(join(directory(input), file), "utf8")),
    );
    if (record.projectId === input.projectId && record.scheduleId === input.scheduleId)
      records.push(record);
  }
  const selected = records.sort((a, b) => b.scheduledAt - a.scheduledAt).slice(0, 100);
  return Promise.all(
    selected.map(async (record) => {
      const evidence = await Promise.all(
        record.jobs.map(async ({ id }) => {
          const run = await readPersistedRun(id);
          const job = getJob(id);
          return {
            run: run?.projectId === record.projectId ? run : null,
            active: Boolean(job && !job.persisted),
          };
        }),
      );
      return projectScheduleOccurrence(record, evidence, owners.get(record.id) === processId);
    }),
  );
}
