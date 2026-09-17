/** Workbook policy; coverage remains tied to explicit evidence. */
import { type ExecutionQueue } from "./execution-queue.js";
import {
  WORKBOOK_SURVIVAL_FAMILY_ID,
  WORKBOOK_SURVIVAL_PACKETS,
  WORKBOOK_AUTH_FAMILY_ID,
  WORKBOOK_SHELL_FAMILY_ID,
  WORKBOOK_COMPOSER_FAMILY_ID,
  WORKBOOK_AUTO_FAMILY_ID,
  WORKBOOK_CHROME_FAMILY_ID,
  WORKBOOK_TOOLS_FAMILY_ID,
  WORKBOOK_HEAVY_FAMILY_ID,
  WORKBOOK_IMAGE_FAMILY_ID,
  WORKBOOK_IMAGE_SEARCH_FAMILY_ID,
  WORKBOOK_HISTORY_FAMILY_ID,
  WORKBOOK_UPLOAD_ANALYSIS_ORIGINAL_ID,
  WORKBOOK_MODELS_FAMILY_ID,
  WORKBOOK_OUTPUT_FAMILY_ID,
  WORKBOOK_MATH_ORIGINAL_ID,
  WORKBOOK_DOWNLOAD_ORIGINAL_ID,
  type WorkbookEvidencePacket,
  WORKBOOK_EVIDENCE_PACKET_LABELS,
  requiredEvidenceNeededKinds,
  WORKBOOK_RC23_APP_MAP_IDS,
  RC23_WORKBOOK_DEST_END_BINDINGS,
  destEndViewPacketMayLeftoverSkip,
  rc23WorkbookBoundOriginalIds,
  rc23WorkbookNonBindingOriginalIds,
  rc23WorkbookBindingSlotId,
  rc23DestEndSatisfiesOriginal,
  type WorkbookOriginal,
} from "./workbook-coverage-obligations.js";

const SURVIVAL_PACKET = new Set<string>(WORKBOOK_SURVIVAL_PACKETS);

export function suggestedExecutionQueueForOriginal(input: {
  id: number;
  family: string;
  evidencePacket: WorkbookEvidencePacket;
}): ExecutionQueue {
  if (
    input.family === WORKBOOK_SURVIVAL_FAMILY_ID ||
    input.family === WORKBOOK_AUTH_FAMILY_ID ||
    input.family === "S15"
  ) {
    return "stateful-survival";
  }
  if (input.evidencePacket === "persistence" || input.id === 21) return "stateful-survival";
  if (
    input.evidencePacket === "generated-output" ||
    input.evidencePacket === "screenshot-receipt" ||
    input.evidencePacket === "sequence"
  ) {
    return "live-output";
  }
  if (
    input.family === WORKBOOK_AUTO_FAMILY_ID ||
    input.family === WORKBOOK_CHROME_FAMILY_ID ||
    input.family === WORKBOOK_TOOLS_FAMILY_ID ||
    input.family === WORKBOOK_HEAVY_FAMILY_ID ||
    input.family === WORKBOOK_IMAGE_FAMILY_ID ||
    input.family === WORKBOOK_IMAGE_SEARCH_FAMILY_ID ||
    input.family === "S17"
  )
    return "live-output";
  return "fast-ui";
}

export function workbookRc23BindingError(
  originals: readonly Pick<WorkbookOriginal, "id" | "status" | "evidencePacket" | "bindings">[],
): string | undefined {
  const expected = rc23WorkbookBoundOriginalIds();
  const boundIds = originals
    .filter((item) => item.status === "bound")
    .map((item) => item.id)
    .sort((left, right) => left - right);
  if (boundIds.join() !== expected.join()) {
    return `bound original ids must be ${expected.join(", ")} (RC-23 dest-end view packets), not ${boundIds.join(", ") || "none"}`;
  }
  const forbidden = new Set(rc23WorkbookNonBindingOriginalIds());
  for (const original of originals) {
    if (original.status !== "bound") continue;
    if (forbidden.has(original.id)) {
      return `original ${original.id} cannot bind an RC-23 dest-end that does not execute its causal action`;
    }
    const row = RC23_WORKBOOK_DEST_END_BINDINGS.find((item) => item.originalId === original.id);
    if (!row) return `original ${original.id} has no RC-23 dest-end binding`;
    if (original.evidencePacket !== row.evidencePacket) {
      return `original ${original.id} packet must stay ${row.evidencePacket} for the dest-end binding`;
    }
    const platforms = new Set(row.platforms);
    if (original.bindings.length !== row.platforms.length) {
      return `original ${original.id} needs one dest-end binding per platform`;
    }
    for (const binding of original.bindings) {
      if (!binding.slotId || !binding.checkpointId || !binding.platform) {
        return `original ${original.id} obligations must be plannedSlots identities, not captions`;
      }
      if (binding.checkpointId !== row.checkpointId) {
        return `original ${original.id} cannot bind checkpoint ${binding.checkpointId}`;
      }
      if (!platforms.has(binding.platform)) {
        return `original ${original.id} cannot bind platform ${binding.platform}`;
      }
      if (!rc23DestEndSatisfiesOriginal(binding.checkpointId, original.id, binding.platform)) {
        return `original ${original.id} dest-end does not execute that causal action`;
      }
      const expectedSlot = rc23WorkbookBindingSlotId(binding.checkpointId, binding.platform);
      if (binding.slotId !== expectedSlot) {
        return `original ${original.id} slotId must be ${expectedSlot}, not a caption`;
      }
      if (binding.appMapId !== WORKBOOK_RC23_APP_MAP_IDS[binding.platform]) {
        return `original ${original.id} appMapId must match ${binding.platform}`;
      }
    }
  }
  return undefined;
}

export function workbookEvidencePolicyError(
  original: Pick<
    WorkbookOriginal,
    | "id"
    | "family"
    | "evidencePacket"
    | "suggestedExecutionQueue"
    | "status"
    | "exclusion"
    | "criteria"
    | "requirementAction"
    | "evidenceNeeded"
  >,
): string | undefined {
  const label = `original ${original.id}`;
  if (!original.criteria.trim())
    return `${label} must keep criteria text even when not auto-asserted`;
  if (original.status === "excluded" && !original.exclusion) {
    return `${label} excluded original needs packet+exclusion`;
  }
  if (original.family === WORKBOOK_SURVIVAL_FAMILY_ID) {
    if (!SURVIVAL_PACKET.has(original.evidencePacket)) {
      return `${label} S16 cannot be ${WORKBOOK_EVIDENCE_PACKET_LABELS[original.evidencePacket]} Fast UI`;
    }
    if (original.suggestedExecutionQueue !== "stateful-survival") {
      return `${label} S16 cannot be single-view Fast UI`;
    }
  }
  if (
    original.id === WORKBOOK_DOWNLOAD_ORIGINAL_ID &&
    original.evidencePacket !== "screenshot-receipt"
  ) {
    return `${label} S11 download needs screenshot+receipt`;
  }
  if (
    original.family === WORKBOOK_OUTPUT_FAMILY_ID &&
    original.evidencePacket !== "generated-output"
  ) {
    return original.id === WORKBOOK_MATH_ORIGINAL_ID
      ? `${label} S08 math stays generated-output for human review`
      : `${label} S08 stays generated-output for human review`;
  }
  if (
    original.evidencePacket === "generated-output" &&
    original.suggestedExecutionQueue === "fast-ui"
  ) {
    return `${label} generated-output cannot suggest Fast UI`;
  }
  if (
    original.evidencePacket === "persistence" &&
    original.suggestedExecutionQueue !== "stateful-survival"
  ) {
    return `${label} before/restart/after must suggest stateful-survival`;
  }
  const expected = suggestedExecutionQueueForOriginal(original);
  if (original.suggestedExecutionQueue !== expected) {
    return `${label} suggestedExecutionQueue must be ${expected} for packet ${original.evidencePacket}`;
  }
  const needed = workbookEvidenceNeededError(original);
  if (needed) return needed;
  return undefined;
}

export function workbookEvidenceNeededError(
  original: Pick<
    WorkbookOriginal,
    "id" | "family" | "evidencePacket" | "requirementAction" | "evidenceNeeded"
  >,
): string | undefined {
  const label = `original ${original.id}`;
  if (original.family === WORKBOOK_SHELL_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S02 must be test-action — leftover dest skip is not open+close, logo from destinations, or New Chat`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S02 needs explicit evidence-needed (before/after, receipt, sequence)`;
    }
  }
  if (original.family === WORKBOOK_MODELS_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S05 must be test-action — leftover Fast-checked / inspect-only sheet is not Switch model or presets`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S05 needs explicit evidence-needed (before/after, receipt)`;
    }
  }
  if (original.family === WORKBOOK_OUTPUT_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S08 must be test-action — leftover conversation / extract-contains-15 is not generated-output coverage`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S08 needs explicit evidence-needed (generated output at a declared phase)`;
    }
    const outputKinds = new Set(original.evidenceNeeded.map((item) => item.kind));
    if (!outputKinds.has("receipt")) {
      return `${label} S08 needs a send TAP receipt — leftover 3*5 thread is not this original`;
    }
    if (!outputKinds.has("after")) {
      return `${label} S08 generated-output needs after evidence — no arithmetic/Markdown judge`;
    }
  }
  if (original.family === WORKBOOK_AUTH_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S01 must be test-action — leftover Cloudflare / weekly pause / grok-lab signed-in is not Sign Out, Continue with X, or Sign Up`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S01 needs explicit evidence-needed (isolated auth before/after, receipt, sequence)`;
    }
  }
  if (original.family === WORKBOOK_COMPOSER_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S03 must be test-action — leftover composer-focus inspect / send-hello paywall / multiline extract-15 is not type+send, expand, or typeahead persistence`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S03 needs explicit evidence-needed (send TAP, expanded composer view, typeahead persistence)`;
    }
  }
  if (original.family === WORKBOOK_AUTO_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S06 must be test-action — leftover Fast-checked / inspect-only model sheet / SuperGrok pricing TAP is not Auto Fast/Expert routing`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S06 needs explicit evidence-needed (Auto prompt TAP, Think harder / Quick answer routing)`;
    }
  }
  if (original.family === WORKBOOK_CHROME_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S07 must be test-action — leftover 3*5 toolbar expect-set / dest-end toolbar-existing / share clipboard-denied is not Response toolbar, follow-up chips, autoscroll, or Share`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S07 needs explicit evidence-needed (toolbar TAP, chip TAP, autoscroll sequence, share receipt)`;
    }
  }
  if (original.family === WORKBOOK_TOOLS_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S09 must be test-action — leftover 3*5 extract-15 / YAML sources/news unrecorded / plugins overlay / inspect-only Expert sheet is not Sources rail, Slack tools, or Latest news`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S09 needs explicit evidence-needed (sources-rail TAP, thinking-trace sequence, Latest news TAP)`;
    }
  }
  if (original.family === WORKBOOK_HEAVY_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S10 must be test-action — leftover 3*5 extract-15 / YAML sources/news unrecorded / inspect-only Expert or Heavy sheet / plugins overlay / finance dest-end / S09 single-agent Slack/news is not Heavy agents, Heavy Latest news, or Heavy investment`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S10 needs explicit evidence-needed (Heavy tool+web TAP, Agents-working sequence, Heavy Latest news TAP, Heavy investment TAP)`;
    }
  }
  if (original.family === WORKBOOK_IMAGE_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S11 must be test-action — leftover Imagine dest-end / iOS Imagine Unbound / UNRECORDED Heavy 5-image / logged-out Imagine judged is not image gen download, Make Video, five-image edit, Draw a puppy, or Draw a hat`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S11 needs explicit evidence-needed (generate TAP, download TAP, Make Video TAP, Heavy/Expert 5-image edit TAP)`;
    }
  }
  if (original.family === WORKBOOK_IMAGE_SEARCH_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S12 must be test-action — leftover Imagine dest-end / iOS Imagine Unbound / logged-out Imagine judged / leftover 3*5 / history Command Menu search / S11 image gen is not Image search`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S12 needs explicit evidence-needed (find-3-images TAP, similar follow-up TAP, similar-to-object TAP)`;
    }
  }
  if (original.family === WORKBOOK_HISTORY_FAMILY_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S13 must be test-action — leftover dest-end open-conversation / Command Menu search / history-collapse / draft delete is not open older conversation, History expand, search history, or delete persistence`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S13 needs explicit evidence-needed (open older conversation TAP + send, History expand TAP, search keyword TAP + clear, delete TAP + restart)`;
    }
  }
  if (original.id === 41 || original.id === 43) {
    if (original.requirementAction !== "test-action") {
      return `${label} S14 must be test-action — leftover Settings dest-end / inspect-only Language Selector / SuperGrok banner is not App Language mutate or SuperGrok row`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S14 needs explicit evidence-needed (App Language TAP + persist, SuperGrok row TAP + view)`;
    }
  }
  if (original.id === WORKBOOK_UPLOAD_ANALYSIS_ORIGINAL_ID) {
    if (original.requirementAction !== "test-action") {
      return `${label} S04 GQA-053 must be test-action — leftover attach dest-end / compile-without-YAML / iOS Files-app compile-block / logged-out upload chip is not upload analysis`;
    }
    if (!original.evidenceNeeded || original.evidenceNeeded.length === 0) {
      return `${label} S04 GQA-053 needs explicit evidence-needed (upload TAP + analysis send TAP + generated analysis)`;
    }
  }
  if (original.id === 7) {
    const switchKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!switchKinds.has(required)) {
        return `${label} GQA-007 causal TAP must change selection — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 44) {
    const signOutKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!signOutKinds.has(required)) {
        return `${label} GQA-044 Sign Out TAP must execute — leftover logged-out home is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 45 || original.id === 46) {
    const xKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!xKinds.has("receipt")) {
      return `${label} GQA-045/046 needs a Continue with X TAP receipt — weekly pause is not this original`;
    }
    if (!xKinds.has("sequence")) {
      return `${label} GQA-045/046 needs sequence evidence — one leftover sheet is not both X variants`;
    }
  }
  if (original.id === 1) {
    const sendKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!sendKinds.has(required)) {
        return `${label} GQA-001 send TAP must execute — leftover composer-focus / send-hello paywall is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 2) {
    const expandKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!expandKinds.has("receipt")) {
      return `${label} GQA-002 needs a multiline type TAP receipt — leftover composer-focus inspect is not this original`;
    }
  }
  if (original.id === 6) {
    const typeaheadKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!typeaheadKinds.has("receipt")) {
      return `${label} GQA-006 needs a typeahead select TAP receipt — leftover composer-focus inspect is not this original`;
    }
  }
  if (original.id === 28) {
    const autoFastKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!autoFastKinds.has(required)) {
        return `${label} GQA-028 Auto Fast routing TAP must execute — leftover Fast-checked / model-iterate / SuperGrok pricing is not this original — needs ${required} evidence`;
      }
    }
    const autoFastReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (autoFastReceipts.length < 2) {
      return `${label} GQA-028 needs send TAP and Think harder TAP receipts — leftover Fast-checked / model-iterate is not this original`;
    }
  }
  if (original.id === 29) {
    const autoExpertKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!autoExpertKinds.has(required)) {
        return `${label} GQA-029 Auto Expert routing TAP must execute — leftover Fast-checked / model-iterate / SuperGrok pricing is not this original — needs ${required} evidence`;
      }
    }
    const autoExpertReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (autoExpertReceipts.length < 2) {
      return `${label} GQA-029 needs send TAP and Quick answer TAP receipts — leftover Fast-checked / model-iterate is not this original`;
    }
  }
  if (original.id === 9) {
    const toolbarKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!toolbarKinds.has("receipt")) {
      return `${label} GQA-009 TAP More must execute — leftover 3*5 toolbar expect-set / dest-end toolbar-existing is not this original`;
    }
  }
  if (original.id === 10) {
    const chipKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!chipKinds.has(required)) {
        return `${label} GQA-010 follow-up chip TAP must execute — leftover 3*5 toolbar dest-end is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 12) {
    const autoscrollKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!autoscrollKinds.has("sequence")) {
      return `${label} GQA-012 needs sequence evidence — leftover 3*5 extract-15 / autoscroll-unmeasured is not this original`;
    }
  }
  if (original.id === 13) {
    const shareKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!shareKinds.has("receipt")) {
      return `${label} GQA-013 share TAP must execute — leftover 3*5 share toast / clipboard-denied / more-header chrome-only is not this original`;
    }
  }
  if (original.id === 11) {
    const sourcesKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!sourcesKinds.has("sequence")) {
      return `${label} GQA-011 needs sequence evidence — leftover 3*5 extract-15 / Search the web absent / inspect-only Expert sheet is not this original`;
    }
    const sourcesReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (sourcesReceipts.length < 2) {
      return `${label} GQA-011 needs send TAP and sources TAP receipts — leftover 3*5 extract-15 / toolbar dest-end is not this original`;
    }
  }
  if (original.id === 30) {
    const slackKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!slackKinds.has("sequence")) {
      return `${label} GQA-030 needs sequence evidence — leftover plugins overlay / Heavy GQA-031 is not this original`;
    }
    const slackReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (slackReceipts.length < 2) {
      return `${label} GQA-030 needs send TAP and thinking-trace expand TAP receipts — leftover plugins overlay is not this original`;
    }
  }
  if (original.id === 56) {
    const newsKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!newsKinds.has("sequence")) {
      return `${label} GQA-056 needs sequence evidence — leftover YAML news / think-harder YAML / Heavy GQA-057 is not this original`;
    }
    const newsReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (newsReceipts.length < 2) {
      return `${label} GQA-056 needs send TAP and sources TAP receipts — leftover 3*5 extract-15 is not this original`;
    }
  }
  if (original.id === 31) {
    const heavyKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!heavyKinds.has("sequence")) {
      return `${label} GQA-031 needs sequence evidence — leftover 3*5 extract-15 / inspect-only Heavy sheet / S09 GQA-030 Slack is not this original`;
    }
    const heavyReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (heavyReceipts.length < 2) {
      return `${label} GQA-031 needs send TAP and notes TAP receipts — leftover plugins overlay / inspect-only Heavy sheet is not this original`;
    }
  }
  if (original.id === 57) {
    const heavyNewsKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!heavyNewsKinds.has("sequence")) {
      return `${label} GQA-057 needs sequence evidence — leftover YAML news / think-harder YAML / S09 GQA-056 is not this original`;
    }
    const heavyNewsReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (heavyNewsReceipts.length < 2) {
      return `${label} GQA-057 needs send TAP and sources TAP receipts — leftover 3*5 extract-15 / S09 GQA-056 is not this original`;
    }
  }
  if (original.id === 58) {
    const investmentKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!investmentKinds.has("sequence")) {
      return `${label} GQA-058 needs sequence evidence — leftover finance dest-end / orig 50 Heavy 5-image is not this original`;
    }
    if (!investmentKinds.has("receipt")) {
      return `${label} GQA-058 needs a Heavy investment send TAP receipt — leftover finance dest-end (do not tap Add) is not this original`;
    }
  }
  if (original.id === 16) {
    const downloadKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!downloadKinds.has("receipt")) {
      return `${label} GQA-016 download TAP must execute — leftover Imagine dest-end / iOS Imagine Unbound is not this original`;
    }
    const downloadReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (downloadReceipts.length < 2) {
      return `${label} GQA-016 needs generate TAP and download TAP receipts — leftover Imagine dest-end / iOS Imagine Unbound is not this original`;
    }
  }
  if (original.id === 17) {
    const videoKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!videoKinds.has("after")) {
      return `${label} GQA-017 needs after evidence — leftover Imagine dest-end / GQA-008 Create Videos preset is not this original`;
    }
    const videoReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (videoReceipts.length < 2) {
      return `${label} GQA-017 needs generate TAP and Make Video TAP receipts — leftover Imagine dest-end / GQA-008 Create Videos preset is not this original`;
    }
  }
  if (original.id === 50) {
    const fiveImageKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!fiveImageKinds.has("after")) {
      return `${label} GQA-050 needs after evidence — leftover Imagine dest-end / UNRECORDED Heavy 5-image / Fast leftover is not this original`;
    }
    const fiveImageReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (fiveImageReceipts.length < 2) {
      return `${label} GQA-050 needs generate TAP and edit TAP receipts — leftover Imagine dest-end / UNRECORDED Heavy 5-image / Fast leftover is not this original`;
    }
  }
  if (original.id === 54) {
    const puppyKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!puppyKinds.has("receipt")) {
      return `${label} GQA-054 needs a Draw a puppy send TAP receipt — leftover Imagine dest-end / iOS Imagine Unbound is not this original`;
    }
  }
  if (original.id === 55) {
    const hatKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!hatKinds.has("receipt")) {
      return `${label} GQA-055 needs a Draw a hat send TAP receipt — leftover Imagine dest-end / orig 50 Heavy 5-image is not this original`;
    }
  }
  if (original.id === 49) {
    const searchKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!searchKinds.has("sequence")) {
      return `${label} GQA-049 needs sequence evidence — leftover Imagine dest-end / history Command Menu search / leftover 3*5 is not this original`;
    }
    const searchReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (searchReceipts.length < 3) {
      return `${label} GQA-049 needs find-3-images TAP, similar TAP, and similar-to-object TAP receipts — leftover Imagine dest-end / S11 Draw a puppy / history search is not this original`;
    }
  }
  if (original.id === 21) {
    const olderKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!olderKinds.has(required)) {
        return `${label} GQA-021 open older conversation TAP must execute — leftover dest-end open-conversation / older-chat compile-blocked is not this original — needs ${required} evidence`;
      }
    }
    const olderReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (olderReceipts.length < 2) {
      return `${label} GQA-021 needs open TAP and send TAP receipts — leftover dest-end open-conversation (no new prompt) is not this original`;
    }
  }
  if (original.id === 34) {
    const expandKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!expandKinds.has("receipt")) {
      return `${label} GQA-034 History expand TAP must execute — leftover sidebar dest-end / history-collapse Hide Conversation Previews is not this original`;
    }
    if (!expandKinds.has("view")) {
      return `${label} GQA-034 needs expanded History/Conversations view — leftover sidebar dest-end is not this original`;
    }
  }
  if (original.id === 38) {
    const historySearchKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "after", "receipt"] as const) {
      if (!historySearchKinds.has(required)) {
        return `${label} GQA-038 history search TAP must execute — leftover Command Menu search / Android Search dest-end is not this original — needs ${required} evidence`;
      }
    }
    const historySearchReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (historySearchReceipts.length < 2) {
      return `${label} GQA-038 needs keyword TAP and clear TAP receipts — leftover Command Menu search / Android Search dest-end is not this original`;
    }
  }
  if (original.id === 39) {
    const deleteKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "restart", "after", "receipt"] as const) {
      if (!deleteKinds.has(required)) {
        return `${label} GQA-039 delete TAP must execute — leftover draft delete-wrong-chat is not this original — needs ${required} evidence`;
      }
    }
  }
  if (original.id === 41) {
    const languageKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    for (const required of ["before", "restart", "after", "receipt"] as const) {
      if (!languageKinds.has(required)) {
        return `${label} GQA-041 App Language TAP must execute — leftover Settings dest-end / inspect-only Language Selector is not this original — needs ${required} evidence`;
      }
    }
    const languageReceipts =
      original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (languageReceipts.length < 2) {
      return `${label} GQA-041 needs open TAP and confirm TAP receipts — leftover inspect-only Language Selector (do not tap a language) is not this original`;
    }
  }
  if (original.id === 43) {
    const subKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!subKinds.has("receipt")) {
      return `${label} GQA-043 SuperGrok row TAP must execute — leftover Settings dest-end / home banner / hide-upsell inspect is not this original`;
    }
    if (!subKinds.has("view")) {
      return `${label} GQA-043 needs SuperGrok subscription/upgrade view — leftover Settings dest-end / Unlock extended capabilities pill is not this original`;
    }
  }
  if (original.id === WORKBOOK_UPLOAD_ANALYSIS_ORIGINAL_ID) {
    const uploadKinds = new Set(original.evidenceNeeded?.map((item) => item.kind) ?? []);
    if (!uploadKinds.has("receipt")) {
      return `${label} GQA-053 upload TAP must execute — leftover attach dest-end / 19z5.15/19z5.19 compile-without-YAML / iOS Files-app compile-block is not this original`;
    }
    if (!uploadKinds.has("after")) {
      return `${label} GQA-053 needs after evidence — chip-only dest-end / logged-out upload chip is not this original`;
    }
    const uploadReceipts = original.evidenceNeeded?.filter((item) => item.kind === "receipt") ?? [];
    if (uploadReceipts.length < 2) {
      return `${label} GQA-053 needs upload TAP and analysis send TAP receipts — 19z5.15/19z5.19 Upload a file compiles without YAML / iOS Files-app compile-block / dest-end sample.pdf chip is not this original`;
    }
  }
  if (!original.evidenceNeeded) return undefined;
  const kinds = new Set(original.evidenceNeeded.map((item) => item.kind));
  for (const required of requiredEvidenceNeededKinds(original.evidencePacket)) {
    if (!kinds.has(required)) {
      return `${label} ${original.evidencePacket} packet needs ${required} evidence`;
    }
  }
  if (original.requirementAction === "test-action" && destEndViewPacketMayLeftoverSkip(original)) {
    return `${label} GQA-004/040 leftover skip cannot be test-action`;
  }
  return undefined;
}
