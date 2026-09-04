import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

/** The durable Proof lifecycle exposed to agents and human operators. */
export const proofCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped(
    "proof.setup.inspect",
    path("proof setup inspect", [], undefined, {
      summary: "Discover Proof build, artifact, Test, and target candidates",
      inputHelp: [
        {
          name: "baseRef",
          type: "git ref",
          description: "Optional explicit comparison ref when the repository has no default",
        },
      ],
      examples: ["relay proof setup inspect --json"],
      note: "Discovery is advisory. Relay never turns a candidate command, artifact, Test, or target into reviewed policy.",
    }),
  ),
  mapped(
    "proof.setup.preview",
    path("proof setup preview", [], undefined, {
      summary: "Run an explicit local build and preview exact Proof policy",
      inputHelp: [
        {
          name: "build",
          type: "object",
          required: true,
          description:
            "Explicit build id/name/platform, executable+args, repository-relative artifact, configuration, environment revision, and immutable deployment identity for web",
        },
        {
          name: "associations",
          type: "array",
          required: true,
          description: "Explicit reviewed Test-to-change signal associations",
        },
        {
          name: "targetCases",
          type: "array",
          required: true,
          description: "Explicit frozen required/advisory execution targets",
        },
      ],
      examples: ["relay proof setup preview --input-file ./proof-setup.json --json"],
      note: "Runs only the supplied executable and arguments. It hashes the resulting artifact and returns the complete .relay/change-proof.json preview without registering or writing anything.",
    }),
  ),
  mapped(
    "proof.setup.apply",
    path("proof setup apply", [], undefined, {
      summary: "Register and write a reviewed exact Proof setup preview",
      inputHelp: [
        {
          name: "preview fields",
          type: "object",
          required: true,
          description: "The unchanged top-level output from proof setup preview",
        },
        {
          name: "confirm",
          type: "true",
          required: true,
          description: "Explicit review confirmation; set by --confirm",
        },
      ],
      examples: [
        "relay proof setup apply --confirm --input-file ./reviewed-proof-setup-preview.json --json",
      ],
      note: "Fails if Git, artifact bytes, or existing policy changed after preview. On success it registers the exact ready build, atomically writes policy, and compiles the canonical Verification Plan.",
    }),
  ),
  mapped(
    "proof.prepare",
    path("proof prepare", [], undefined, {
      summary: "Prepare a reviewable Proof from the current repository change",
      inputHelp: [
        {
          name: "baseRef",
          type: "git ref",
          description: "Optional reviewed comparison ref when the workspace has no default",
        },
        {
          name: "pullRequest",
          type: "positive integer",
          description: "Optional pull request number to bind to the exact tested revision",
        },
        {
          name: "agentClaim",
          type: "object",
          description:
            "Optional completion summary and acceptance criteria supplied by the requester",
        },
        {
          name: "targetIds",
          type: "array",
          description: "Optional subset of repository-reviewed target identities",
        },
        {
          name: "buildIds",
          type: "array",
          description: "Optional subset of repository-reviewed build identities",
        },
      ],
      examples: [
        "relay proof prepare --json",
        'relay proof prepare --input \'{"baseRef":"origin/main","targetIds":["emulator-5554"]}\' --json',
      ],
      note: "The server resolves Git, reviewed journey mappings, registered builds, App Map revisions, and Verification Cells. Callers cannot supply a head SHA, cells, or a verdict.",
    }),
    path("prove", [], undefined, {
      summary: "Prepare or resume the current repository change Proof",
      inputHelp: [
        {
          name: "baseRef",
          type: "git ref",
          description: "Optional reviewed comparison ref when the workspace has no default",
        },
      ],
      examples: ["relay prove --json", 'relay prove --input \'{"baseRef":"origin/main"}\' --json'],
      note: "Returns the exact Proof and next required action. Use relay prove <proof-id> to run an approved Proof.",
    }),
  ),
  mapped(
    "proof.start",
    path("proof start", [], undefined, {
      summary: "Start a durable Proof from an exact change and policy",
      inputHelp: [
        {
          name: "change",
          type: "object",
          required: true,
          description: "Repository, baseSha, headSha, and optional pull request or agent claim",
        },
        {
          name: "builds",
          type: "array",
          description: "Optional builds frozen to the exact change headSha",
        },
        {
          name: "selection",
          type: "object",
          description: "Affected journeys and target cases in the Verification Plan",
        },
        {
          name: "policy",
          type: "object",
          required: true,
          description: "Policy id and positive policy version",
        },
        {
          name: "coverageGaps",
          type: "array",
          description: "Known coverage gaps to retain on the Proof",
        },
        {
          name: "residualRisk",
          type: "array",
          description: "Known residual risks to retain on the Proof",
        },
        {
          name: "smallestNextVerification",
          type: "object",
          description: "Smallest next Verification Plan step, when one is known",
        },
      ],
      examples: [
        "relay proof start --input-file ./proof.json --json",
        'relay proof start --input \'{"change":{"repository":"acme/relay","baseSha":"<40-char-sha>","headSha":"<40-char-sha>"},"policy":{"id":"relay.default","version":1}}\'',
      ],
      note: "The JSON object is validated by the canonical Proof input contract. Use --input-file for a reviewed, strict JSON document; organization, project, and actor provenance come from the CLI connection.",
    }),
  ),
  mapped(
    "proof.list",
    path("proof list", [], undefined, {
      summary: "List durable Proofs in the current project",
      inputHelp: [
        {
          name: "state",
          type: "Proof state",
          description: "Optional state filter, such as planning, ready, proved, or cancelled",
        },
        {
          name: "limit",
          type: "integer (1-100)",
          description: "Optional maximum number of Proofs to return",
        },
      ],
      examples: ["relay proof list --json", 'relay proof list --input \'{"state":"ready"}\''],
    }),
  ),
  mapped(
    "proof.inspect",
    path("proof inspect", ["proofId"], undefined, {
      summary: "Inspect one durable Proof",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "includeHistory",
          type: "boolean",
          description: "Include immutable prior Proof versions; set by --history",
        },
      ],
      examples: [
        "relay proof inspect <proof-id> --json",
        "relay proof inspect <proof-id> --history --json",
      ],
      note: "Read-only. --history returns the bounded immutable version history alongside the current Proof.",
    }),
  ),
  mapped(
    "proof.plan.approve",
    path("proof approve-plan", ["proofId"], undefined, {
      summary: "Approve a Proof Verification Plan",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          required: true,
          description: "Current Proof version for optimistic concurrency",
        },
        {
          name: "decisionId",
          type: "string",
          required: true,
          description: "Stable approval decision identifier",
        },
        {
          name: "reason",
          type: "string",
          required: true,
          description: "Human-readable approval reason",
        },
        {
          name: "confirm",
          type: "true",
          required: true,
          description: "Explicit operator confirmation; set by --confirm",
        },
      ],
      examples: [
        'relay proof approve-plan <proof-id> --confirm --input \'{"expectedVersion":1,"decisionId":"review-1","reason":"Reviewed the frozen plan."}\'',
      ],
      note: "Requires --confirm. Approval is an explicit operator action and is CAS-bound to expectedVersion.",
    }),
  ),
  mapped(
    "proof.run",
    path("prove", ["proofId"], undefined, {
      summary: "Run or resume one approved Proof",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          description: "Optional current Proof version for optimistic concurrency",
        },
        {
          name: "wait",
          type: "boolean",
          description: "Wait for the coordinator to reach a terminal outcome",
        },
      ],
      examples: ["relay prove <proof-id> --json", "relay prove <proof-id> --wait --json"],
      note: "One server-owned operation selects, runs, resumes, and records the required cases. Reopening Relay or disconnecting this CLI does not lose execution progress.",
    }),
    path("proof run", ["proofId"], undefined, {
      summary: "Run or resume one approved Proof",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          description: "Optional current Proof version for optimistic concurrency",
        },
        {
          name: "wait",
          type: "boolean",
          description: "Wait for the coordinator to reach a terminal outcome",
        },
      ],
      examples: ["relay proof run <proof-id> --wait --json"],
      note: "Alias of relay prove. The server owns the durable execution loop.",
    }),
  ),
  mapped(
    "proof.run.confirm",
    path("proof confirm-cell", ["proofId"], undefined, {
      summary: "Issue a durable receipt for one Proof Cell",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          required: true,
          description: "Current approved Proof version",
        },
        {
          name: "cellId",
          type: "string",
          required: true,
          description: "Exact guarded or destructive Verification Cell",
        },
        {
          name: "previewDigest",
          type: "sha256 digest",
          required: true,
          description: "Digest returned by proof.inspect executionPreview",
        },
        {
          name: "fixtureScope",
          type: "object",
          description:
            "Required for destructive cells: targetCaseId, targetProfileId, cleanupCheckIds",
        },
      ],
      examples: [
        'relay proof confirm-cell <proof-id> --confirm --input \'{"expectedVersion":2,"cellId":"…","previewDigest":"sha256:…"}\'',
      ],
      note: "Requires --confirm and a human actor. The server persists the exact preview, actor, scope, action, and expiry before returning the receipt.",
    }),
  ),
  mapped(
    "proof.run.human-evidence",
    path("proof resume-human", ["proofId"], undefined, {
      summary: "Record exact human-step evidence and resume a Proof",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "executionId",
          type: "string",
          required: true,
          description: "Exact paused execution identity from proof.inspect",
        },
        {
          name: "cellId",
          type: "string",
          required: true,
          description: "Exact paused Verification Cell identity",
        },
        {
          name: "stepId",
          type: "string",
          required: true,
          description: "Exact human-only step identity",
        },
        {
          name: "attachment",
          type: "object",
          required: true,
          description:
            "Server-persisted evidence attachment: kind, encoding (base64 or utf8), data, and capturedAt",
        },
        {
          name: "evidenceDigest",
          type: "sha256 digest",
          description:
            "Backward-compatible digest for an evidence object persisted by another adapter",
        },
        {
          name: "wait",
          type: "boolean",
          description: "Wait for resumed execution to reach a terminal outcome",
        },
      ],
      examples: [
        'relay proof resume-human <proof-id> --confirm --input \'{"executionId":"proof-execution:…","cellId":"…","stepId":"…","attachment":{"kind":"snapshot","encoding":"utf8","data":"{\\"reviewed\\":true}","capturedAt":1700000000000}}\'',
      ],
      note: "Requires --confirm and a human actor. The server persists and hashes the attachment, binds it to the exact paused execution, then resumes target control. Legacy evidenceDigest input remains accepted for compatibility.",
    }),
  ),
  mapped(
    "proof.continue",
    path("proof continue", ["proofId"], undefined, {
      summary: "Continue a Proof with the next plan action",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          required: true,
          description: "Current Proof version for optimistic concurrency",
        },
        {
          name: "action",
          type: "revise-plan | request-plan-review | return-to-planning | start-pilot | start-required-coverage | record-runs",
          required: true,
          description: "Next Verification Plan action",
        },
        {
          name: "builds",
          type: "array",
          description: "Replacement builds required by revise-plan",
        },
        {
          name: "selection",
          type: "object",
          description: "Replacement affected journeys and target cases required by revise-plan",
        },
        {
          name: "coverageGaps",
          type: "array",
          description: "Updated coverage gaps for revise-plan",
        },
        {
          name: "residualRisk",
          type: "array",
          description: "Updated residual risks for revise-plan",
        },
        {
          name: "smallestNextVerification",
          type: "object",
          description: "Updated smallest next Verification Plan step",
        },
        {
          name: "reason",
          type: "string",
          description:
            "Required reason for review, return-to-planning, pilot, and expansion actions",
        },
        {
          name: "runIds",
          type: "array",
          description:
            "Persisted Relay Run IDs for record-runs; the server derives every outcome from their verified TracePacks",
        },
      ],
      examples: [
        'relay proof continue <proof-id> --input \'{"expectedVersion":2,"action":"request-plan-review","reason":"A new affected journey needs review."}\'',
      ],
      note: "Continue is CAS-bound to expectedVersion. revise-plan requires exact replacement builds and selection. Live execution normally uses relay prove --base; record-runs accepts only durable Run IDs and never a client verdict.",
    }),
  ),
  mapped(
    "proof.cancel",
    path("proof cancel", ["proofId"], undefined, {
      summary: "Cancel a durable Proof",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          required: true,
          description: "Current Proof version for optimistic concurrency",
        },
        {
          name: "reason",
          type: "string",
          required: true,
          description: "Auditable cancellation reason",
        },
        {
          name: "confirm",
          type: "true",
          required: true,
          description: "Explicit operator confirmation; set by --confirm",
        },
      ],
      examples: [
        'relay proof cancel <proof-id> --confirm --input \'{"expectedVersion":2,"reason":"The pull request was closed."}\'',
      ],
      note: "Requires --confirm. Cancellation is CAS-bound to expectedVersion and leaves an auditable receipt.",
    }),
  ),
  mapped(
    "proof.publication.retry",
    path("proof retry-merge-check", ["proofId", "publicationId"], undefined, {
      summary: "Retry one exhausted merge check for an exact Proof revision",
      argumentHelp: [
        { name: "proofId", type: "string", description: "Proof identifier" },
        {
          name: "publicationId",
          type: "string",
          description: "Exact publication intent shown by proof inspect",
        },
      ],
      inputHelp: [
        {
          name: "expectedProofVersion",
          type: "positive integer",
          required: true,
          description: "Immutable Proof version bound to the merge check",
        },
        {
          name: "reason",
          type: "string",
          required: true,
          description: "Auditable reason for retrying provider delivery",
        },
        {
          name: "confirm",
          type: "true",
          required: true,
          description: "Explicit operator confirmation; set by --confirm",
        },
      ],
      examples: [
        'relay proof retry-merge-check <proof-id> <publication-id> --confirm --input \'{"expectedProofVersion":5,"reason":"GitHub connectivity is restored."}\'',
      ],
      note: "Relay preserves the original head, check identity, Proof version, receipts, and prior attempt history. It grants exactly one additional delivery attempt.",
    }),
  ),
  mapped(
    "proof.rerun-affected",
    path("proof rerun-affected", ["proofId"], undefined, {
      summary: "Create a replacement Proof for affected coverage",
      argumentHelp: [{ name: "proofId", type: "string", description: "Proof identifier" }],
      inputHelp: [
        {
          name: "expectedVersion",
          type: "positive integer",
          required: true,
          description: "Current Proof version for optimistic concurrency",
        },
        {
          name: "change",
          type: "object",
          required: true,
          description: "Exact repository change to verify again",
        },
        {
          name: "builds",
          type: "array",
          description: "Optional replacement builds frozen to the change headSha",
        },
        {
          name: "selection",
          type: "object",
          description: "Optional replacement Verification Plan selection",
        },
        {
          name: "policy",
          type: "object",
          description: "Optional replacement policy; defaults to the prior Proof policy",
        },
        {
          name: "coverageGaps",
          type: "array",
          description: "Optional replacement coverage gaps",
        },
        {
          name: "residualRisk",
          type: "array",
          description: "Optional replacement residual risks",
        },
        {
          name: "smallestNextVerification",
          type: "object",
          description: "Optional replacement smallest next Verification Plan step",
        },
      ],
      examples: [
        "relay proof rerun-affected <proof-id> --input-file ./replacement-proof.json --json",
      ],
      note: "Creates a new Proof superseding the prior one and preserves the exact prior/replacement relationship.",
    }),
  ),
];
