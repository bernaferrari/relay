import { createOperationBuilders } from "./operation-builders.js";
import type { OperationDefinition, OperationRecord, RuntimeParser } from "./operation-contract.js";

/**
 * Corpus sweeps, the switchers that drive them, and the findings they produce.
 *
 * Split out of operations.ts the way the App Map and discovery blocks already
 * are: the catalogue is easier to read one family at a time, and a family that
 * owns its own file can grow without the whole catalogue growing with it.
 */
export type CorpusOperationId =
  | "corpus.list"
  | "corpus.create"
  | "corpus.get"
  | "corpus.rename"
  | "corpus.status.update"
  | "corpus.start"
  | "corpus.cancel"
  | "corpus.coverage"
  | "corpus.analysis"
  | "corpus.export"
  | "corpus.screen.get"
  | "locale-finding.known.list"
  | "locale-finding.known.add"
  | "locale-finding.known.remove"
  | "language-profile.list"
  | "language-profile.scan"
  | "language-profile.save"
  | "switcher-profile.list"
  | "switcher-profile.scan"
  | "switcher-profile.save";

export function createCorpusOperationDefinitions(
  defaultParser: RuntimeParser<OperationRecord>,
): readonly OperationDefinition<CorpusOperationId>[] {
  const { command, query } = createOperationBuilders<CorpusOperationId>(defaultParser);
  return [
    query("corpus.list", "List corpus sessions", "/corpus", { category: "corpus" }),
    command("corpus.create", "Create corpus session", "POST", "/corpus", {
      category: "corpus",
    }),
    query("corpus.get", "Get corpus session", "/corpus/:sessionId", { category: "corpus" }),
    command("corpus.rename", "Rename corpus session", "POST", "/corpus/:sessionId/name", {
      category: "corpus",
    }),
    command("corpus.status.update", "Update corpus status", "POST", "/corpus/:sessionId/status", {
      category: "corpus",
    }),
    command("corpus.start", "Start settings corpus crawl", "POST", "/corpus/:sessionId/start", {
      category: "corpus",
      targetCapabilities: ["tap", "snapshot", "screenshot", "launch"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    }),
    command("corpus.cancel", "Cancel corpus crawl", "POST", "/corpus/:sessionId/cancel", {
      category: "corpus",
      confirmation: "confirm",
      minimumRole: "runner",
    }),
    query("corpus.coverage", "Corpus locale coverage", "/corpus/:sessionId/coverage", {
      category: "corpus",
    }),
    query("corpus.analysis", "Analyze corpus evidence", "/corpus/:sessionId/analysis", {
      category: "corpus",
    }),
    query("corpus.export", "Export corpus pack", "/corpus/:sessionId/export", {
      category: "corpus",
    }),
    query("corpus.screen.get", "Get corpus screenshot", "/corpus/:sessionId/screens/:screenId", {
      category: "corpus",
    }),

    // Accepted locale findings. Keyed by the finding's own id, which the
    // analyzer derives from code, screen, locale and control — so the same
    // clipped label stays accepted on the next sweep instead of arriving new.
    query("locale-finding.known.list", "List known locale findings", "/locale-findings/known", {
      category: "corpus",
    }),
    command(
      "locale-finding.known.add",
      "Mark locale finding as known",
      "POST",
      "/locale-findings/known",
      { category: "corpus" },
    ),
    command(
      "locale-finding.known.remove",
      "Stop treating a locale finding as known",
      "DELETE",
      "/locale-findings/known/:findingId",
      { category: "corpus", confirmation: "none" },
    ),

    query("language-profile.list", "List language profiles", "/language-profiles", {
      category: "corpus",
    }),
    query("switcher-profile.list", "List switcher profiles", "/switcher-profiles", {
      category: "corpus",
    }),
    command(
      "switcher-profile.scan",
      "Scan app switcher picker",
      "POST",
      "/switcher-profiles/scan",
      {
        category: "corpus",
        targetCapabilities: ["tap", "snapshot", "launch"],
        lease: "exclusive",
        progress: true,
      },
    ),
    command("switcher-profile.save", "Save switcher profile", "POST", "/switcher-profiles", {
      category: "corpus",
    }),

    command(
      "language-profile.scan",
      "Scan app language picker",
      "POST",
      "/language-profiles/scan",
      {
        category: "corpus",
        targetCapabilities: ["tap", "snapshot", "launch"],
        lease: "exclusive",
        progress: true,
      },
    ),
    command("language-profile.save", "Save language profile", "POST", "/language-profiles", {
      category: "corpus",
    }),
  ];
}
