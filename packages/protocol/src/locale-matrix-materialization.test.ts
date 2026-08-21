import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeLocaleMatrixCases,
  normalizeLocaleMatrixLocales,
} from "./locale-matrix-materialization.js";

test("locale materialization normalizes inputs and keeps the restore as an indexed final case", () => {
  assert.deepEqual(normalizeLocaleMatrixLocales([" en ", "it", "en"]), ["en", "it"]);
  assert.deepEqual(
    materializeLocaleMatrixCases({
      locales: [" en ", "it", "en"],
      restoreLocale: "en",
      restoreAtEnd: true,
    }),
    [
      { caseIndex: 0, locale: "en" },
      { caseIndex: 1, locale: "it" },
      { caseIndex: 2, locale: "en" },
    ],
  );
});

test("locale materialization omits a redundant final restore and rejects unbounded plans", () => {
  assert.deepEqual(materializeLocaleMatrixCases({ locales: ["it", "en"], restoreLocale: "en" }), [
    { caseIndex: 0, locale: "it" },
    { caseIndex: 1, locale: "en" },
  ]);
  assert.throws(
    () =>
      materializeLocaleMatrixCases({
        locales: Array.from({ length: 251 }, (_, index) => `x${index}`),
      }),
    /at most 250/u,
  );
  assert.throws(
    () =>
      materializeLocaleMatrixCases({
        locales: Array.from({ length: 250 }, (_, index) => `x${index}`),
        restoreLocale: "restore",
      }),
    /at most 250 locale cases/u,
  );
});
