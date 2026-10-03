import { createHash } from "node:crypto";
import type { OperationInvoker } from "./server.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.slice(0, 240) : fallback;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Presentation projections contain no mutable decisions or host-local paths. */
export async function readRelayPanel(
  invoker: OperationInvoker,
  scope: { projectId: string },
  input: { appMapId?: string; runId?: string; frameIndex?: number },
  signal: AbortSignal,
) {
  const issues: string[] = [];
  const read = async (
    operationId: Parameters<OperationInvoker["invoke"]>[0],
    args: Record<string, unknown>,
  ) => {
    try {
      return object(await invoker.invoke(operationId, args, { signal }));
    } catch {
      issues.push(`Could not read ${operationId}. Check Relay connection and project access.`);
      return {};
    }
  };
  const catalog = await read("app-map.list", {});
  const apps = list(catalog.appMaps)
    .slice(0, 30)
    .map((value) => {
      const app = object(value);
      return {
        id: text(app.id),
        name: text(app.name ?? app.title, text(app.id)),
        revision: app.revision,
      };
    });
  const appMapId = input.appMapId ?? (apps.length === 1 ? apps[0]?.id : undefined);
  const map = appMapId ? object((await read("app-map.get", { appMapId })).appMap) : {};
  const tests = Object.entries(object(map.tests))
    .slice(0, 60)
    .map(([id, value]) => {
      const test = object(value);
      return { id, name: text(test.name, id), stepCount: list(test.steps).length };
    });
  const runsResponse = await read("run.list", { limit: 12, ...(appMapId ? { appMapId } : {}) });
  const projectRun = (value: unknown) => {
    const run = object(value);
    return {
      id: text(run.id),
      name: text(run.action ?? run.title, "Run"),
      status: text(run.status, "unknown"),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  };
  const runs = list(runsResponse.runs).slice(0, 12).map(projectRun);
  const requestedRun = input.runId
    ? object((await read("run.get", { runId: input.runId })).run)
    : undefined;
  const selectedRun =
    requestedRun?.id === input.runId && requestedRun ? projectRun(requestedRun) : undefined;
  if (input.runId && !selectedRun) issues.push("This Run is unavailable in the current project.");
  let frame:
    | { runId: string; index: number; count: number; imageSha256: string; content: string }
    | undefined;
  if (input.runId && selectedRun && input.frameIndex !== undefined) {
    const pack = object((await read("run.walkthrough-pack.get", { runId: input.runId })).pack);
    const frames = list(pack.frames)
      .filter((value) => object(value).runId === input.runId)
      .slice(0, 500);
    const entry = object(frames[input.frameIndex]);
    const content = typeof entry.content === "string" ? entry.content : "";
    const bytes = content.length <= 2_800_000 ? Buffer.from(content, "base64") : undefined;
    const digest = bytes ? createHash("sha256").update(bytes).digest("hex") : undefined;
    if (
      bytes &&
      digest &&
      bytes.length <= 2_000_000 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      digest === entry.imageSha256
    ) {
      frame = {
        runId: input.runId,
        index: input.frameIndex,
        count: frames.length,
        imageSha256: digest,
        content,
      };
    } else
      issues.push(
        frames.length
          ? "This captured frame is unavailable, too large, or failed integrity verification."
          : "This Run has no retained screenshots.",
      );
  }
  return {
    state: {
      schemaVersion: 1,
      projectId: scope.projectId,
      readOnly: true,
      apps,
      appMapId,
      tests,
      runs,
      selectedRun,
      issues,
    },
    ...(frame ? { frame } : {}),
  };
}
