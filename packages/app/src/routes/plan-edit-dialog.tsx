/** @jsxImportSource react */
import { MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { FieldLabel as ChoiceLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { productTestStatusLabel } from "@relay/product/catalog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import type { ProductSuite } from "../data/suite-profile-product-service";
import { SelectField } from "../components/filter-select";

/** Rename a Plan and choose its Tests and data sets. */
export function PlanEditDialog({
  appId,
  suiteId,
  value,
  open,
  onOpenChange,
}: {
  appId: string;
  suiteId: string;
  value: ProductSuite;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { suiteProfileService, queryClient } = useRouteContext({ from: "__root__" });
  const [name, setName] = useState(value.name);
  const [testIds, setTestIds] = useState<Set<string>>(() => new Set(value.testIds));
  const [variableIds, setVariableIds] = useState<Set<string>>(() => new Set(value.variableIds));
  const [referenceReviewMode, setReferenceReviewMode] = useState<"human" | "approved-reference">(
    value.referenceReviewMode ?? "human",
  );
  const editor = useQuery({
    queryKey: ["suites", "editor", appId],
    queryFn: () => suiteProfileService.getSuiteEditor(appId),
    staleTime: 10_000,
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () =>
      suiteProfileService.saveSuite({
        appMapId: appId,
        suiteId,
        expectedRevision: value.appMapRevision,
        name,
        testIds: [...testIds],
        variableIds: [...variableIds],
        strategy: value.strategy ?? "cartesian",
        selected: value.selected,
        referenceReviewMode,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(["suites", appId, suiteId], saved);
      await queryClient.invalidateQueries({ queryKey: ["suites"] });
      onOpenChange(false);
    },
  });

  function toggle(setter: typeof setTestIds, id: string, checked: boolean) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto"
      >
        <DialogTitle>Edit plan</DialogTitle>
        <DialogDescription>Removing a test from this plan does not delete it.</DialogDescription>
        <form onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="edit-suite-name">Plan name</FieldLabel>
            <Input
              id="edit-suite-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <SelectField
              label="Screenshot review"
              value={referenceReviewMode}
              options={[
                { value: "human", label: "Capture for human review" },
                { value: "approved-reference", label: "Compare approved references" },
              ]}
              onValueChange={(value) =>
                setReferenceReviewMode(value === "approved-reference" ? value : "human")
              }
            />
            <p className="text-xs text-muted-foreground">
              {referenceReviewMode === "approved-reference"
                ? "Matching approved reference images are marked automatically. Accept as reference explicitly chooses the image for later runs."
                : "Every captured image waits for a person. Looks correct does not create a future reference."}
            </p>
          </Field>
          <div className="max-h-[min(760px,calc(100vh-32px))] w-[min(720px,calc(100vw-32px))] overflow-auto p-1">
            <fieldset>
              <legend>Tests</legend>
              {editor.data?.tests.map((test) => (
                <ChoiceLabel
                  key={test.id}
                  className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                >
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="min-w-0 flex-1 wrap-anywhere text-sm font-medium text-foreground">
                      {test.name}
                    </span>
                    <span className="truncate text-xs leading-snug text-muted-foreground">
                      {productTestStatusLabel(test.status, test.name)}
                    </span>
                  </span>
                  <Checkbox
                    checked={testIds.has(test.id)}
                    onCheckedChange={(checked) => toggle(setTestIds, test.id, checked === true)}
                  />
                </ChoiceLabel>
              ))}
            </fieldset>
            {editor.data?.dataSets.length ? (
              <fieldset>
                <legend>Data sets</legend>
                {editor.data.dataSets.map((dataSet) => (
                  <ChoiceLabel
                    key={dataSet.id}
                    className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                  >
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="min-w-0 flex-1 wrap-anywhere text-sm font-medium text-foreground">
                        {dataSet.name}
                      </span>
                      <span className="truncate text-xs leading-snug text-muted-foreground">
                        {dataSet.optionCount} saved {dataSet.optionCount === 1 ? "value" : "values"}
                      </span>
                    </span>
                    <Checkbox
                      checked={variableIds.has(dataSet.id)}
                      onCheckedChange={(checked) =>
                        toggle(setVariableIds, dataSet.id, checked === true)
                      }
                    />
                  </ChoiceLabel>
                ))}
              </fieldset>
            ) : null}
          </div>
          {save.error ? (
            <FieldError>
              {save.error instanceof Error ? save.error.message : "Relay could not save this plan."}
            </FieldError>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button
              type="submit"
              variant="default"
              disabled={!name.trim() || !testIds.size || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Remove the Plan grouping; its Tests and Reports stay. Opened from the
 * Plan's overflow menu so a destructive action never sits in the page body. */
export function PlanRemoveDialog({
  appId,
  suiteId,
  value,
  open: removeOpen,
  onOpenChange: setRemoveOpen,
}: {
  appId: string;
  suiteId: string;
  value: ProductSuite;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { suiteProfileService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () =>
      suiteProfileService.removeSuite({
        appMapId: appId,
        suiteId,
        expectedRevision: value.appMapRevision,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suites"] });
      await navigate({ to: "/tests", search: { view: "plans" } });
    },
  });
  return (
    <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Remove {value.name}?</DialogTitle>
        <DialogDescription>
          This removes the plan grouping. Its tests and reports stay in the app.
        </DialogDescription>
        {remove.error ? (
          <FieldError>
            {remove.error instanceof Error
              ? remove.error.message
              : "Relay could not remove this plan."}
          </FieldError>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? "Removing…" : "Remove plan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Edit stays one click; removal waits behind the overflow menu. */
export function PlanHeaderActions({ onEdit, onRemove }: { onEdit(): void; onRemove(): void }) {
  return (
    <>
      <Button variant="ghost" onClick={onEdit}>
        Edit plan
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" />}
          aria-label="More plan actions"
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <Trash2 aria-hidden="true" /> Remove plan…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
