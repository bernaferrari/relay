import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChangeVerification } from "@relay/protocol";
import { proofDisplayTitle } from "./proof-presentation";

function proof(input: Partial<ChangeVerification["change"]> = {}): ChangeVerification {
  return {
    change: {
      repository: "acme/relay",
      baseSha: "1".repeat(40),
      headSha: "2".repeat(40),
      ...input,
    },
    selection: {
      affectedJourneys: [
        {
          appMapId: "settings",
          testId: "settings-language-arabic",
          appMapRevision: 1,
          reason: "Changed localization resources.",
          confidence: "definite",
        },
      ],
      targetCases: [],
    },
  } as unknown as ChangeVerification;
}

describe("proofDisplayTitle", () => {
  test("prefers the human claim", () => {
    assert.equal(
      proofDisplayTitle(
        proof({ agentClaim: { summary: "Fix Arabic settings", acceptanceCriteria: [] } }),
      ),
      "Fix Arabic settings",
    );
  });

  test("uses the pull request before technical identity", () => {
    assert.equal(proofDisplayTitle(proof({ pullRequest: 184 })), "Pull request #184");
  });

  test("uses the affected journey instead of exposing a repository or hash", () => {
    assert.equal(proofDisplayTitle(proof()), "Settings language arabic");
  });
});
