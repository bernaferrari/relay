/** @jsxImportSource react */
import type { AppMapScenarioTestStep } from "@relay/protocol";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { Button } from "@relay/ui-react/components/button";
import { SelectField } from "./filter-select";
import { validationKindGroupsForEditor } from "./test-editor-checkpoint-kinds";
import { ConditionWaitEditor } from "./test-editor-wait";
import { JudgeAgreementControls } from "./test-editor-judge-agreement";
import type { CSSProperties } from "react";
import {
  checkpointBindingCopy,
  emptyValidationDraft,
  IDENTITY_IGNORE_PRESETS,
  isValidationDraftReady,
  parseRegion,
  stepBindingCopy,
  validationBindingFromDraft,
  validationDraft,
  validationPatch,
  type ValidationDraft,
} from "./test-editor-assertion-model";
export {
  checkpointBindingCopy,
  emptyValidationDraft,
  IDENTITY_IGNORE_PRESETS,
  isValidationDraftReady,
  parseRegion,
  stepBindingCopy,
  validationBindingFromDraft,
  validationDraft,
  validationPatch,
} from "./test-editor-assertion-model";
export type { ValidationDraft } from "./test-editor-assertion-model";

export { VALIDATION_KIND_GROUPS } from "./test-editor-checkpoint-kinds";

function ValidationKindGroups({
  selected,
  onSelect,
  hasRememberableReply,
}: {
  selected?: ValidationDraft["kind"];
  onSelect(kind: ValidationDraft["kind"]): void;
  hasRememberableReply: boolean;
}) {
  const groups = validationKindGroupsForEditor({ hasRememberableReply, selected });
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      What should Relay check?
      <select
        aria-label="Checkpoint type"
        className="h-9 w-full min-w-0 rounded-lg border border-border bg-transparent px-3 text-sm font-normal text-foreground"
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value as ValidationDraft["kind"])}
      >
        <option value="" disabled>
          Choose what to check
        </option>
        {groups.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {group.kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function ValidationExpectationEditor({
  value,
  original: _original,
  canAdd,
  busy,
  bindingSummary,
  hasRememberableReply = false,
  onChange,
}: {
  value?: ValidationDraft;
  original?: ValidationDraft;
  canAdd: boolean;
  busy: boolean;
  bindingSummary?: string;
  hasRememberableReply?: boolean;
  onChange(next: ValidationDraft): void;
}) {
  if (!value) {
    return (
      <div className="grid gap-3">
        {canAdd ? null : (
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            {bindingSummary ??
              "This check was set up by hand. You can see how it works under Advanced."}
          </p>
        )}
        {canAdd ? (
          <fieldset className="grid gap-3 text-xs font-normal" disabled={busy}>
            <legend className="sr-only">What to check</legend>
            <ValidationKindGroups
              hasRememberableReply={hasRememberableReply}
              onSelect={(kind) => onChange(emptyValidationDraft(kind))}
            />
          </fieldset>
        ) : (
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            To add a different kind of check, use Add step → Add a check.
          </p>
        )}
      </div>
    );
  }
  return (
    <fieldset className="grid gap-3 text-xs font-normal" disabled={busy}>
      <legend className="sr-only">Expected result</legend>
      <ValidationKindGroups
        selected={value.kind}
        hasRememberableReply={hasRememberableReply}
        onSelect={(kind) => onChange(emptyValidationDraft(kind))}
      />
      {value.kind === "wait-for" ? <ConditionWaitEditor value={value} onChange={onChange} /> : null}
      {value.kind === "capture" ? (
        <>
          <label htmlFor="selected-step-capture-name">
            Name
            <Input
              id="selected-step-capture-name"
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.currentTarget.value })}
              placeholder="Arabic account settings"
            />
          </label>
          <label htmlFor="selected-step-capture-look-for">
            What should the reviewer look for?
            <Textarea
              id="selected-step-capture-look-for"
              value={value.lookFor}
              onChange={(event) => onChange({ ...value, lookFor: event.currentTarget.value })}
              placeholder="Arabic text is readable, nothing overlaps, and Save is visible."
              rows={3}
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Current viewport. A person will review later. Capture succeeded is not the same as
            review accepted. Looks correct reviews this capture. Accept as reference also governs
            later Runs. No AI key required.
          </p>
        </>
      ) : null}
      {value.kind === "upload" ? (
        <>
          <label htmlFor="selected-step-expected-upload-file">
            Workspace file
            <Input
              id="selected-step-expected-upload-file"
              value={value.file}
              onChange={(event) => onChange({ ...value, file: event.currentTarget.value })}
              placeholder="tests/fixtures/sample.pdf"
            />
          </label>
          <label htmlFor="selected-step-expected-upload-label">
            Attach control
            <Input
              id="selected-step-expected-upload-label"
              value={value.label}
              onChange={(event) => onChange({ ...value, label: event.currentTarget.value })}
              placeholder="Upload a file"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Browser attaches this file. iOS compile-blocks until a Files-app path is recorded. An
            Android primitive push is not a Grok Files pass. Confirm/Reject and a passing attach do
            not accept a visual baseline.
          </p>
        </>
      ) : null}
      {value.kind === "screen" ? (
        <label htmlFor="selected-step-expected-screen">
          Screen ID
          <Input
            id="selected-step-expected-screen"
            value={value.screenId}
            onChange={(event) => onChange({ ...value, screenId: event.currentTarget.value })}
            placeholder="checkout-confirmation"
          />
        </label>
      ) : null}
      {value.kind === "visual" ? (
        <>
          <label htmlFor="selected-step-expected-visual">
            Visual criteria
            <Textarea
              id="selected-step-expected-visual"
              value={value.criteria}
              onChange={(event) => onChange({ ...value, criteria: event.currentTarget.value })}
              placeholder={"Composer is visible\nSend is enabled"}
              rows={4}
            />
          </label>
          <label htmlFor="selected-step-expected-crop">
            Judge crop x,y,w,h
            <Input
              id="selected-step-expected-crop"
              value={value.region}
              onChange={(event) => onChange({ ...value, region: event.currentTarget.value })}
              placeholder="0.07,0.12,0.86,0.68"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Optional. Pixels or 0–1 fractions. Leave blank to judge the whole screenshot. Judge
            visible chrome. Do not parse LaTeX or H1–H6 size. Coffee and location replies stay
            screenshot-only.
          </p>
          <RegionFrame region={value.region} />
          <JudgeAgreementControls
            requireAgreement={value.requireAgreement}
            onRequireAgreement={(requireAgreement) => onChange({ ...value, requireAgreement })}
          />
        </>
      ) : null}
      {value.kind === "semantic" ? (
        <>
          <label htmlFor="selected-step-expected-semantic-input">
            Judge this text
            <Input
              id="selected-step-expected-semantic-input"
              value={value.input}
              onChange={(event) => onChange({ ...value, input: event.currentTarget.value })}
              placeholder="reply"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Usually <code>reply</code> after Remember reply.
          </p>
          <label htmlFor="selected-step-expected-semantic">
            Semantic criteria
            <Textarea
              id="selected-step-expected-semantic"
              value={value.criteria}
              onChange={(event) => onChange({ ...value, criteria: event.currentTarget.value })}
              placeholder="Reply must mention a location"
              rows={3}
            />
          </label>
          <JudgeAgreementControls
            requireAgreement={value.requireAgreement}
            onRequireAgreement={(requireAgreement) => onChange({ ...value, requireAgreement })}
          />
        </>
      ) : null}
      {value.kind === "wait-response" ? (
        <>
          <label htmlFor="selected-step-expected-wait-label">
            Reply control
            <Input
              id="selected-step-expected-wait-label"
              value={value.label}
              onChange={(event) => onChange({ ...value, label: event.currentTarget.value })}
              placeholder="Ask anything"
            />
          </label>
          <label htmlFor="selected-step-expected-wait-max">
            Maximum acceptable duration (ms)
            <Input
              id="selected-step-expected-wait-max"
              value={value.maxMs}
              onChange={(event) => onChange({ ...value, maxMs: event.currentTarget.value })}
              placeholder="1000"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Fails if the reply takes longer, even when it finishes. This does not extend the
            completion timeout.
          </p>
        </>
      ) : null}
      {value.kind === "extract" ? (
        <>
          <label htmlFor="selected-step-expected-extract-as">
            Remember as
            <Input
              id="selected-step-expected-extract-as"
              value={value.as}
              onChange={(event) => onChange({ ...value, as: event.currentTarget.value })}
              placeholder="reply"
            />
          </label>
          <label htmlFor="selected-step-expected-extract-label">
            Reply control
            <Input
              id="selected-step-expected-extract-label"
              value={value.label}
              onChange={(event) => onChange({ ...value, label: event.currentTarget.value })}
              placeholder="Ask anything"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            YAML is not required. Wait for a reply, remember it, then add a semantic judge. Name
            this the same as Judge this text, usually <code>reply</code>.
          </p>
        </>
      ) : null}
      {value.kind === "identity-ignore" ? (
        <>
          <label htmlFor="selected-step-expected-identity-name">
            Ignore this area
            <Input
              id="selected-step-expected-identity-name"
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.currentTarget.value })}
              placeholder="reply body"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {IDENTITY_IGNORE_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                title={preset.detail}
                variant={
                  value.name === preset.name && value.region === preset.region
                    ? "default"
                    : "outline"
                }
                onClick={() => onChange({ ...value, name: preset.name, region: preset.region })}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <label htmlFor="selected-step-expected-identity-region">
            Region x,y,w,h
            <Input
              id="selected-step-expected-identity-region"
              value={value.region}
              onChange={(event) => onChange({ ...value, region: event.currentTarget.value })}
              placeholder="0.08,0.30,0.84,0.55"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Identity and visual compare skip this rectangle so only chrome is compared. Pixels or
            0–1 fractions. On logged-out grok.com, ignore the cookie banner, rotating composer
            placeholder, and heading caret. On a logged-out paywall, ignore the user bubble — a full
            reply-body ignore can strip the Continue card. On Library, Imagine, or Conversations,
            ignore the feed with Library chrome sandwich so one viewport of top and bottom chrome is
            compared. Do not survey the infinite feed. Ignore Enjoying Grok? chrome with a named
            region — do not bake that prompt into a baseline.
          </p>
          <RegionFrame region={value.region} />
        </>
      ) : null}
      {value.kind === "content" ? (
        <>
          <label htmlFor="selected-step-expected-input">
            Read from
            <Input
              id="selected-step-expected-input"
              value={value.input}
              onChange={(event) => onChange({ ...value, input: event.currentTarget.value })}
              placeholder="Order total"
            />
          </label>
          <label htmlFor="selected-step-expected-value">
            Expected value
            <Input
              id="selected-step-expected-value"
              value={value.expected}
              onChange={(event) => onChange({ ...value, expected: event.currentTarget.value })}
              placeholder="$42.00"
            />
          </label>
          <SelectField
            id="selected-step-expected-match"
            label="Match"
            value={value.match}
            options={[
              { value: "equals", label: "Equals" },
              { value: "exact", label: "Exactly" },
              { value: "contains", label: "Contains" },
              { value: "not-contains", label: "Does not contain" },
              { value: "number-equals", label: "Number equals" },
              { value: "field", label: "Structured field" },
            ]}
            onValueChange={(match) =>
              onChange({
                ...value,
                match: match as ValidationDraft extends { match: infer M } ? M : never,
              })
            }
          />
          {value.match === "field" ? (
            <label htmlFor="selected-step-expected-field">
              Field
              <Input
                id="selected-step-expected-field"
                value={value.field ?? ""}
                onChange={(event) => onChange({ ...value, field: event.currentTarget.value })}
                placeholder="answer"
              />
            </label>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}

function regionToFractions(region: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const fractions = [region.x, region.y, region.width, region.height].every(
    (value) => value >= 0 && value <= 1,
  );
  if (fractions) return region;
  return {
    x: region.x / 1280,
    y: region.y / 800,
    width: region.width / 1280,
    height: region.height / 800,
  };
}

function RegionFrame({ region }: { region: string }) {
  const parsed = parseRegion(region);
  const box = parsed ? regionToFractions(parsed) : undefined;
  return (
    <div
      className="relative aspect-video w-full max-w-56 overflow-hidden rounded-md border border-border bg-muted/50"
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute inset-x-[7%] top-[8%] h-[10%] rounded-sm bg-foreground/10" />
      {box ? (
        <span
          className="pointer-events-none absolute left-(--box-left) top-(--box-top) h-(--box-height) w-(--box-width) rounded-sm bg-primary/30 ring-1 ring-primary/50"
          style={
            {
              "--box-left": `${Math.max(0, box.x) * 100}%`,
              "--box-top": `${Math.max(0, box.y) * 100}%`,
              "--box-width": `${Math.max(0, box.width) * 100}%`,
              "--box-height": `${Math.max(0, box.height) * 100}%`,
            } as CSSProperties
          }
        />
      ) : (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          Enter x,y,w,h
        </span>
      )}
    </div>
  );
}
