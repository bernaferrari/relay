import assert from "node:assert/strict";
import test from "node:test";
import { setAndroidAppLocale } from "./android-app-build.js";
import {
  ANDROID_LANGUAGE_SPLIT_TIMEOUT_MS,
  androidLanguageSplitInstalled,
  orderAndroidLocalesForSplitDownload,
  parseAndroidInstalledLanguageSplits,
  prefetchAndroidLanguageSplits,
} from "./android-play-language-splits.js";
import { runWithTargetContext } from "../target/target-context.js";

const ANDROID_TARGET = { kind: "device" as const, platform: "android" as const, serial: "pixel" };

function localeArgs(args: string[]): { action?: string; locale?: string } {
  const action = args.includes("set-app-locales")
    ? "set"
    : args.includes("get-app-locales")
      ? "get"
      : args.includes("pm") && args.includes("path")
        ? "path"
        : undefined;
  const localesAt = args.indexOf("--locales");
  return { action, locale: localesAt >= 0 ? args[localesAt + 1] : undefined };
}

function installedPaths(languageCodes: readonly string[], split = true): string {
  const files = ["base.apk"];
  if (split) files.push("split_config.arm64_v8a.apk", "split_config.xxhdpi.apk");
  for (const code of languageCodes) files.push(`split_config.${code}.apk`);
  return files.map((file) => `package:/data/app/example/${file}`).join("\n");
}

function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  elapsed: () => number;
} {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    elapsed: () => now,
  };
}

test("set-locale retries he as iw when the requested tag fails", async () => {
  const sets: string[] = [];
  const observed = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "pixel" },
    () =>
      setAndroidAppLocale("com.example", "he", {
        command: async (args) => {
          const { action, locale } = localeArgs(args);
          if (action === "get") {
            return {
              stdout: sets.at(-1) ? `Locales for app for user 0 are [${sets.at(-1)}]` : "[]",
            };
          }
          if (action === "set") {
            if (locale === "he") throw new Error("Unknown locale: he");
            sets.push(locale ?? "");
            return { stdout: "" };
          }
          throw new Error(`unexpected adb ${args.join(" ")}`);
        },
      }),
  );
  assert.deepEqual(sets, ["iw"]);
  assert.equal(observed, "iw");
});

test("set-locale reports the locale Android read back after it takes", async () => {
  const observed = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "pixel" },
    () =>
      setAndroidAppLocale("com.example", "pt-BR", {
        command: async (args) => {
          const { action, locale } = localeArgs(args);
          if (action === "get") {
            return { stdout: "Locales for app for user 0 are [pt-BR]" };
          }
          if (action === "set") {
            assert.equal(locale, "pt-BR");
            return { stdout: "" };
          }
          throw new Error(`unexpected adb ${args.join(" ")}`);
        },
      }),
  );
  assert.equal(observed, "pt-BR");
});

test("set-locale retries id as in when the tree language does not change", async () => {
  const sets: string[] = [];
  let tree = "en";
  await runWithTargetContext({ kind: "device", platform: "android", serial: "pixel" }, () =>
    setAndroidAppLocale("com.example", "id", {
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          return { stdout: `Locales for app for user 0 are [${tree}]` };
        }
        if (action === "set") {
          sets.push(locale ?? "");
          if (locale === "in") tree = "in";
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
      readTreeLanguage: async () => tree,
    }),
  );
  assert.deepEqual(sets, ["id", "in"]);
});

test("set-locale accepts an alias observation without another write", async () => {
  const sets: string[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "pixel" }, () =>
    setAndroidAppLocale("com.example", "he", {
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          return {
            stdout: sets.length ? "Locales for app for user 0 are [iw]" : "[]",
          };
        }
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["he"]);
});

test("set-locale retries remaining aliases when the write cannot be observed", async () => {
  const sets: string[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "pixel" }, () =>
    setAndroidAppLocale("com.example", "he", {
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          return {
            stdout: sets.at(-1) === "iw" ? "Locales for app for user 0 are [iw]" : "[]",
          };
        }
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["he", "iw"]);
});

test("set-locale fails closed when neither locale nor tree can be observed", async () => {
  const sets: string[] = [];
  await assert.rejects(
    () =>
      runWithTargetContext({ kind: "device", platform: "android", serial: "pixel" }, () =>
        setAndroidAppLocale("com.example", "he", {
          command: async (args) => {
            const { action, locale } = localeArgs(args);
            if (action === "get") return { stdout: "[]" };
            if (action === "set") {
              sets.push(locale ?? "");
              return { stdout: "" };
            }
            throw new Error(`unexpected adb ${args.join(" ")}`);
          },
        }),
      ),
    /could not be observed/,
  );
  assert.deepEqual(sets, ["he", "iw"]);
});

test("set-locale fails closed when no candidate takes", async () => {
  await assert.rejects(
    () =>
      runWithTargetContext({ kind: "device", platform: "android", serial: "pixel" }, () =>
        setAndroidAppLocale("com.example", "he", {
          command: async (args) => {
            const { action } = localeArgs(args);
            if (action === "get") return { stdout: "Locales for app for user 0 are [en]" };
            if (action === "set") throw new Error("rejected");
            throw new Error(`unexpected adb ${args.join(" ")}`);
          },
        }),
      ),
    /rejected/,
  );
});

test("language splits match the BCP-47 subtag and legacy aliases, not abi or density", () => {
  const paths = [
    "package:/data/app/example/base.apk",
    "package:/data/app/example/split_config.arm64_v8a.apk",
    "package:/data/app/example/split_config.armeabi_v7a.apk",
    "package:/data/app/example/split_config.xxhdpi.apk",
    "package:/data/app/example/split_config.pt.apk",
    "package:/data/app/example/split_config.iw.apk",
    "package:/data/app/example/split_config.in.apk",
    "package:/data/app/example/split_config.ji.apk",
    "package:/data/app/example/split_config.zh.apk",
    "package:/data/app/example/split_config.es.apk",
    "package:/data/app/example/split_config.fr.apk",
    "package:/data/app/example/split_config.ar.apk",
    "package:/data/app/example/split_config.ur.apk",
  ].join("\n");
  assert.deepEqual(parseAndroidInstalledLanguageSplits(paths), [
    "pt",
    "iw",
    "in",
    "ji",
    "zh",
    "es",
    "fr",
    "ar",
    "ur",
  ]);
  for (const locale of ["pt", "pt-BR", "he", "he-IL", "iw", "id", "id-ID", "in", "yi", "ji"]) {
    assert.equal(androidLanguageSplitInstalled(locale, paths), true, locale);
  }
  for (const locale of ["zh-CN", "zh-TW", "es-US", "fr-CA", "ar-SA", "ur-IN"]) {
    assert.equal(androidLanguageSplitInstalled(locale, paths), true, locale);
  }
  assert.equal(androidLanguageSplitInstalled("de", paths), false);
  assert.equal(androidLanguageSplitInstalled("en", paths), false);
  const indonesianOnly = installedPaths(["in"]);
  assert.equal(androidLanguageSplitInstalled("id", indonesianOnly), true);
  assert.equal(androidLanguageSplitInstalled("ur-IN", indonesianOnly), false);
  assert.equal(androidLanguageSplitInstalled("ar", installedPaths([])), false);
});

test("split download keeps the current locale first, else the requested one", () => {
  assert.deepEqual(orderAndroidLocalesForSplitDownload(["en", "de", "pt-BR"], "en", "de"), [
    "en",
    "de",
    "pt-BR",
  ]);
  assert.deepEqual(orderAndroidLocalesForSplitDownload(["en", "de", "pt-BR"], "fr", "de"), [
    "de",
    "en",
    "pt-BR",
  ]);
  assert.deepEqual(orderAndroidLocalesForSplitDownload(["en", "de", "pt-BR"], "fr", "ja"), [
    "en",
    "de",
    "pt-BR",
  ]);
  assert.deepEqual(orderAndroidLocalesForSplitDownload(["pt-BR", "de", "en"], "en", "de"), [
    "en",
    "pt-BR",
    "de",
  ]);
});

test("prefetch does not write locales when every declared language split is installed", async () => {
  const sets: string[] = [];
  const calls: string[][] = [];
  const clock = fakeClock();
  await runWithTargetContext(ANDROID_TARGET, () =>
    prefetchAndroidLanguageSplits({
      packageName: "com.example",
      requestedLocale: "he",
      declaredLocales: ["en", "he", "pt-BR"],
      currentLocale: "en",
      timeoutMs: 3_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        calls.push(args);
        const { action, locale } = localeArgs(args);
        if (action === "path") return { stdout: installedPaths(["en", "iw", "pt"]) };
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, []);
  assert.equal(clock.elapsed(), 0);
  assert.equal(
    calls.some((args) => args.includes("force-stop") || args.includes("system_locales")),
    false,
  );
});

test("prefetch skips the download when the install has no config splits", async () => {
  const sets: string[] = [];
  const clock = fakeClock();
  await runWithTargetContext(ANDROID_TARGET, () =>
    prefetchAndroidLanguageSplits({
      packageName: "com.example",
      requestedLocale: "de",
      declaredLocales: ["en", "de"],
      currentLocale: "en",
      timeoutMs: 3_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "path") return { stdout: installedPaths([], false) };
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, []);
  assert.equal(clock.elapsed(), 0);
});

test("prefetch asks Play once for the full locale list and polls until the splits appear", async () => {
  const sets: string[] = [];
  const calls: string[][] = [];
  let pathReads = 0;
  const clock = fakeClock();
  await runWithTargetContext(ANDROID_TARGET, () =>
    prefetchAndroidLanguageSplits({
      packageName: "com.example",
      requestedLocale: "de",
      declaredLocales: ["pt-BR", "de", "en"],
      currentLocale: "en",
      timeoutMs: 10_000,
      pollMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        calls.push(args);
        const { action, locale } = localeArgs(args);
        if (action === "path") {
          pathReads += 1;
          return {
            stdout: installedPaths(pathReads >= 3 ? ["en", "pt", "de"] : ["en", "pt"]),
          };
        }
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["en,pt-BR,de"]);
  assert.equal(sets[0]?.includes(" "), false);
  assert.equal(pathReads, 3);
  assert.equal(clock.elapsed(), 1_000);
  assert.equal(
    calls.some((args) => args.includes("force-stop") || args.includes("system_locales")),
    false,
  );
});

test("prefetch fails naming the package and language splits that never arrive", async () => {
  const sets: string[] = [];
  const clock = fakeClock();
  await assert.rejects(
    () =>
      runWithTargetContext(ANDROID_TARGET, () =>
        prefetchAndroidLanguageSplits({
          packageName: "com.example",
          requestedLocale: "de",
          declaredLocales: ["de", "he", "en"],
          currentLocale: "en",
          now: clock.now,
          sleep: clock.sleep,
          command: async (args) => {
            const { action, locale } = localeArgs(args);
            if (action === "path") return { stdout: installedPaths(["en"]) };
            if (action === "set") {
              sets.push(locale ?? "");
              return { stdout: "" };
            }
            throw new Error(`unexpected adb ${args.join(" ")}`);
          },
        }),
      ),
    /language splits for com\.example still missing after 90s: split_config\.de\.apk, split_config\.he\.apk or split_config\.iw\.apk/u,
  );
  assert.deepEqual(sets, ["en,de,he"]);
  assert.equal(clock.elapsed(), ANDROID_LANGUAGE_SPLIT_TIMEOUT_MS);
});

test("set-locale writes the requested tag in front of the declared list", async () => {
  const sets: string[] = [];
  let pathReads = 0;
  const clock = fakeClock();
  const observed = await runWithTargetContext(ANDROID_TARGET, () =>
    setAndroidAppLocale("com.example", "de", {
      declaredLocales: ["en", "pt-BR", "de", "zh-CN"],
      languageSplitTimeoutMs: 3_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          const primary = sets.at(-1)?.split(",")[0] ?? "en";
          return { stdout: `Locales for app for user 0 are [${primary}]` };
        }
        if (action === "path") {
          pathReads += 1;
          return { stdout: installedPaths(["en", "pt", "de", "zh"]) };
        }
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["de,en,pt-BR,zh-CN"]);
  assert.notEqual(sets[0], "de");
  assert.equal(pathReads, 1);
  assert.equal(clock.elapsed(), 0);
  assert.equal(observed, "de");
});

test("set-locale downloads missing splits once, then writes the requested tag first", async () => {
  const sets: string[] = [];
  const calls: string[][] = [];
  let pathReads = 0;
  const clock = fakeClock();
  const observed = await runWithTargetContext(ANDROID_TARGET, () =>
    setAndroidAppLocale("com.example", "de", {
      declaredLocales: ["pt-BR", "de", "en"],
      languageSplitTimeoutMs: 3_000,
      languageSplitPollMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        calls.push(args);
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          const primary = sets.at(-1)?.split(",")[0] ?? "en";
          return { stdout: `Locales for app for user 0 are [${primary}]` };
        }
        if (action === "path") {
          pathReads += 1;
          const codes = pathReads >= 2 ? ["en", "pt", "de"] : ["en", "pt"];
          return { stdout: installedPaths(codes) };
        }
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["en,pt-BR,de", "de,pt-BR,en"]);
  assert.equal(pathReads, 2);
  assert.equal(observed, "de");
  assert.equal(
    calls.some((args) => args.includes("force-stop") || args.includes("system_locales")),
    false,
  );
});

test("set-locale alias retry keeps declared locales behind the candidate", async () => {
  const sets: string[] = [];
  const clock = fakeClock();
  await runWithTargetContext(ANDROID_TARGET, () =>
    setAndroidAppLocale("com.example", "he", {
      declaredLocales: ["en", "he", "de"],
      languageSplitTimeoutMs: 3_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          const primary = sets.at(-1)?.split(",")[0];
          const observed = primary === "iw" ? "iw" : "en";
          return { stdout: `Locales for app for user 0 are [${observed}]` };
        }
        if (action === "path") return { stdout: installedPaths(["en", "iw", "de"]) };
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["he,en,de", "iw,en,he,de"]);
});

test("set-locale keeps a single tag when declared locales cannot be discovered", async () => {
  const sets: string[] = [];
  let discovered = false;
  await runWithTargetContext(ANDROID_TARGET, () =>
    setAndroidAppLocale("com.example", "de", {
      discoverDeclaredLocales: async () => {
        discovered = true;
        throw new Error("no locales_config");
      },
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "path" || action === undefined) {
          throw new Error(`prefetch should not run: ${args.join(" ")}`);
        }
        if (action === "get") {
          return {
            stdout: sets.at(-1)
              ? `Locales for app for user 0 are [${sets.at(-1)}]`
              : "Locales for app for user 0 are [en]",
          };
        }
        sets.push(locale ?? "");
        return { stdout: "" };
      },
    }),
  );
  assert.equal(discovered, true);
  assert.deepEqual(sets, ["de"]);
});

test("set-locale uses locales reported by discovery", async () => {
  const sets: string[] = [];
  const clock = fakeClock();
  await runWithTargetContext(ANDROID_TARGET, () =>
    setAndroidAppLocale("com.example", "de", {
      discoverDeclaredLocales: async () => ["en", "de"],
      languageSplitTimeoutMs: 3_000,
      now: clock.now,
      sleep: clock.sleep,
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          const primary = sets.at(-1)?.split(",")[0] ?? "en";
          return { stdout: `Locales for app for user 0 are [${primary}]` };
        }
        if (action === "path") return { stdout: installedPaths(["en", "de"]) };
        if (action === "set") {
          sets.push(locale ?? "");
          return { stdout: "" };
        }
        throw new Error(`unexpected adb ${args.join(" ")}`);
      },
    }),
  );
  assert.deepEqual(sets, ["de,en"]);
});
