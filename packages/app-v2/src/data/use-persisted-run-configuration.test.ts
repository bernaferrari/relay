import { describe, expect, it } from "vitest";
import {
  runConfigurationStorageKey,
  usePersistedRunConfiguration,
} from "./use-persisted-run-configuration";

describe("run configuration persistence", () => {
  it("scopes keys to workspace identity", () => {
    expect(
      runConfigurationStorageKey({
        server: "relay",
        organization: "org",
        project: "project",
        appId: "app",
        entity: "test",
      }),
    ).toBe("relay:run-config:relay:org:project:app:test");
  });
  it("exports an async hook API", () => {
    expect(usePersistedRunConfiguration).toBeTypeOf("function");
  });
});
