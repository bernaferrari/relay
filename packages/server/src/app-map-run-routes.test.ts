import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledRuntimeTargetProfile } from "@relay/protocol";
import {
  frozenEvidenceTargetProfileForTarget,
  offlinePreflightProfileRecovery,
} from "./app-map-run-routes.js";
import { HttpError } from "./http.js";

const pixelEn: AppMapCompiledRuntimeTargetProfile = {
  id: "pixel-en",
  targetId: "pixel-1",
  platform: "android",
};
const pixelIt: AppMapCompiledRuntimeTargetProfile = {
  id: "pixel-it",
  targetId: "pixel-1",
  platform: "android",
};
const ipadEn: AppMapCompiledRuntimeTargetProfile = {
  id: "ipad-en",
  targetId: "ipad-1",
  platform: "ios",
};
const pixel = { targetId: "pixel-1", platform: "android" } as const;

test("the offline-preflight path inherits the only saved profile for the target", () => {
  const resolved = frozenEvidenceTargetProfileForTarget({
    target: { ...pixel },
    profiles: [pixelEn, ipadEn],
  });
  assert.deepEqual(resolved, pixelEn);
});

test("several matching saved profiles fail with the candidate ids in the recovery", () => {
  assert.throws(
    () => frozenEvidenceTargetProfileForTarget({ target: { ...pixel }, profiles: [pixelEn, pixelIt] }),
    (error: unknown) => {
      if (!(error instanceof HttpError) || error.status !== 409) return false;
      const body = error.body as {
        code?: string;
        targetProfileCandidates?: unknown[];
        recovery?: string;
      };
      return (
        body.code === "TARGET_PROFILE_SELECTION_REQUIRED" &&
        body.targetProfileCandidates?.length === 2 &&
        body.recovery ===
          "Bind an explicit saved targetProfileId for android:pixel-1: pixel-en, pixel-it."
      );
    },
  );
});

test("a target with only foreign saved profiles fails with capture guidance", () => {
  assert.throws(
    () => frozenEvidenceTargetProfileForTarget({ target: { ...pixel }, profiles: [ipadEn] }),
    (error: unknown) => {
      if (!(error instanceof HttpError) || error.status !== 409) return false;
      const body = error.body as { code?: string; recovery?: string };
      return (
        body.code === "TARGET_PROFILE_TARGET_MISMATCH" &&
        body.recovery ===
          "No saved runtime profile for target android:pixel-1 — capture a screen on this target first."
      );
    },
  );
});

test("a map with no saved profiles yet leaves the run to lenient preflight", () => {
  assert.equal(
    frozenEvidenceTargetProfileForTarget({ target: { ...pixel }, profiles: undefined }),
    undefined,
  );
});

test("offline preflight recovery names the inherited profile", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: pixelEn,
      explicit: false,
      candidates: ["pixel-en"],
      target: { ...pixel },
    }),
    "Relay inherited the only saved runtime profile for android:pixel-1: pixel-en. Review its frozen evidence findings, then retry this exact Test revision.",
  );
});

test("offline preflight recovery keeps the explicit-selection wording for an explicit profile", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: pixelEn,
      explicit: true,
      candidates: ["pixel-en", "pixel-it"],
      target: { ...pixel },
    }),
    "Review the frozen evidence findings, select or recapture the required profile, then retry this exact Test revision.",
  );
});

test("offline preflight recovery without a profile lists bindable ids", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: undefined,
      explicit: false,
      candidates: ["pixel-en", "pixel-it"],
      target: { ...pixel },
    }),
    "Bind an explicit saved targetProfileId for android:pixel-1: pixel-en, pixel-it, then retry this exact Test revision.",
  );
});

test("offline preflight recovery without any saved profile asks for a capture", () => {
  assert.equal(
    offlinePreflightProfileRecovery({
      runtimeTargetProfile: undefined,
      explicit: false,
      candidates: [],
      target: { ...pixel },
    }),
    "No saved runtime profile for target android:pixel-1 — capture a screen on this target first.",
  );
});
