import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Writable } from "node:stream";

const PNG = /\.png$/iu;
const MAX_PNGS = 50;

export function teeWritable(destination: Writable): { writable: Writable; text: () => string } {
  let collected = "";
  const writable = new Writable({
    decodeStrings: false,
    write(chunk, _encoding, callback) {
      collected += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      destination.write(chunk);
      callback();
    },
  });
  return { writable, text: () => collected };
}

export function pngPathsIn(value: unknown, found = new Set<string>()): string[] {
  if (typeof value === "string") {
    if (PNG.test(value)) found.add(value);
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const item of value) pngPathsIn(item, found);
    return [...found];
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) pngPathsIn(item, found);
  }
  return [...found];
}

function runDirsIn(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) runDirsIn(item, found);
    return [...found];
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.runDir === "string" && record.runDir.trim()) found.add(record.runDir);
    for (const item of Object.values(record)) runDirsIn(item, found);
  }
  return [...found];
}

async function pngsUnder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !PNG.test(entry.name)) continue;
      files.push(join(entry.parentPath ?? dir, entry.name));
      if (files.length >= MAX_PNGS) break;
    }
    return files;
  } catch {
    return [];
  }
}

function uniqueDest(dir: string, fileName: string, used: Set<string>): string {
  let name = fileName;
  let n = 1;
  while (used.has(name)) {
    const dot = fileName.lastIndexOf(".");
    name = `${fileName.slice(0, dot)}-${n}${fileName.slice(dot)}`;
    n += 1;
  }
  used.add(name);
  return join(dir, name);
}

/** Write result.json, stderr.log, and any local PNG paths the job produced. */
export async function writeRunOutDir(input: {
  dir: string;
  envelope: unknown;
  stderr: string;
}): Promise<string[]> {
  await mkdir(input.dir, { recursive: true });
  await writeFile(join(input.dir, "result.json"), `${JSON.stringify(input.envelope)}\n`);
  await writeFile(join(input.dir, "stderr.log"), input.stderr);
  const used = new Set(["result.json", "stderr.log"]);
  const copied: string[] = [];
  const candidates = new Set(pngPathsIn(input.envelope));
  for (const dir of runDirsIn(input.envelope)) {
    for (const file of await pngsUnder(dir)) candidates.add(file);
  }
  for (const source of candidates) {
    try {
      if (!(await stat(source)).isFile()) continue;
    } catch {
      continue;
    }
    const dest = uniqueDest(input.dir, basename(source), used);
    await copyFile(source, dest);
    copied.push(dest);
    if (copied.length >= MAX_PNGS) break;
  }
  return copied;
}
