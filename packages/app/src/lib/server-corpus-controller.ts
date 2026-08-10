import type { Accessor, Setter } from "solid-js";
import type { CorpusScope, CorpusSession } from "@relay/protocol";
import { toast } from "../context/toast";
import type { ServerRequest } from "./server-matrix-remote";
import {
  cancelCorpusSession as cancelCorpusSessionRemote,
  createCorpusSession as createCorpusSessionRemote,
  exportCorpusPack as exportCorpusPackRemote,
  getCorpusAnalysis,
  getCorpusCoverage,
  corpusScreenUrl as buildCorpusScreenUrl,
  listCorpusSessions,
  listLanguageProfiles as listLanguageProfilesRemote,
  scanLanguageProfile as scanLanguageProfileRemote,
  startCorpusSession as startCorpusSessionRemote,
  type LanguageProfileInfo,
} from "./server-corpus-remote";

export type CorpusControllerDependencies = {
  request: ServerRequest;
  health: Accessor<string>;
  serverUrl: Accessor<string>;
  corpusSessions: Accessor<CorpusSession[]>;
  setCorpusSessions: Setter<CorpusSession[]>;
  activeCorpusSessionId: Accessor<string | null>;
  setActiveCorpusSessionId: Setter<string | null>;
  languageProfiles: Accessor<LanguageProfileInfo[]>;
  setLanguageProfiles: Setter<LanguageProfileInfo[]>;
};

export function createServerCorpusController(deps: CorpusControllerDependencies) {
  async function refreshCorpusSessions(): Promise<CorpusSession[]> {
    if (deps.health() !== "online") return deps.corpusSessions();
    try {
      const { sessions } = await listCorpusSessions(deps.request);
      deps.setCorpusSessions(sessions);
      const active = deps.activeCorpusSessionId();
      if (active && !sessions.some((session) => session.id === active)) {
        deps.setActiveCorpusSessionId(null);
      }
      return sessions;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not refresh corpus sessions", "error");
      return deps.corpusSessions();
    }
  }

  async function refreshLanguageProfiles(): Promise<LanguageProfileInfo[]> {
    if (deps.health() !== "online") return deps.languageProfiles();
    try {
      const { profiles } = await listLanguageProfilesRemote(deps.request);
      deps.setLanguageProfiles(profiles);
      return profiles;
    } catch {
      // Profiles are optional UX; keep last known list.
      return deps.languageProfiles();
    }
  }

  async function scanLanguageProfile(input: {
    serial: string;
    app: string;
    profileId?: string;
    name?: string;
    maxScrolls?: number;
  }): Promise<LanguageProfileInfo | null> {
    try {
      const result = await scanLanguageProfileRemote(deps.request, {
        ...input,
        save: true,
      });
      await refreshLanguageProfiles();
      toast(
        `Scanned ${result.rowsFound} option${result.rowsFound === 1 ? "" : "s"} on device`,
        "success",
      );
      return (
        deps.languageProfiles().find((profile) => profile.id === result.profile.id) ??
        result.profile
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not scan switcher options", "error");
      return null;
    }
  }

  async function createCorpusSession(input: {
    name: string;
    targetId: string;
    scope?: Partial<CorpusScope> & { languageProfileId?: string };
  }): Promise<CorpusSession | null> {
    try {
      const session = await createCorpusSessionRemote(deps.request, input);
      deps.setActiveCorpusSessionId(session.id);
      await refreshCorpusSessions();
      return session;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create corpus", "error");
      return null;
    }
  }

  async function startCorpusSession(id: string): Promise<CorpusSession | null> {
    try {
      const session = await startCorpusSessionRemote(deps.request, id);
      deps.setActiveCorpusSessionId(session.id);
      await refreshCorpusSessions();
      return session;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not start corpus", "error");
      return null;
    }
  }

  async function cancelCorpusSession(id: string): Promise<CorpusSession | null> {
    try {
      const session = await cancelCorpusSessionRemote(deps.request, id);
      await refreshCorpusSessions();
      return session;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not cancel corpus", "error");
      return null;
    }
  }

  async function exportCorpusPack(id: string) {
    try {
      const result = await exportCorpusPackRemote(deps.request, id);
      await refreshCorpusSessions();
      toast("Corpus pack written", "success");
      return result;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not export corpus pack", "error");
      return null;
    }
  }

  function corpusScreenUrl(sessionId: string, screenId: string): string {
    return buildCorpusScreenUrl(deps.serverUrl(), sessionId, screenId);
  }

  function activeCorpusSession(): CorpusSession | null {
    const id = deps.activeCorpusSessionId();
    if (!id) return null;
    return deps.corpusSessions().find((session) => session.id === id) ?? null;
  }

  return {
    refreshCorpusSessions,
    refreshLanguageProfiles,
    scanLanguageProfile,
    createCorpusSession,
    startCorpusSession,
    cancelCorpusSession,
    exportCorpusPack,
    getCorpusAnalysis: (id: string) => getCorpusAnalysis(deps.request, id),
    getCorpusCoverage: (id: string) => getCorpusCoverage(deps.request, id),
    corpusScreenUrl,
    activeCorpusSession,
  };
}
