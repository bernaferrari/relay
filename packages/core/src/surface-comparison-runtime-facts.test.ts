import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureAndroidSurfaceRuntimeFacts,
  parseAndroidLocaleOutput,
} from "./surface-comparison-runtime-facts.js";
import type { TestJob } from "./session-contract.js";

test("parses explicit app locales and direct device locale output", () => {
  assert.equal(parseAndroidLocaleOutput("Locales for app for user 0 are [en-US,fr]"), "en-US");
  assert.equal(parseAndroidLocaleOutput("pt-BR\n"), "pt-BR");
  assert.equal(parseAndroidLocaleOutput("Locales for app for user 0 are []"), undefined);
});

test("freezes exact Android build and locale facts once", async () => {
  const job = {
    platform: "android",
    serial: "phone",
    resolvedInputs: {},
    artifacts: [],
  } as unknown as TestJob;
  let foregroundReads = 0;
  await ensureAndroidSurfaceRuntimeFacts(job, {
    foreground: async () => {
      foregroundReads += 1;
      return "ai.x.grok";
    },
    build: async () => ({ packageName: "ai.x.grok", installed: true, versionName: "1.2.23" }),
    command: async () => "Locales for ai.x.grok for user 0 are [es]",
  });
  await ensureAndroidSurfaceRuntimeFacts(job, {
    foreground: async () => {
      foregroundReads += 1;
      return "wrong";
    },
  });

  assert.equal(foregroundReads, 1);
  assert.equal(job.appVersion, "1.2.23");
  assert.equal(job.resolvedInputs.app_version, "1.2.23");
  assert.equal(job.resolvedInputs.app_locale, "es");
  assert.equal(job.artifacts.at(-1)?.kind, "app-build");
});
