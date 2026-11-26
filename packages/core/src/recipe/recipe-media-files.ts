import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { RecipeStepContext } from "./recipe-runner-context.js";

/** Resolve only a file produced in this Run. A historical workspace namesake cannot replace it. */
export async function currentRunMediaFile(
  file: string,
  ctx: RecipeStepContext,
): Promise<string | undefined> {
  const artifact = ctx.job?.artifacts
    .slice()
    .reverse()
    .find(
      (entry) =>
        entry.kind === "download" &&
        entry.data &&
        typeof entry.data === "object" &&
        "file" in entry.data &&
        entry.data.file === file,
    );
  if (!artifact) return undefined;
  if (
    !ctx.job?.runDir ||
    !artifact.data ||
    typeof artifact.data !== "object" ||
    !("path" in artifact.data) ||
    typeof artifact.data.path !== "string"
  )
    throw new Error("Generated file is missing its current Run ownership");
  const root = await realpath(ctx.job.runDir);
  const path = await realpath(resolve(root, artifact.data.path));
  const local = relative(root, path);
  if (isAbsolute(local) || local === ".." || local.startsWith("../"))
    throw new Error("Generated file is outside its current Run");
  return path;
}
