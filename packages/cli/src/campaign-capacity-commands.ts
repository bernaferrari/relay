import {
  commandPath as path,
  mappedOperation as mapped,
  type CliOperationDescriptor,
} from "./command-descriptors.js";

/** Campaign timing/admission commands are kept beside their shared protocol
 * contract rather than inflating the primary CLI registry. */
export const campaignCapacityCommandDescriptors: readonly CliOperationDescriptor[] = [
  mapped(
    "campaign.capacity.preflight",
    path("campaign capacity preflight", [], undefined, {
      summary: "Read-only preflight for a local Android and iOS campaign",
      inputHelp: [
        {
          name: "targets",
          type: "array",
          required: true,
          description: "Explicit target IDs and platforms to consider",
        },
        {
          name: "workItems",
          type: "number",
          required: true,
          description: "Total work items in the campaign",
        },
        {
          name: "workItemsByPlatform",
          type: "object",
          required: true,
          description: "Required Android and iOS partition of the campaign",
        },
        {
          name: "duration",
          type: "object",
          required: true,
          description: "Measured or supplied per-work-item duration and provenance",
        },
        {
          name: "deadlineMs",
          type: "number",
          required: true,
          description: "Campaign deadline in milliseconds",
        },
      ],
      note: "This only reports currently usable local capacity; it never takes a lease or queues a job.",
      examples: [
        'relay campaign capacity preflight --input \'{"targets":[{"targetId":"android-1","platform":"android"},{"targetId":"ios-1","platform":"ios"}],"workItems":40,"workItemsByPlatform":{"android":20,"ios":20},"duration":{"workItemDurationMs":6000,"provenance":"supplied"},"deadlineMs":180000}\'',
      ],
    }),
  ),
  mapped(
    "campaign.duration.cohorts.estimate",
    path("campaign duration cohorts estimate", [], undefined, {
      summary: "Read immutable target × Test/action timing evidence for local deadline admission",
      inputHelp: [
        {
          name: "cohorts",
          type: "array",
          required: true,
          description:
            "Explicit [{targetId, platform, testId, action}] cohorts; platform-wide timing is never returned as admission evidence",
        },
        {
          name: "maxAgeMs",
          type: "number",
          required: true,
          description: "Maximum accepted observation age, subject to Relay's conservative ceiling",
        },
        {
          name: "percentile",
          type: "p50 | p95",
          description: "Observed percentile to materialize as durationEvidence (defaults to p95)",
        },
      ],
      note: "This only reads persisted successful runs in the current project. An absent evidence field is intentional: admission must fail closed until enough compatible samples exist.",
    }),
  ),
  mapped(
    "campaign.local-admission.preflight",
    path("campaign local-admission preflight", [], undefined, {
      summary: "Check exact target-affine local campaign capacity without taking leases",
      inputHelp: [
        {
          name: "workItems",
          type: "array",
          required: true,
          description:
            "Explicit local-device work items [{id,target,testId,action}] for the selected campaign cells",
        },
        {
          name: "request",
          type: "object",
          required: true,
          description:
            "LocalCampaignAdmissionRequest with fresh Relay-derived durationEvidence for every target × Test/action cohort",
        },
      ],
      note: "Returns the aggregate capacity report and each concrete target critical path, including the immutable evidence used. It never leases or queues a device.",
    }),
  ),
];
