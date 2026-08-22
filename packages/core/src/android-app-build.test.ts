import assert from "node:assert/strict";
import test from "node:test";
import { setAndroidAppLocale } from "./android-app-build.js";
import { runWithTargetContext } from "./target-context.js";

function localeArgs(args: string[]): { action?: string; locale?: string } {
  const action = args.includes("set-app-locales")
    ? "set"
    : args.includes("get-app-locales")
      ? "get"
      : undefined;
  const localesAt = args.indexOf("--locales");
  return { action, locale: localesAt >= 0 ? args[localesAt + 1] : undefined };
}

test("set-locale retries he as iw when the requested tag fails", async () => {
  const sets: string[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "pixel" }, () =>
    setAndroidAppLocale("com.example", "he", {
      command: async (args) => {
        const { action, locale } = localeArgs(args);
        if (action === "get") {
          return { stdout: sets.at(-1) ? `Locales for app for user 0 are [${sets.at(-1)}]` : "[]" };
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
