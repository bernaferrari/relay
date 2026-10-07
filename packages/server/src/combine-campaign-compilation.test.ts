import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, CombineCampaign } from "@relay/protocol";
import { nativePromptCombineFixture } from "./native-combine-inputs-test-fixture.js";
import { mapForFrozenCampaignCompilation } from "./combine-campaign-compilation.js";

test("only a complete canonical validation range retains the same-map frozen compilation namespace", async () => {
  const { map } = await nativePromptCombineFixture("frozen-compilation-guard");
  const campaign: Pick<CombineCampaign, "appMapId" | "sourceRevision" | "lineage"> = {
    appMapId: map.id,
    sourceRevision: map.revision,
    lineage: [],
  };
  const at = map.updatedAt + 1;
  const current: AppMap = {
    ...map,
    revision: map.revision + 1,
    activity: {
      ...map.activity,
      "test-validated-fixture": {
        organizationId: map.organizationId,
        projectId: map.projectId,
        appMapId: map.id,
        id: "test-validated-fixture",
        actorId: "human:fixture",
        actorKind: "human",
        eventType: "test.validated",
        subject: { kind: "test", id: "prompt" },
        touched: ["test:prompt:validation"],
        summary: "Validated Test Prompt",
        at,
        beforeRevision: map.revision,
        afterRevision: map.revision + 1,
      },
    },
  };
  const retained = mapForFrozenCampaignCompilation(current, campaign);
  assert.deepEqual(retained, { ...current, revision: map.revision, activity: map.activity });
  assert.equal(current.revision, map.revision + 1, "the canonical Map is never rewritten");
  assert.equal(mapForFrozenCampaignCompilation(map, campaign), map);
  const event = current.activity["test-validated-fixture"]!;
  const rejects: Record<string, AppMap> = {
    "missing event": { ...current, activity: map.activity },
    "gap after validation": { ...current, revision: current.revision + 1 },
    "authored edit": {
      ...current,
      activity: { ...current.activity, [event.id]: { ...event, eventType: "connection.updated" } },
    },
    "wrong scope": {
      ...current,
      activity: { ...current.activity, [event.id]: { ...event, appMapId: "foreign-map" } },
    },
    "whole Test edit": {
      ...current,
      activity: { ...current.activity, [event.id]: { ...event, touched: ["test:prompt"] } },
    },
    "duplicate revision": {
      ...current,
      activity: { ...current.activity, duplicate: { ...event, id: "test-validated-duplicate" } },
    },
    "skipped revision": {
      ...current,
      activity: {
        ...current.activity,
        [event.id]: { ...event, afterRevision: current.revision + 1 },
      },
    },
  };
  for (const [reason, changed] of Object.entries(rejects)) {
    assert.equal(mapForFrozenCampaignCompilation(changed, campaign), changed, reason);
  }
  assert.equal(
    mapForFrozenCampaignCompilation(current, { ...campaign, appMapId: "companion" }),
    current,
  );
  assert.equal(
    mapForFrozenCampaignCompilation(current, {
      ...campaign,
      lineage: [
        {
          kind: "resumed",
          at,
          appMapRevision: current.revision,
          causalRepairProposalIds: ["approved-repair"],
        },
      ],
    }),
    current,
  );
});
