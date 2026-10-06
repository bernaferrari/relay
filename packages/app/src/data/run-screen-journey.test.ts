import { describe, expect, it } from "vitest";
import { buildRunScreenJourney, matchRunScreenIdentity } from "./run-screen-journey";

const checkpoint = (id: string, screenId: string, fingerprint = `${screenId}-fp`) => ({
  id,
  kind: "expect-screen",
  screenId,
  screenTitle: "Settings",
  fingerprint,
  aliases: [`${screenId}-alias`],
});
const cursor = (screenId: string, at: number, source = "screen-observation") => ({
  kind: "navigation-proof-cursor",
  capturedAt: at,
  data: {
    schemaVersion: 1,
    status: "proven",
    screenId,
    source,
    updatedAt: at,
    proofToken: `proof-${at}`,
  },
});
function job(): {
  recipeSnapshot: Record<string, unknown>;
  recipeGraph: { child: { id: string; steps: Record<string, unknown>[] } } & Record<
    string,
    { id: string; steps: Record<string, unknown>[] }
  >;
  artifacts: Record<string, unknown>[];
  steps: Record<string, unknown>[];
} {
  return {
    recipeSnapshot: {
      id: "root",
      steps: [
        {
          id: "open",
          kind: "module",
          recipeId: "child",
          check: {
            transitionDependencies: [
              {
                connectionId: "open-settings",
                originScreenId: "home",
                destination: { kind: "screen", screenId: "settings" },
              },
            ],
          },
        },
      ],
    },
    recipeGraph: {
      child: {
        id: "child",
        steps: [
          checkpoint("origin", "home"),
          { id: "tap", kind: "tap" },
          checkpoint("destination", "settings"),
        ],
      },
    },
    artifacts: [
      {
        kind: "app-map-player-snapshot",
        data: {
          id: "map",
          revision: 2,
          screens: {
            home: { title: "Home" },
            settings: { title: "Settings" },
            alternate: {
              title: "Settings",
              identity: { fingerprint: "alternate-fp", aliases: ["alternate-alias"] },
            },
          },
          connections: { "open-settings": { id: "open-settings", label: "Open settings" } },
        },
      },
    ],
    steps: [] as Record<string, unknown>[],
  };
}

describe("Run screen journey", () => {
  it("starts from frozen checkpoints and canonical transition labels", () => {
    const result = buildRunScreenJourney(job());
    expect(
      result.planned.map(({ screenId, title, state, fact, via }) => ({
        screenId,
        title,
        state,
        fact,
        via,
      })),
    ).toEqual([
      { screenId: "home", title: "Home", state: "pending", fact: "planned", via: undefined },
      {
        screenId: "settings",
        title: "Settings",
        state: "pending",
        fact: "planned",
        via: { connectionId: "open-settings", label: "Open settings" },
      },
    ]);
    expect(result.observed).toEqual([]);
    expect(result.current).toBeUndefined();
  });

  it("uses exact trace provenance for reached checks without inventing observations", () => {
    const input = job();
    input.steps = [
      {
        id: "wrong",
        recipeId: "other",
        recipeStepId: "destination",
        title: "Reach Settings",
        status: "ok",
      },
      { id: "reach", recipeId: "child", recipeStepId: "origin", status: "ok" },
    ];
    const result = buildRunScreenJourney(input);
    expect(result.planned[0]).toMatchObject({
      state: "visited",
      fact: "reached-check",
      traceStepId: "reach",
    });
    expect(result.planned[1]).toMatchObject({ state: "pending", fact: "planned" });
    expect(result.observed).toEqual([]);
    expect(result.current).toBeUndefined();
  });

  it("follows proven observations and retains unknown cursor invalidations", () => {
    const input = job();
    input.artifacts.push(cursor("home", 10), cursor("settings", 20));
    let result = buildRunScreenJourney(input);
    expect(result.planned.map((p) => [p.screenId, p.state, p.fact])).toEqual([
      ["home", "visited", "observed"],
      ["settings", "current", "observed"],
    ]);
    expect(result.current).toMatchObject({
      status: "proven",
      screenId: "settings",
      fact: "observed",
    });
    input.artifacts.push({
      kind: "navigation-proof-cursor",
      data: {
        status: "unknown",
        reason: "Device changed",
        previous: { screenId: "settings" },
        updatedAt: 30,
      },
    });
    result = buildRunScreenJourney(input);
    expect(result.current).toEqual({
      status: "unknown",
      reason: "Device changed",
      foregroundApp: undefined,
    });
    expect(result.planned.every((p) => p.state !== "current")).toBe(true);
  });

  it("branches only for an exact unexpected observation, despite identical titles", () => {
    const input = job();
    input.artifacts.push(cursor("home", 10), cursor("alternate", 20));
    const result = buildRunScreenJourney(input);
    expect(result.observed[1]).toMatchObject({
      screenId: "alternate",
      branch: true,
      fromScreenId: "home",
    });
    expect(result.planned[1]).toMatchObject({
      screenId: "settings",
      state: "pending",
      fact: "planned",
    });
    expect(result.current).toMatchObject({ screenId: "alternate", title: "Settings" });
  });

  it("retains an observed shortcut as a branch without claiming the skipped planned screen", () => {
    const input = job();
    input.recipeGraph.child.steps.splice(1, 0, checkpoint("drawer-check", "drawer"));
    input.artifacts.push(cursor("home", 10), cursor("settings", 20));
    const result = buildRunScreenJourney(input);
    expect(result.observed[1]).toMatchObject({
      screenId: "settings",
      branch: true,
      fromScreenId: "home",
    });
    expect(result.planned[1]).toMatchObject({
      screenId: "drawer",
      state: "pending",
      fact: "planned",
    });
    expect(result.planned[2]).toMatchObject({
      screenId: "settings",
      state: "pending",
      fact: "planned",
    });
  });

  it("attaches a branch to one exact returning-screen occurrence", () => {
    const input = job();
    input.recipeGraph.child.steps.push(checkpoint("return", "home"));
    input.artifacts.push(
      cursor("home", 10),
      cursor("settings", 20),
      cursor("home", 30),
      cursor("alternate", 40),
      cursor("alternate", 50, "cleanup"),
    );
    const result = buildRunScreenJourney(input);
    expect(result.observed[3]).toMatchObject({
      branch: true,
      fromScreenId: "home",
      fromWaypointId: result.planned[2]!.id,
    });
    expect(result.current).toMatchObject({ screenId: "alternate", at: 50, fact: "reached-check" });
    expect(result.planned.every((screen) => screen.state !== "current")).toBe(true);
  });

  it("retains transition labels through nested frozen modules", () => {
    const input = job();
    input.recipeGraph.nested = { id: "nested", steps: input.recipeGraph.child.steps };
    input.recipeGraph.child.steps = [{ id: "nested-call", kind: "module", recipeId: "nested" }];
    expect(buildRunScreenJourney(input).planned[1]?.via).toEqual({
      connectionId: "open-settings",
      label: "Open settings",
    });
  });

  it("matches IDs and unique approved fingerprint aliases, rejecting ambiguity and titles", () => {
    const input = job();
    expect(matchRunScreenIdentity(input, { fingerprint: "settings-alias" })).toBe("settings");
    expect(matchRunScreenIdentity(input, { fingerprint: "alternate-alias" })).toBe("alternate");
    expect(matchRunScreenIdentity(input, { fingerprint: "Settings" })).toBeUndefined();
    expect(
      matchRunScreenIdentity(input, { screenId: "missing", fingerprint: "settings-alias" }),
    ).toBeUndefined();
    input.recipeGraph.child.steps.push(checkpoint("duplicate-fingerprint", "other", "settings-fp"));
    expect(matchRunScreenIdentity(input, { fingerprint: "settings-fp" })).toBeUndefined();
  });

  it("does not treat verified transitions or stale previous proofs as raw observations", () => {
    const input = job();
    input.artifacts.push(cursor("settings", 10, "transition"));
    let result = buildRunScreenJourney(input);
    expect(result.observed).toEqual([]);
    expect(result.current).toMatchObject({ status: "proven", fact: "reached-check" });
    input.artifacts.push({
      kind: "navigation-proof-cursor",
      data: {
        status: "external-handoff",
        foregroundApp: "other.app",
        reason: "Handoff",
        previous: { screenId: "settings" },
        updatedAt: 20,
      },
    });
    result = buildRunScreenJourney(input);
    expect(result.current).toMatchObject({
      status: "external-handoff",
      foregroundApp: "other.app",
    });
    expect(result.planned.every((p) => p.state !== "current")).toBe(true);
  });

  it("keeps ambiguous invocation traces and unsupported proof sources unproven", () => {
    const input = job();
    input.steps = ["first", "second"].map((id) => ({
      id,
      recipeId: "child",
      recipeStepId: "destination",
      status: "ok",
    }));
    input.artifacts.push(cursor("settings", 10, "expected-title"));
    const result = buildRunScreenJourney(input);
    expect(result.planned[1]).toMatchObject({ state: "pending", fact: "planned" });
    expect(result.current).toBeUndefined();
    expect(result.observed).toEqual([]);
  });

  it("coalesces adjacent same-screen checks but preserves a real return path and cycles terminate", () => {
    const input = job();
    input.recipeGraph.child.steps.push(
      checkpoint("same", "settings"),
      checkpoint("return", "home"),
      { id: "recursive", kind: "module", recipeId: "child" },
    );
    expect(buildRunScreenJourney(input).planned.map((p) => p.screenId)).toEqual([
      "home",
      "settings",
      "home",
    ]);
  });
});
