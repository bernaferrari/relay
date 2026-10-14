"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Copy, Moon, Sun } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 rounded-md"
      aria-label="Toggle color theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

export function CopyExampleCommand({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <span className="inline-flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={state === "copied" ? "Command copied" : "Copy example command"}
        onClick={copy}
        onBlur={() => setState("idle")}
      >
        {state === "copied" ? <Check /> : <Copy />}
      </Button>
      <span role="status" className={state === "failed" ? "text-xs text-destructive" : "sr-only"}>
        {state === "copied"
          ? "Command copied"
          : state === "failed"
            ? "Couldn't copy. Select the command to copy it manually."
            : ""}
      </span>
    </span>
  );
}
