import assert from "node:assert/strict";
import test from "node:test";
import {
  androidLocaleTagCandidates,
  androidLocaleTagsCompatible,
  parseAndroidLocaleOutput,
} from "./android-locale-tags.js";

test("Android locale aliases try the requested tag then the Java/legacy pair", () => {
  assert.deepEqual(androidLocaleTagCandidates("he"), ["he", "iw"]);
  assert.deepEqual(androidLocaleTagCandidates("iw"), ["iw", "he"]);
  assert.deepEqual(androidLocaleTagCandidates("id"), ["id", "in"]);
  assert.deepEqual(androidLocaleTagCandidates("in"), ["in", "id"]);
  assert.deepEqual(androidLocaleTagCandidates("he-IL"), ["he-IL", "iw-IL"]);
  assert.deepEqual(androidLocaleTagCandidates("id-ID"), ["id-ID", "in-ID"]);
  assert.deepEqual(androidLocaleTagCandidates("ja"), ["ja"]);
});

test("compatible tags fold he/iw and id/in and ignore a missing region", () => {
  assert.equal(androidLocaleTagsCompatible("he", "iw"), true);
  assert.equal(androidLocaleTagsCompatible("he-IL", "iw-IL"), true);
  assert.equal(androidLocaleTagsCompatible("he", "iw-IL"), true);
  assert.equal(androidLocaleTagsCompatible("id", "in"), true);
  assert.equal(androidLocaleTagsCompatible("id-ID", "in-ID"), true);
  assert.equal(androidLocaleTagsCompatible("he-IL", "iw-US"), false);
  assert.equal(androidLocaleTagsCompatible("he", "id"), false);
  assert.equal(androidLocaleTagsCompatible("ja", "ja-JP"), true);
});

test("parses LocaleManager list output", () => {
  assert.equal(parseAndroidLocaleOutput("Locales for app for user 0 are [en-US,fr]"), "en-US");
  assert.equal(parseAndroidLocaleOutput("pt-BR\n"), "pt-BR");
  assert.equal(parseAndroidLocaleOutput("Locales for app for user 0 are []"), undefined);
});
