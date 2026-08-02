import assert from "node:assert/strict";
import test from "node:test";
import type { TestVariable } from "@relay/protocol";
import { prepareRunMatrix } from "./run-matrix.js";

test("run matrices freeze list and generated values before execution", async () => {
  const matrix = await prepareRunMatrix({
    repetitions: 3,
    seed: 42,
    variables: [
      {
        id: "locale",
        name: "locale",
        scope: "shared",
        source: "list",
        values: ["en", "pt"],
        fallback: "en",
      },
      {
        id: "prompt",
        name: "prompt",
        scope: "shared",
        source: "generated",
        prompt: "Ask a geography question",
        fallback: "Where is Paris?",
      },
    ],
  });

  assert.equal(matrix.cases.length, 3);
  assert.deepEqual(
    matrix.cases.map((item) => item.values.locale),
    ["en", "pt", "en"],
  );
  assert.equal(new Set(matrix.cases.map((item) => item.values.prompt)).size, 3);
  assert.ok(matrix.cases.every((item) => item.provenance.length === 2));
});

test("zip broadcasts scalar values across one named list", async () => {
  const matrix = await prepareRunMatrix({
    strategy: "zip",
    variableIds: ["tier", "locale"],
    variables: [
      {
        id: "tier",
        name: "thinking_level",
        scope: "shared",
        source: "list",
        values: ["low", "medium", "high", "xhigh", "pro"],
      },
      {
        id: "locale",
        name: "locale",
        scope: "shared",
        source: "static",
        values: ["en"],
      },
    ],
  });

  assert.equal(matrix.cases.length, 5);
  assert.deepEqual(
    matrix.cases.map((item) => item.values.thinking_level),
    ["low", "medium", "high", "xhigh", "pro"],
  );
  assert.ok(matrix.cases.every((item) => item.values.locale === "en"));
});

test("cartesian and pairwise expansion are deterministic and bounded", async () => {
  const variables: TestVariable[] = [
    { id: "a", name: "a", scope: "shared", source: "list", values: ["1", "2"] },
    { id: "b", name: "b", scope: "shared", source: "list", values: ["1", "2", "3"] },
    { id: "c", name: "c", scope: "shared", source: "list", values: ["1", "2"] },
  ];
  const cartesian = await prepareRunMatrix({ variables, strategy: "cartesian" });
  const pairwise = await prepareRunMatrix({ variables, strategy: "pairwise" });

  assert.equal(cartesian.cases.length, 12);
  assert.ok(pairwise.cases.length < cartesian.cases.length);
  const pairs = new Set(
    pairwise.cases.flatMap((item) => [
      `a:${item.values.a}|b:${item.values.b}`,
      `a:${item.values.a}|c:${item.values.c}`,
      `b:${item.values.b}|c:${item.values.c}`,
    ]),
  );
  assert.equal(pairs.size, 2 * 3 + 2 * 2 + 3 * 2);
});

test("pairwise coverage scales without constructing the Cartesian product", async () => {
  const values = Array.from({ length: 11 }, (_, index) => String(index));
  const variables: TestVariable[] = ["a", "b", "c", "d"].map((name) => ({
    id: name,
    name,
    scope: "shared",
    source: "list",
    values,
  }));
  const matrix = await prepareRunMatrix({
    variables,
    strategy: "pairwise",
    maxCases: 250,
  });

  assert.ok(matrix.cases.length <= 250);
  for (let left = 0; left < variables.length; left += 1) {
    for (let right = left + 1; right < variables.length; right += 1) {
      const pairs = new Set(
        matrix.cases.map(
          (item) => `${item.values[variables[left]!.name]}:${item.values[variables[right]!.name]}`,
        ),
      );
      assert.equal(pairs.size, 121);
    }
  }
});

test("private variables never fall back to collaborative values", async () => {
  const variable = {
    id: "login",
    name: "login_email",
    scope: "private",
    source: "static",
  } as const;
  await assert.rejects(prepareRunMatrix({ variables: [variable] }), /needs a local value/);
  const matrix = await prepareRunMatrix({
    variables: [variable],
    runtimeValues: { login_email: "me@example.test" },
  });
  assert.equal(matrix.cases[0]?.values.login_email, "me@example.test");
  assert.equal(matrix.cases[0]?.name, "Private case 1");
});

test("unselected private variables do not block an unrelated run", async () => {
  const matrix = await prepareRunMatrix({
    variableIds: ["locale"],
    variables: [
      { id: "locale", name: "locale", scope: "shared", source: "static", values: ["en"] },
      { id: "login", name: "login_email", scope: "private", source: "static" },
    ],
  });
  assert.deepEqual(matrix.cases[0]?.values, { locale: "en" });
});
