import assert from "node:assert/strict";
import test from "node:test";
import {
  createAndroidResourceStringIndex,
  parseAndroidResourceStrings,
} from "./android-resource-strings.js";

const dump = [
  "resource 0x7f010001 string/title",
  '  () "Hello\\nworld"',
  '  (ja) "こんにちは\\n世界"',
  "resource 0x7f010002 string/quoted",
  '  () "Say \\"hi\\" \\u2605"',
  '  (ja) "\\u8A00\\u3063\\u3066 \\"hi\\""',
].join("\n");

test("parses escaped quotes, unicode, and escaped multiline values", () => {
  assert.deepEqual(parseAndroidResourceStrings(dump), [
    { key: "title", locale: "", value: "Hello\nworld" },
    { key: "title", locale: "ja", value: "こんにちは\n世界" },
    { key: "quoted", locale: "", value: 'Say "hi" ★' },
    { key: "quoted", locale: "ja", value: '言って "hi"' },
  ]);
});

test("maps an exact source string to its same key in the target locale", () => {
  const index = createAndroidResourceStringIndex(dump, { targetLocale: "ja" });
  assert.deepEqual(index.lookup("Hello\nworld"), {
    status: "matched",
    key: "title",
    source: "Hello\nworld",
    target: "こんにちは\n世界",
  });
  assert.equal(index.lookup("Hello world").status, "missing");
});

test("fails closed when multiple keys produce different translations", () => {
  const index = createAndroidResourceStringIndex(
    [
      'resource 0x1 string/one\n  () "Save"\n  (ja) "保存"',
      'resource 0x2 string/two\n  () "Save"\n  (ja) "セーブ"',
    ].join("\n"),
    { targetLocale: "ja" },
  );
  assert.deepEqual(index.lookup("Save"), {
    status: "ambiguous",
    source: "Save",
    candidates: [
      { key: "one", target: "保存" },
      { key: "two", target: "セーブ" },
    ],
  });
});

test("requires an explicitly available target locale", () => {
  const index = createAndroidResourceStringIndex(dump, { targetLocale: "fr" });
  assert.equal(index.lookup("Hello\nworld").status, "missing");
});

test("falls back from a regional target locale to its language resources", () => {
  const index = createAndroidResourceStringIndex(dump, { targetLocale: "ja-JP" });
  assert.deepEqual(index.lookup("Hello\nworld"), {
    status: "matched",
    key: "title",
    source: "Hello\nworld",
    target: "こんにちは\n世界",
  });
});

test("prefers an exact regional target over its language fallback", () => {
  const index = createAndroidResourceStringIndex(
    ['resource 0x1 string/title\n  () "Title"', '  (ja) "題名"', '  (ja-rJP) "タイトル"'].join(
      "\n",
    ),
    { targetLocale: "ja-JP" },
  );
  assert.deepEqual(index.lookup("Title"), {
    status: "matched",
    key: "title",
    source: "Title",
    target: "タイトル",
  });
});

test("uses every resource heading as a boundary and ignores non-locale qualifiers", () => {
  const actual = parseAndroidResourceStrings(
    [
      "resource 0x1 string/first",
      '  () "First"',
      '  (ja) "最初"',
      "resource 0x2 array/labels",
      '  (ja) "must not become a string"',
      "resource 0x3 string/second",
      '  (en-land) "wrong config"',
      '  (en) "Second"',
      '  (b+ja+Latn) "Second Japanese"',
    ].join("\n"),
  );
  assert.deepEqual(actual, [
    { key: "first", locale: "", value: "First" },
    { key: "first", locale: "ja", value: "最初" },
    { key: "second", locale: "en", value: "Second" },
    { key: "second", locale: "ja-latn", value: "Second Japanese" },
  ]);
});

test("fails closed for duplicate resource variants with different target values", () => {
  const index = createAndroidResourceStringIndex(
    ["resource 0x1 string/title", '  () "Title"', '  (ja) "題名"', '  (ja) "タイトル"'].join("\n"),
    { targetLocale: "ja" },
  );
  assert.deepEqual(index.lookup("Title"), {
    status: "ambiguous",
    source: "Title",
    candidates: [
      { key: "title", target: "題名" },
      { key: "title", target: "タイトル" },
    ],
  });
});
