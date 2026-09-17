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
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Save screenshot"
            title="Save screenshot"
          >
            <Camera aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
      >
        <DialogTitle>Save screenshot</DialogTitle>
        <DialogDescription>
          Screenshots are saved automatically with each step. Save an extra image here without
          interacting with the app.
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
          <div className="flex flex-wrap items-center justify-end gap-2.5">
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
