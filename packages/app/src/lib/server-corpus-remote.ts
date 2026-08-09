import type {
  CorpusCoverageReport,
  CorpusPackManifest,
  CorpusScope,
  CorpusSession,
  CorpusStatus,
} from "@relay/protocol";
import type { ServerRequest } from "./server-matrix-remote";

export type LanguageRowInfo = {
  tag: string;
  label: string;
  aliases?: string[];
  identifier?: string;
};

export type LanguageProfileInfo = {
  id: string;
  name: string;
  app: string;
  platform?: "ios" | "android" | "any";
  languages: LanguageRowInfo[];
  defaultLocale?: string;
  notes?: string;
  verifiedAt?: string;
  scanned?: boolean;
};

export function listCorpusSessions(request: ServerRequest): Promise<{ sessions: CorpusSession[] }> {
  return request<{ sessions: CorpusSession[] }>("/corpus");
}

export function listLanguageProfiles(
  request: ServerRequest,
): Promise<{ profiles: LanguageProfileInfo[] }> {
  return request<{ profiles: LanguageProfileInfo[] }>("/language-profiles");
}

export type ScanLanguageProfileResult = {
  profile: LanguageProfileInfo;
  rowsFound: number;
  scrolls: number;
};

export async function scanLanguageProfile(
  request: ServerRequest,
  input: {
    serial: string;
    app: string;
    profileId?: string;
    name?: string;
    maxScrolls?: number;
    save?: boolean;
  },
): Promise<ScanLanguageProfileResult> {
  return request<ScanLanguageProfileResult>("/language-profiles/scan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createCorpusSession(
  request: ServerRequest,
  input: {
    name: string;
    targetId: string;
    scope?: Partial<CorpusScope> & { languageProfileId?: string };
  },
): Promise<CorpusSession> {
  const data = await request<{ session: CorpusSession }>("/corpus", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.session;
}

export async function getCorpusSession(request: ServerRequest, id: string): Promise<CorpusSession> {
  const data = await request<{ session: CorpusSession }>(`/corpus/${encodeURIComponent(id)}`);
  return data.session;
}

export async function renameCorpusSession(
  request: ServerRequest,
  id: string,
  name: string,
): Promise<CorpusSession> {
  const data = await request<{ session: CorpusSession }>(`/corpus/${encodeURIComponent(id)}/name`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.session;
}

export async function setCorpusStatus(
  request: ServerRequest,
  id: string,
  status: CorpusStatus,
): Promise<CorpusSession> {
  const data = await request<{ session: CorpusSession }>(
    `/corpus/${encodeURIComponent(id)}/status`,
    { method: "POST", body: JSON.stringify({ status }) },
  );
  return data.session;
}

export async function startCorpusSession(
  request: ServerRequest,
  id: string,
): Promise<CorpusSession> {
  const data = await request<{ session: CorpusSession }>(
    `/corpus/${encodeURIComponent(id)}/start`,
    { method: "POST", body: "{}" },
  );
  return data.session;
}

export async function cancelCorpusSession(
  request: ServerRequest,
  id: string,
): Promise<CorpusSession> {
  const data = await request<{ session: CorpusSession }>(
    `/corpus/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: "{}" },
  );
  return data.session;
}

export async function getCorpusCoverage(
  request: ServerRequest,
  id: string,
): Promise<CorpusCoverageReport> {
  const data = await request<{ coverage: CorpusCoverageReport }>(
    `/corpus/${encodeURIComponent(id)}/coverage`,
  );
  return data.coverage;
}

export async function exportCorpusPack(
  request: ServerRequest,
  id: string,
): Promise<{ session: CorpusSession; manifest: CorpusPackManifest; rootDir: string }> {
  return request<{ session: CorpusSession; manifest: CorpusPackManifest; rootDir: string }>(
    `/corpus/${encodeURIComponent(id)}/export?format=pack`,
  );
}

export function corpusScreenUrl(base: string, sessionId: string, screenId: string): string {
  return `${base}/corpus/${encodeURIComponent(sessionId)}/screens/${encodeURIComponent(screenId)}`;
}
