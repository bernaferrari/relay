/** @jsxImportSource react */
import type {
  AppMapScenarioTestEdit,
  AppMapScenarioTestStep,
  AppMapTestResolvedBinding,
} from "@relay/protocol";
import { Input } from "@relay/ui-react/components/input";
import { Textarea } from "@relay/ui-react/components/textarea";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";
import { SelectField } from "./filter-select";

export type ValidationDraft =
  | { kind: "screen"; screenId: string }
  | {
      kind: "content";
      input: string;
      expected: string;
      match: "exact" | "equals" | "contains" | "not-contains" | "number-equals" | "field";
      field?: string;
    }
  | { kind: "visual"; criteria: string; region: string; requireAgreement: boolean }
  | { kind: "semantic"; input: string; criteria: string; requireAgreement: boolean }
  | { kind: "wait-response"; label: string; maxMs: string }
  | { kind: "identity-ignore"; name: string; region: string };

export function validationDraft(step: AppMapScenarioTestStep): ValidationDraft | undefined {
  if (step.kind !== "validation" || step.binding.status !== "resolved") return undefined;
  if (step.binding.kind === "recipe-step" && step.binding.step.kind === "wait-response") {
    return {
      kind: "wait-response",
      label: step.binding.step.target.label ?? step.binding.step.target.text ?? "",
      maxMs: step.binding.step.maxMs === undefined ? "" : String(step.binding.step.maxMs),
    };
  }
  if (step.binding.kind === "recipe-step" && step.binding.step.kind === "identity-ignore") {
    const region = step.binding.step.region;
    return {
      kind: "identity-ignore",
      name: step.binding.step.name ?? "",
      region: `${region.x},${region.y},${region.width},${region.height}`,
    };
  }
  if (step.binding.kind !== "assertion") return undefined;
  const assertion = step.binding.assertion;
  if (assertion.kind === "screen") return { kind: "screen", screenId: assertion.screenId };
  if (assertion.kind === "content") {
    return {
      kind: "content",
      input: assertion.input,
      expected: assertion.expected,
      match: assertion.match,
    };
  }
  if (assertion.kind === "visual") {
    return {
      kind: "visual",
      criteria: assertion.criteria.join("\n"),
      region: assertion.region
        ? `${assertion.region.x},${assertion.region.y},${assertion.region.width},${assertion.region.height}`
        : "",
      requireAgreement: assertion.requireAgreement === true,
    };
  }
  if (assertion.kind === "semantic") {
    return {
      kind: "semantic",
      input: assertion.input,
      criteria: assertion.criteria.join("\n"),
      requireAgreement: assertion.requireAgreement === true,
    };
  }
  return undefined;
}

export function isValidationDraftReady(draft: ValidationDraft): boolean {
  if (draft.kind === "screen") return Boolean(draft.screenId.trim());
  if (draft.kind === "visual") {
    if (!draft.criteria.trim()) return false;
    if (draft.region.trim() && !parseRegion(draft.region)) return false;
    return true;
  }
  if (draft.kind === "semantic") return Boolean(draft.input.trim() && draft.criteria.trim());
  if (draft.kind === "wait-response") return Boolean(draft.label.trim());
  if (draft.kind === "identity-ignore") return Boolean(parseRegion(draft.region));
  if (draft.match === "field")
    return Boolean(draft.input.trim() && draft.expected.trim() && draft.field?.trim());
  return Boolean(draft.input.trim() && draft.expected.trim());
}

export function validationBindingFromDraft(
  draft: ValidationDraft,
): Extract<AppMapTestResolvedBinding, { kind: "assertion" | "recipe-step" }> {
  if (draft.kind === "wait-response") {
    const maxMs = Number.parseInt(draft.maxMs, 10);
    return {
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "wait-response",
        target: { label: draft.label.trim() },
        ...(Number.isFinite(maxMs) && maxMs > 0 ? { maxMs } : {}),
      },
    };
  }
  if (draft.kind === "visual") {
    const region = parseRegion(draft.region);
    return {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "visual",
        criteria: lines(draft.criteria),
        ...(region ? { region } : {}),
        ...(draft.requireAgreement ? { requireAgreement: true } : {}),
      },
    };
  }
  if (draft.kind === "identity-ignore") {
    const region = parseRegion(draft.region);
    if (!region) throw new Error("identity-ignore requires x,y,w,h");
    return {
      status: "resolved",
      kind: "recipe-step",
      step: {
        kind: "identity-ignore",
        region,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
      },
    };
  }
  if (draft.kind === "semantic") {
    return {
      status: "resolved",
      kind: "assertion",
      assertion: {
        kind: "semantic",
        input: draft.input.trim(),
        criteria: lines(draft.criteria),
        ...(draft.requireAgreement ? { requireAgreement: true } : {}),
      },
    };
  }
  return { status: "resolved", kind: "assertion", assertion: draft };
}

export const VALIDATION_KIND_GROUPS = [
  {
    id: "check",
    label: "Check",
    kinds: [
      { value: "screen", label: "Screen" },
      { value: "content", label: "Content" },
    ],
  },
  {
    id: "wait",
    label: "Wait",
    kinds: [{ value: "wait-response", label: "Reply wait" }],
  },
  {
    id: "comparison",
    label: "Comparison settings",
    kinds: [
      { value: "semantic", label: "Semantic judge" },
      { value: "visual", label: "Visual judge" },
    ],
  },
  {
    id: "identity",
    label: "Advanced identity",
    kinds: [{ value: "identity-ignore", label: "Ignore for identity" }],
  },
] as const;

export function emptyValidationDraft(kind: ValidationDraft["kind"]): ValidationDraft {
  if (kind === "screen") return { kind: "screen", screenId: "" };
  if (kind === "visual") return { kind: "visual", criteria: "", region: "", requireAgreement: true };
  if (kind === "semantic")
    return { kind: "semantic", input: "reply", criteria: "", requireAgreement: true };
  if (kind === "wait-response") return { kind: "wait-response", label: "", maxMs: "" };
  if (kind === "identity-ignore")
    return { kind: "identity-ignore", name: "reply body", region: "" };
  return { kind: "content", input: "", expected: "", match: "contains" };
}

function ValidationKindGroups({
  selected,
  onSelect,
}: {
  selected?: ValidationDraft["kind"];
  onSelect(kind: ValidationDraft["kind"]): void;
}) {
  return (
    <div className="grid gap-3">
      {VALIDATION_KIND_GROUPS.map((group) => (
        <fieldset key={group.id} className="grid gap-1">
          <legend className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {group.label}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {group.kinds.map((kind) => (
              <Button
                key={kind.value}
                type="button"
                size="sm"
                variant={selected === kind.value ? "default" : "outline"}
                onClick={() => onSelect(kind.value)}
              >
                {kind.label}
              </Button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function JudgeAgreementControls({
  value,
  onChange,
}: {
  value: Extract<ValidationDraft, { kind: "visual" | "semantic" }>;
  onChange(next: ValidationDraft): void;
}) {
  return (
    <>
      <p className="text-xs font-normal leading-normal text-muted-foreground">
        Fails closed without OPENROUTER_API_KEY. That is Infra, never a silent pass or a product
        fail.
      </p>
      <FieldLabel className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Two independent judges must agree
          </span>
          <span className="text-xs font-normal leading-snug text-muted-foreground">
            Disagreement is Needs review. A missing judge key is not.
          </span>
        </span>
        <Checkbox
          checked={value.requireAgreement}
          onCheckedChange={(checked) => onChange({ ...value, requireAgreement: checked === true })}
        />
      </FieldLabel>
    </>
  );
}

export function ValidationExpectationEditor({
  value,
  original,
  canAdd,
  busy,
  onChange,
}: {
  value?: ValidationDraft;
  original?: ValidationDraft;
  canAdd: boolean;
  busy: boolean;
  onChange(next: ValidationDraft): void;
}) {
  if (!value) {
    return (
      <div className="grid gap-3">
        <p className="text-xs font-normal leading-normal text-muted-foreground">
          {original === undefined
            ? "Add a result Relay should prove after this step. Visual judges, reply checks, and ignore regions live here — not in YAML."
            : "This checkpoint uses a reviewed structured assertion. Its readable binding remains available under Advanced."}
        </p>
        {canAdd ? (
          <fieldset className="grid gap-1.5 text-xs font-semibold" disabled={busy}>
            <legend>Expected result</legend>
            <ValidationKindGroups onSelect={(kind) => onChange(emptyValidationDraft(kind))} />
          </fieldset>
        ) : (
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            The saved assertion uses an advanced structure and remains available under Advanced.
          </p>
        )}
      </div>
    );
  }
  return (
    <fieldset className="grid gap-1.5 text-xs font-semibold" disabled={busy}>
      <legend>Expected result</legend>
      <p className="text-xs font-normal leading-normal text-muted-foreground">
        This is the value Relay validates after the action. It is separate from the human step
        wording above.
      </p>
      <ValidationKindGroups
        selected={value.kind}
        onSelect={(kind) => onChange(emptyValidationDraft(kind))}
      />
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
              placeholder="0.07,0.12,0.93,0.68"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Optional. Pixels or 0–1 fractions. Leave blank to judge the whole screenshot.
          </p>
          <JudgeAgreementControls value={value} onChange={onChange} />
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
          <JudgeAgreementControls value={value} onChange={onChange} />
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
            Max wait (ms)
            <Input
              id="selected-step-expected-wait-max"
              value={value.maxMs}
              onChange={(event) => onChange({ ...value, maxMs: event.currentTarget.value })}
              placeholder="1000"
            />
          </label>
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
          <label htmlFor="selected-step-expected-identity-region">
            Region x,y,w,h
            <Input
              id="selected-step-expected-identity-region"
              value={value.region}
              onChange={(event) => onChange({ ...value, region: event.currentTarget.value })}
              placeholder="0.07,0.12,0.93,0.68"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Identity and visual compare skip this rectangle so only chrome is compared. Pixels or
            0–1 fractions.
          </p>
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

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseRegion(
  value: string,
): { x: number; y: number; width: number; height: number } | undefined {
  const parts = value.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

export function validationPatch(
  stepId: string,
  draft: ValidationDraft,
): Extract<AppMapScenarioTestEdit, { kind: "step.patch" }> {
  return {
    kind: "step.patch",
    stepId,
    patch: { binding: validationBindingFromDraft(draft) },
  };
}
