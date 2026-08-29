import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

/** The durable Proof lifecycle exposed to agents and human operators. */
export const proofCommandDescriptors: readonly MappedOperationDescriptor[] = [
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
      note: "Continue is CAS-bound to expectedVersion. revise-plan requires exact replacement builds and selection. Live execution normally uses relay verify-change --base; record-runs accepts only durable Run IDs and never a client verdict.",
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
