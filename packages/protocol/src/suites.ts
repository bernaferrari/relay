export type SuiteVersion = "latest" | number;

export type SuiteEntry = {
  id: string;
  testId: string;
  enabled: boolean;
  version: SuiteVersion;
  inputs?: Record<string, string>;
};

export type SuiteSection = {
  id: string;
  title: string;
  entries: SuiteEntry[];
};

export type TestSuite = {
  id: string;
  title: string;
  description?: string;
  sections: SuiteSection[];
  createdAt: number;
  updatedAt: number;
};

export type SaveSuiteInput = {
  id?: string;
  title: string;
  description?: string;
  sections?: Array<{
    id?: string;
    title: string;
    entries?: Array<{
      id?: string;
      testId: string;
      enabled?: boolean;
      version?: SuiteVersion;
      inputs?: Record<string, string>;
    }>;
  }>;
};

export type SuiteRunManifestEntry = {
  suiteEntryId: string;
  sectionId: string;
  sectionTitle: string;
  testId: string;
  testUpdatedAt: number;
  inputs?: Record<string, string>;
};

export type SuiteRunManifest = {
  id: string;
  suiteId: string;
  suiteTitle: string;
  suiteUpdatedAt: number;
  createdAt: number;
  entries: SuiteRunManifestEntry[];
};
