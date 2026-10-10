/** @jsxImportSource react */
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";

export function JudgeAgreementControls({
  requireAgreement,
  onRequireAgreement,
}: {
  requireAgreement: boolean;
  onRequireAgreement(next: boolean): void;
}) {
  return (
    <>
      <p className="text-xs font-normal leading-normal text-muted-foreground">
        Uses your model key from Settings. Without one, the run is blocked instead of passing.
      </p>
      <FieldLabel className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Ask two models and require them to agree
          </span>
          <span className="text-xs font-normal leading-snug text-muted-foreground">
            If they disagree, the screenshot waits for your review.
          </span>
        </span>
        <Checkbox
          checked={requireAgreement}
          onCheckedChange={(checked) => onRequireAgreement(checked === true)}
        />
      </FieldLabel>
    </>
  );
}
