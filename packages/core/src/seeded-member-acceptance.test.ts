import assert from "node:assert/strict";
import test from "node:test";
import { compileBrowserEnvironment } from "@relay/protocol";
import { contentAssertionPassed } from "./content-assertion-match.js";
import { editAppMapScenarioTest } from "./app-map.js";
import { compileAppMapTest } from "./map-work.js";
import {
  appMapRuntimeTargetProfileFromSaved,
  sameAppMapRuntimeTargetProfileIgnoringAccount,
} from "./app-map-runtime-target-profile.js";
import { loadFrozenRawAccessibilityEvidence } from "./frozen-raw-accessibility.js";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";
import { SEEDED_MEMBER_DEFECT_SEATS, SEEDED_MEMBER_EXPECTED_SEATS } from "./seeded-member-app.js";
import {
  buildSeededMemberAppMap,
  SEEDED_ADMIN_LANE_ID,
  SEEDED_MEMBER_ACCIDENTAL_STEP_ID,
  SEEDED_MEMBER_ACCIDENTAL_STEP_REMOVE,
  SEEDED_MEMBER_BROWSER_ENVIRONMENT,
  SEEDED_MEMBER_CAPTURE_TEST_ID,
  SEEDED_MEMBER_CAPTURE_LOOK_FOR,
  SEEDED_MEMBER_CHECK_STEP_ID,
  SEEDED_MEMBER_LANE_ID,
  SEEDED_MEMBER_SEATS_VARIABLE,
  SEEDED_MEMBER_TARGET_ID,
  SEEDED_MEMBER_TEST_ID,
  SEEDED_MEMBER_VIEWPORT,
  seededMemberCaptureConfigurations,
  seededMemberCaptureReviewTest,
  seededMemberGraphTest,
  seededMemberLane,
  seededMemberProfileId,
  seededMemberTargetProfile,
} from "./seeded-member-acceptance.js";

const memberFx = "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1";
const adminFx = "authfx:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:1";

test("removing the accidental organization step leaves the seats number-equals check", () => {
  const before = buildSeededMemberAppMap({
    memberFixtureReference: memberFx,
    adminFixtureReference: adminFx,
    includeAccidental: true,
  });
  assert.ok(
    before.tests[SEEDED_MEMBER_TEST_ID]?.steps.some(
      (step) => step.id === SEEDED_MEMBER_ACCIDENTAL_STEP_ID,
    ),
  );
  const after = editAppMapScenarioTest(
    before,
    SEEDED_MEMBER_TEST_ID,
    [SEEDED_MEMBER_ACCIDENTAL_STEP_REMOVE],
    {
      actorId: "human:test-runner",
      actorKind: "human",
      at: 20,
      eventId: "correct-accidental",
      expectedRevision: before.revision,
    },
  );
  const test = after.tests[SEEDED_MEMBER_TEST_ID];
  assert.ok(test);
  assert.equal(
    test.steps.some((step) => step.id === SEEDED_MEMBER_ACCIDENTAL_STEP_ID),
    false,
  );
  const check = test.steps.find((step) => step.id === SEEDED_MEMBER_CHECK_STEP_ID);
  assert.equal(check?.kind, "validation");
  if (check?.kind !== "validation" || check.binding.status !== "resolved") {
    throw new Error("expected resolved seats check");
  }
  assert.equal(check.binding.kind, "assertion");
  if (check.binding.kind !== "assertion") throw new Error("expected assertion binding");
  assert.deepEqual(check.binding.assertion, {
    kind: "content",
    input: SEEDED_MEMBER_SEATS_VARIABLE,
    expected: String(SEEDED_MEMBER_EXPECTED_SEATS),
    match: "number-equals",
  });
});

test("the Member dest-end Test compiles wait-for settings, extract, and unchanged number-equals 4", async () => {
  const draft = buildSeededMemberAppMap({
    memberFixtureReference: memberFx,
    adminFixtureReference: adminFx,
    includeAccidental: true,
  });
  const map = editAppMapScenarioTest(
    draft,
    SEEDED_MEMBER_TEST_ID,
    [SEEDED_MEMBER_ACCIDENTAL_STEP_REMOVE],
    {
      actorId: "human:test-runner",
      actorKind: "human",
      at: 20,
      eventId: "correct-accidental",
      expectedRevision: draft.revision,
    },
  );
  const compiled = compileAppMapTest(map, map.tests[SEEDED_MEMBER_TEST_ID]!);
  const steps = Object.values(compiled.graph).flatMap((recipe) => recipe.steps);
  assert.equal(
    steps.some((step) => step.kind === "wait-for" && step.target.label === "Settings"),
    true,
  );
  assert.equal(
    steps.some((step) => step.kind === "tap" && step.target.identifier === "open-settings"),
    true,
  );
  assert.equal(
    steps.some((step) => step.kind === "wait-for" && step.target.label === "Manage organization"),
    false,
  );
  assert.equal(
    steps.some((step) => step.kind === "wait-for" && step.target.identifier === "team-seats"),
    true,
  );
  assert.equal(
    steps.some(
      (step) =>
        step.kind === "extract" &&
        step.as === SEEDED_MEMBER_SEATS_VARIABLE &&
        step.target.identifier === "team-seats",
    ),
    true,
  );
  assert.equal(
    steps.some(
      (step) =>
        step.kind === "assert-content" &&
        step.input === SEEDED_MEMBER_SEATS_VARIABLE &&
        step.expected === String(SEEDED_MEMBER_EXPECTED_SEATS) &&
        step.match === "number-equals",
    ),
    true,
  );
  assert.ok(compiled.plan.destEndRecipeIds?.length);
  assert.equal(
    steps.some((step) => step.kind === "expect-screen" && step.screenId === "home"),
    false,
  );
  assert.equal(map.combines["seeded-member-acceptance"]?.selected?.account?.[0], "member");
  assert.equal(seededMemberProfileId("member"), "browser:seeded-member-app-900x600-member");
  assert.notEqual(seededMemberProfileId("admin"), seededMemberProfileId("member"));
  const withCapture = compileAppMapTest(map, {
    ...map.tests[SEEDED_MEMBER_TEST_ID]!,
    capture: { mode: "every-screen" },
  });
  const preflight = preflightCompiledAppMapTestOffline(
    withCapture.plan,
    await loadFrozenRawAccessibilityEvidence(withCapture.plan),
    { targetProfileId: seededMemberProfileId("member") },
  );
  assert.equal(
    preflight.summary.blockers,
    0,
    JSON.stringify(
      preflight.findings.filter((finding) => finding.severity === "blocker"),
      null,
      2,
    ),
  );
});

test("the same number-equals 4 check rejects the seeded Member defect and Admin seats", () => {
  assert.equal(
    contentAssertionPassed(String(SEEDED_MEMBER_DEFECT_SEATS), "4", "number-equals"),
    false,
  );
  assert.equal(contentAssertionPassed("99", "4", "number-equals"), false);
  assert.equal(contentAssertionPassed("4", "4", "number-equals"), true);
});

test("capture-for-review compiles without a judge or AI credentials", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const map = buildSeededMemberAppMap({
      memberFixtureReference: memberFx,
      adminFixtureReference: adminFx,
    });
    const test = seededMemberCaptureReviewTest();
    map.tests[SEEDED_MEMBER_CAPTURE_TEST_ID] = test;
    const compiled = compileAppMapTest(map, test);
    const screenshots = compiled.root.steps.filter((step) => step.kind === "screenshot");
    assert.equal(screenshots.length, 1);
    const screenshot = screenshots[0];
    assert.equal(screenshot?.kind, "screenshot");
    if (screenshot?.kind !== "screenshot") throw new Error("expected screenshot");
    assert.equal(screenshot.caption, "Member account settings");
    assert.deepEqual(screenshot.review, {
      mode: "later",
      lookFor: SEEDED_MEMBER_CAPTURE_LOOK_FOR,
    });
    assert.equal(
      compiled.root.steps.some(
        (step) => step.kind === "evaluate-visual" || step.kind === "evaluate-semantic",
      ),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("eight capture configurations are labeled by account, viewport, and language", () => {
  const cells = seededMemberCaptureConfigurations();
  assert.equal(cells.length, 8);
  assert.equal(new Set(cells.map((cell) => cell.caption)).size, 8);
  assert.equal(
    cells.some(
      (cell) => cell.role === "admin" && cell.viewport.id === "compact" && cell.locale.id === "ar",
    ),
    true,
  );
  assert.equal(
    cells.every((cell) => cell.lookFor === SEEDED_MEMBER_CAPTURE_LOOK_FOR),
    true,
  );
});

test("HTTP Test payload omits persistence fields and Lane maps a saved fixture", () => {
  const payload = seededMemberGraphTest({ includeAccidental: true });
  assert.equal("id" in payload, false);
  assert.equal("organizationId" in payload, false);
  assert.ok(payload.steps.some((step) => step.id === SEEDED_MEMBER_ACCIDENTAL_STEP_ID));
  const member = seededMemberLane({
    role: "member",
    fixture: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 1, reference: memberFx },
  });
  assert.equal(member.id, SEEDED_MEMBER_LANE_ID);
  assert.equal(member.targetProfileId, seededMemberProfileId("member"));
  assert.equal(member.account?.kind, "fixture");
  if (member.account?.kind !== "fixture") throw new Error("expected fixture Lane");
  assert.equal(member.account.accountId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(member.account.accountRevision, "1");
  assert.equal(member.account.reference, memberFx);
  assert.equal(
    seededMemberLane({
      role: "admin",
      fixture: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", revision: 2, reference: adminFx },
    }).id,
    SEEDED_ADMIN_LANE_ID,
  );
});

test("Member unique profile matches the unsigned saved environment except the fixture", () => {
  const frozen = seededMemberTargetProfile({ role: "member", fixtureReference: memberFx });
  const unsigned = {
    id: frozen.id,
    targetId: SEEDED_MEMBER_TARGET_ID,
    platform: "browser" as const,
    viewport: { ...SEEDED_MEMBER_VIEWPORT },
    browserCaseProfile: compileBrowserEnvironment(SEEDED_MEMBER_BROWSER_ENVIRONMENT),
  };
  assert.equal(
    sameAppMapRuntimeTargetProfileIgnoringAccount(
      appMapRuntimeTargetProfileFromSaved(frozen),
      unsigned,
    ),
    true,
  );
  assert.equal(frozen.browserCaseProfile?.authenticationFixtureId, memberFx);
  assert.equal(unsigned.browserCaseProfile.authenticationFixtureId, undefined);
});
