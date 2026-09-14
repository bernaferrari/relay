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

function controlLabel(target: {
  label?: string;
  text?: string;
  identifier?: string;
}): string | undefined {
  return target.label ?? target.text ?? target.identifier;
}

function waitCopy(
  target: { label?: string; text?: string; identifier?: string },
  gone: boolean,
): string {
  const label = controlLabel(target);
  const condition = gone ? "gone" : "visible";
  return label ? `Waits until ${label} is ${condition}.` : `Waits until a control is ${condition}.`;
}

export function checkpointBindingCopy(step: AppMapScenarioTestStep): string | undefined {
  if (step.kind !== "validation" || step.binding.status !== "resolved") return undefined;
  if (step.binding.kind === "assertion") {
    const assertion = step.binding.assertion;
    if (assertion.kind === "screen") return "Checks that the expected screen is showing.";
    if (assertion.kind === "target") {
      return waitCopy(assertion.target, assertion.condition === "gone");
    }
    if (assertion.kind === "layout") return "Checks that two controls do not overlap.";
    if (assertion.kind === "content")
      return `Checks ${assertion.input} ${assertion.match} ${assertion.expected}.`;
    if (assertion.kind === "visual") return "A visual judge will score this screenshot.";
    if (assertion.kind === "semantic") return `A semantic judge will score ${assertion.input}.`;
    return undefined;
  }
  if (step.binding.kind !== "recipe-step") return undefined;
  const recipe = step.binding.step;
  if (recipe.kind === "expect") return waitCopy(recipe.target, recipe.condition === "gone");
  if (recipe.kind === "expect-set") {
    const count = recipe.labels.length;
    return count
      ? `Checks ${count} listed control${count === 1 ? "" : "s"} ${recipe.extras === "allow" ? "and allows extras" : "with no extras"}.`
      : "Checks a listed set of controls.";
  }
  if (recipe.kind === "assert-content") return "Checks extracted text against an expected value.";
  if (recipe.kind === "assert-layout") return "Checks layout against a recorded arrangement.";
  if (recipe.kind === "wait-response") return "Waits for a reply to finish.";
  if (recipe.kind === "identity-ignore")
    return recipe.name
      ? `Ignores ${recipe.name} so only chrome is compared.`
      : "Ignores a rectangle so only chrome is compared.";
  if (recipe.kind === "evaluate-visual") return "A visual judge will score this screenshot.";
  if (recipe.kind === "evaluate-semantic") return "A semantic judge will score the reply.";
  return undefined;
}

export function stepBindingCopy(step: AppMapScenarioTestStep): string | undefined {
  if (step.binding.status !== "resolved") return undefined;
  if (step.kind === "validation") return undefined;
  if ("kind" in step.binding && step.binding.kind === "connections") {
    const count = step.binding.connectionIds.length;
    return count === 1 ? "Uses one saved path." : `Uses ${count} saved paths.`;
  }
  if ("kind" in step.binding && step.binding.kind === "routine") {
    return "Uses a saved section.";
  }
  return "This step has a saved target.";
}

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
    label: "Judges",
    kinds: [
      { value: "semantic", label: "Semantic judge" },
      { value: "visual", label: "Visual judge" },
    ],
  },
  {
    id: "identity",
    label: "Ignore region",
    kinds: [{ value: "identity-ignore", label: "Ignore for identity" }],
  },
] as const;

export const IDENTITY_IGNORE_PRESETS = [
  {
    id: "reply-body",
    name: "reply body",
    region: "0.08,0.30,0.84,0.55",
    label: "Reply body",
    detail: "Chrome stays compared. Do not use this on a logged-out paywall.",
  },
  {
    id: "user-bubble",
    name: "user bubble",
    region: "0.70,0.08,0.28,0.10",
    label: "User bubble",
    detail: "Paywall card stays compared.",
  },
  {
    id: "cookie-banner",
    name: "cookie banner",
    region: "0.57,0.80,0.43,0.20",
    label: "Cookie banner",
    detail: "Essential cookies dialog. Do not bake the banner into a visual baseline.",
  },
] as const;

export function emptyValidationDraft(kind: ValidationDraft["kind"]): ValidationDraft {
  if (kind === "screen") return { kind: "screen", screenId: "" };
  if (kind === "visual")
    return { kind: "visual", criteria: "", region: "", requireAgreement: true };
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
  original: _original,
  canAdd,
  busy,
  bindingSummary,
  onChange,
}: {
  value?: ValidationDraft;
  original?: ValidationDraft;
  canAdd: boolean;
  busy: boolean;
  bindingSummary?: string;
  onChange(next: ValidationDraft): void;
}) {
  if (!value) {
    return (
      <div className="grid gap-3">
        <p className="text-xs font-normal leading-normal text-muted-foreground">
          {canAdd
            ? "Add a result Relay should prove after this step. Visual judges, reply checks, and ignore regions live here — not in YAML."
            : (bindingSummary ??
              "This checkpoint uses a reviewed structured assertion. Its readable binding remains available under Advanced.")}
        </p>
        {canAdd ? (
          <fieldset className="grid gap-1.5 text-xs font-semibold" disabled={busy}>
            <legend>Expected result</legend>
            <ValidationKindGroups onSelect={(kind) => onChange(emptyValidationDraft(kind))} />
          </fieldset>
        ) : (
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Visual judges, reply checks, and ignore regions are a separate Checkpoint. Use Add
            checkpoint — do not overwrite this saved wait.
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
              placeholder="0.07,0.12,0.86,0.68"
            />
          </label>
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Optional. Pixels or 0–1 fractions. Leave blank to judge the whole screenshot.
          </p>
          <RegionFrame region={value.region} />
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
          <p className="text-xs font-normal leading-normal text-muted-foreground">
            Usually <code>reply</code> after a reply wait.
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
            0–1 fractions. On logged-out grok.com, ignore the cookie banner. On a logged-out
            paywall, ignore the user bubble — a full reply-body ignore can strip the Continue card.
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

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseRegion(
  value: string,
): { x: number; y: number; width: number; height: number } | undefined {
  const parts = value.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
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
      className="relative aspect-[16/10] w-full max-w-[220px] overflow-hidden rounded-md border border-border bg-muted/50"
      aria-hidden="true"
    >
      <span className="pointer-events-none absolute inset-x-[7%] top-[8%] h-[10%] rounded-sm bg-foreground/10" />
      {box ? (
        <span
          className="pointer-events-none absolute rounded-sm bg-primary/30 ring-1 ring-primary/50"
          style={{
            left: `${Math.max(0, box.x) * 100}%`,
            top: `${Math.max(0, box.y) * 100}%`,
            width: `${Math.max(0, box.width) * 100}%`,
            height: `${Math.max(0, box.height) * 100}%`,
          }}
        />
      ) : (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">
          Enter x,y,w,h
        </span>
      )}
    </div>
  );
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
