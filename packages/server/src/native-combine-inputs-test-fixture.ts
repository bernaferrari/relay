import { createAppMap, mutateStoredAppMap, readAppMap } from "@relay/core";

export async function nativePromptCombineFixture(projectId: string) {
  const appMapId = "chat";
  const targetId = "input-fixture-pixel";
  const scope = { organizationId: "local", projectId, appMapId };
  await createAppMap({ ...scope, name: "Chat inputs" });
  await mutateStoredAppMap(projectId, appMapId, (current) => ({
    ...current,
    revision: current.revision + 1,
    screens: {
      home: {
        ...scope,
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: ["home-native"],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    screenVariants: {
      "home-native": {
        ...scope,
        id: "home-native",
        screenId: "home",
        targetProfile: {
          id: "native-profile",
          targetId,
          source: "device",
          platform: "android",
          name: "Native fixture",
          capabilities: ["snapshot"],
          observedAt: 1,
        },
        observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [],
        evidenceUris: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    variables: {
      language: {
        ...scope,
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example.fixture" },
        options: [
          { id: "en", label: "English" },
          { id: "it", label: "Italian" },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    tests: {
      prompt: {
        ...scope,
        id: "prompt",
        name: "Prompt",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "prompt",
            kind: "script",
            intent: "Use prompt",
            binding: { status: "resolved", kind: "script", source: 'return "{{chat_prompt}}";' },
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    combines: {
      daily: {
        ...scope,
        id: "daily",
        name: "Daily",
        variableIds: ["language"],
        testIds: ["prompt"],
        selected: { language: ["en", "it"] },
        cellRuntimeProfiles: ["en", "it"].map((language) => ({
          testId: "prompt",
          values: { language },
          targetProfileId: "native-profile",
        })),
        createdAt: 1,
        updatedAt: 1,
      },
    },
  }));
  const map = await readAppMap(projectId, appMapId);
  if (!map) throw new Error("Fixture map not found");
  return { map, appMapId, targetId };
}
