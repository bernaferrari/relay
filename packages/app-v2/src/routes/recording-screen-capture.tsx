import type { FormEvent } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Camera } from "lucide-react";

export function RecordingScreenCapture({
  open,
  onOpenChange,
  disabled,
  pending,
  label,
  onLabelChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  disabled: boolean;
  pending: boolean;
  label: string;
  onLabelChange(label: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" disabled={disabled}>
            <Camera aria-hidden="true" />
            Capture screen
          </Button>
        }
      />
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
      >
        <DialogTitle>Capture this screen</DialogTitle>
        <DialogDescription>
          Save a named screenshot in this recording for review. This does not add a pass/fail check
          when the Test runs.
        </DialogDescription>
        <form onSubmit={onSubmit}>
          <Field>
            <FieldLabel htmlFor="checkpoint-label">Screen name (optional)</FieldLabel>
            <Input
              id="checkpoint-label"
              value={label}
              onChange={(event) => onLabelChange(event.currentTarget.value)}
              placeholder="For example, Order confirmation"
              maxLength={160}
              autoComplete="off"
            />
          </Field>
          <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button type="submit" variant="default" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
