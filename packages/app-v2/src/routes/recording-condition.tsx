/** @jsxImportSource react */
import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldLabel } from "@relay/ui-react/components/field";
import { Input } from "@relay/ui-react/components/input";
import { Hourglass } from "lucide-react";
import type { RecordingCondition as Condition } from "../data/recording-product-service";

const WAIT_CHOICES = [30, 60, 120] as const;

/**
 * Slow results (an image, a video, a model's answer) need "wait until this
 * shows up", not a fixed pause. Added while recording, it runs on the live
 * page right away, so the person sees that it holds before saving.
 */
export function RecordingCondition({
  open,
  onOpenChange,
  disabled,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  disabled: boolean;
  pending: boolean;
  error?: string;
  onSubmit(condition: Condition): void;
}) {
  const [kind, setKind] = useState<Condition["kind"]>("wait");
  const [text, setText] = useState("");
  const [seconds, setSeconds] = useState<number>(60);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || pending) return;
    onSubmit({ kind, text: text.trim(), timeoutMs: (kind === "wait" ? seconds : 10) * 1000 });
  }
  const choice = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      active
        ? "border-brand bg-brand-soft text-foreground"
        : "border-border text-muted-foreground hover:border-brand/40 hover:text-foreground"
    }`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" disabled={disabled} title="Wait for something or check it">
            <Hourglass aria-hidden="true" /> Wait or check
          </Button>
        }
      />
      <DialogContent showCloseButton={false}>
        <DialogTitle>Wait or check</DialogTitle>
        <DialogDescription>
          Relay tries it on the page now and adds it as a step. A wait stops as soon as the text
          shows up.
        </DialogDescription>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
            {(
              [
                ["wait", "Wait until it appears"],
                ["check", "Check it is on screen"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={choice(kind === value)}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Field>
            <FieldLabel htmlFor="condition-text">Text on screen</FieldLabel>
            <Input
              id="condition-text"
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              placeholder="For example, 144 or Download"
              maxLength={200}
              autoComplete="off"
              autoFocus
            />
          </Field>
          {kind === "wait" ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Give up after</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Give up after">
                {WAIT_CHOICES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={seconds === value}
                    className={choice(seconds === value)}
                    onClick={() => setSeconds(value)}
                  >
                    {value < 60 ? `${value} seconds` : `${value / 60} minute${value > 60 ? "s" : ""}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button type="submit" disabled={!text.trim() || pending}>
              {pending ? (kind === "wait" ? "Waiting…" : "Checking…") : "Add step"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
