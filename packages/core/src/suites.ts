import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SaveSuiteInput, SuiteRunManifest, SuiteSection, TestSuite } from "@relay/protocol";
import { findWorkspaceRoot } from "./runs.js";

export type {
  SaveSuiteInput,
  SuiteEntry,
  SuiteRunManifest,
  SuiteRunManifestEntry,
  SuiteSection,
  SuiteVersion,
  TestSuite,
} from "@relay/protocol";

function suitesRoot(): string {
  return join(findWorkspaceRoot(), ".relay", "suites");
}

function historyRoot(id: string): string {
  return join(suitesRoot(), ".history", safeId(id));
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("suite id contains invalid characters");
  return value;
}

function suitePath(id: string): string {
  return join(suitesRoot(), `${safeId(id)}.json`);
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "suite"
  );
}

function normalizeInputs(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("suite entry inputs must be an object");
  }
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error("suite entry input values must be strings");
  }
  return entries.length ? Object.fromEntries(entries as Array<[string, string]>) : undefined;
}

function normalizeSections(input: SaveSuiteInput["sections"]): SuiteSection[] {
  const sections = input ?? [{ title: "Tests", entries: [] }];
  const sectionIds = new Set<string>();
  const entryIds = new Set<string>();
  return sections.map((section, sectionIndex) => {
    const title = section.title?.trim();
    if (!title) throw new Error(`section ${sectionIndex + 1} needs a title`);
    const id = section.id?.trim() || randomUUID();
    if (sectionIds.has(id)) throw new Error(`duplicate section id: ${id}`);
    sectionIds.add(id);
    const entries = (section.entries ?? []).map((entry, entryIndex) => {
      const testId = entry.testId?.trim();
      if (!testId) throw new Error(`${title} test ${entryIndex + 1} needs a test`);
      const entryId = entry.id?.trim() || randomUUID();
      if (entryIds.has(entryId)) throw new Error(`duplicate suite entry id: ${entryId}`);
      entryIds.add(entryId);
      const version = entry.version ?? "latest";
      if (version !== "latest" && (!Number.isFinite(version) || version <= 0)) {
        throw new Error("suite entry version must be latest or a saved timestamp");
      }
      const inputs = normalizeInputs(entry.inputs);
      return {
        id: entryId,
        testId,
        enabled: entry.enabled !== false,
        version,
        ...(inputs ? { inputs } : {}),
      };
    });
    return { id, title, entries };
  });
}

function parseSuite(value: unknown): TestSuite | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<TestSuite>;
  if (typeof item.id !== "string" || typeof item.title !== "string") return null;
  try {
    return {
      id: safeId(item.id),
      title: item.title,
      ...(typeof item.description === "string" ? { description: item.description } : {}),
      sections: normalizeSections(item.sections),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export async function listSuites(): Promise<TestSuite[]> {
  try {
    const files = (await readdir(suitesRoot())).filter((file) => file.endsWith(".json"));
    const suites = await Promise.all(
      files.map(async (file) =>
        parseSuite(JSON.parse(await readFile(join(suitesRoot(), file), "utf8"))),
      ),
    );
    return suites
      .filter((suite): suite is TestSuite => Boolean(suite))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function readSuite(id: string): Promise<TestSuite | null> {
  try {
    return parseSuite(JSON.parse(await readFile(suitePath(id), "utf8")));
  } catch {
    return null;
  }
}

export async function saveSuite(input: SaveSuiteInput): Promise<TestSuite> {
  const title = input.title?.trim();
  if (!title) throw new Error("suite title is required");
  const requestedAt = Date.now();
  const id = safeId(input.id?.trim() || `${slugify(title)}-${requestedAt.toString(36)}`);
  const existing = await readSuite(id);
  const now = Math.max(requestedAt, (existing?.updatedAt ?? 0) + 1);
  const suite: TestSuite = {
    id,
    title,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    sections: normalizeSections(input.sections),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await mkdir(suitesRoot(), { recursive: true });
  if (existing) {
    await mkdir(historyRoot(id), { recursive: true });
    await writeFile(
      join(historyRoot(id), `${existing.updatedAt}.json`),
      JSON.stringify(existing, null, 2),
      { encoding: "utf8", flag: "wx" },
    ).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    });
    const historyLimit = Math.max(1, Number(process.env.RELAY_SUITE_HISTORY_LIMIT ?? 100));
    const historyFiles = (await readdir(historyRoot(id))).sort().reverse();
    await Promise.all(
      historyFiles
        .slice(historyLimit)
        .map((file) => unlink(join(historyRoot(id), file)).catch(() => undefined)),
    );
  }
  await writeFile(suitePath(id), JSON.stringify(suite, null, 2), "utf8");
  return suite;
}

export async function deleteSuite(id: string): Promise<void> {
  await unlink(suitePath(id)).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
}

export async function listSuiteHistory(id: string): Promise<TestSuite[]> {
  try {
    const files = (await readdir(historyRoot(id)))
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50);
    const versions = await Promise.all(
      files.map(async (file) =>
        parseSuite(JSON.parse(await readFile(join(historyRoot(id), file), "utf8"))),
      ),
    );
    return versions.filter((suite): suite is TestSuite => Boolean(suite));
  } catch {
    return [];
  }
}

export async function restoreSuiteHistory(id: string, updatedAt: number): Promise<TestSuite> {
  const version = (await listSuiteHistory(id)).find((item) => item.updatedAt === updatedAt);
  if (!version) throw new Error("suite version not found");
  return saveSuite({
    id,
    title: version.title,
    description: version.description,
    sections: version.sections,
  });
}

export async function clearSuitesForTests(): Promise<void> {
  await rm(suitesRoot(), { recursive: true, force: true });
}

export function createSuiteRunManifest(
  suite: TestSuite,
  tests: Array<{ id: string; updatedAt: number }>,
): SuiteRunManifest {
  const byId = new Map(tests.map((test) => [test.id, test]));
  const entries = suite.sections.flatMap((section) =>
    section.entries.flatMap((entry) => {
      if (!entry.enabled) return [];
      const test = byId.get(entry.testId);
      if (!test) throw new Error(`Test “${entry.testId}” no longer exists`);
      const version = entry.version === "latest" ? test.updatedAt : entry.version;
      return [
        {
          suiteEntryId: entry.id,
          sectionId: section.id,
          sectionTitle: section.title,
          testId: entry.testId,
          testUpdatedAt: version,
          ...(entry.inputs ? { inputs: entry.inputs } : {}),
        },
      ];
    }),
  );
  return {
    id: randomUUID(),
    suiteId: suite.id,
    suiteTitle: suite.title,
    suiteUpdatedAt: suite.updatedAt,
    createdAt: Date.now(),
    entries,
  };
}
