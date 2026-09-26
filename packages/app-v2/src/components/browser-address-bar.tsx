/** @jsxImportSource react */
import { useId, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import type { LiveTargetInput } from "../data/live-target-session";

export function browserAddress(value: string): string {
  const address = value.trim();
  if (!address) throw new Error("Enter a web address.");
  const local = /^(localhost(?=[:/]|$)|127\.|\[::1\])/i.test(address);
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(address) && !local;
  const url = new URL(hasScheme ? address : `${local ? "http" : "https"}://${address}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use an http or https address.");
  }
  return url.href;
}

export function BrowserAddressBar({
  url = "",
  disabled,
  send,
  trailing,
}: {
  url?: string;
  trailing?: ReactNode;
  disabled: boolean;
  send: (input: LiveTargetInput) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorId = useId();
  async function navigate(input: LiveTargetInput) {
    setPending(true);
    try {
      if (await send(input)) {
        setDraft(null);
        setError("");
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="shrink-0 px-3 py-2"
      aria-label="Browser navigation"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || pending) return;
        try {
          const destination = browserAddress(draft ?? url);
          setError("");
          void navigate({ kind: "navigate", url: destination });
        } catch {
          setError("Enter a valid http or https address.");
        }
      }}
    >
      <div className="flex items-center gap-1">
        {(["back", "forward", "reload"] as const).map((direction) => {
          const Icon =
            direction === "back" ? ArrowLeft : direction === "forward" ? ArrowRight : RotateCw;
          const label =
            direction === "back" ? "Back" : direction === "forward" ? "Forward" : "Reload";
          return (
            <Button
              key={direction}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={label}
              title={label}
              disabled={disabled || pending}
              onClick={() => void navigate({ kind: "history", direction })}
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          );
        })}
        <Input
          aria-label="Web address"
          className="ml-1 h-8 min-w-0 flex-1 bg-background/60 text-sm"
          value={draft ?? url}
          placeholder="Enter a web address"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(null);
              setError("");
              event.currentTarget.blur();
            }
          }}
        />
        {trailing}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 pl-28 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
