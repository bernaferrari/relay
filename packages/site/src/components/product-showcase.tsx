"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowUpRight, GitBranch, Images, Play } from "lucide-react";
import { Button, buttonVariants } from "@relay/ui-react/components/button";

const views = [
  {
    id: "run",
    label: "Run",
    icon: Play,
    src: "/images/relay-run.webp",
    alt: "Relay running its local demo: saved steps and a successful layout check",
    caption: "Follow each action and see its result.",
  },
  {
    id: "review",
    label: "Review",
    icon: Images,
    src: "/images/relay-review.webp",
    alt: "Relay's screenshot review with a captured Workspace settings screen from the demo",
    caption: "Review captured screens and keep a decision.",
  },
  {
    id: "map",
    label: "Map",
    icon: GitBranch,
    src: "/images/relay-map.webp",
    alt: "Relay's app map connecting the demo's sign-in and settings screens",
    caption: "See the screens reached and how they connect.",
  },
] as const;

/** Screens captured from the production UI against an owned, local demo. */
export function ProductShowcase() {
  const [activeId, setActiveId] = useState<(typeof views)[number]["id"]>("run");
  const active = views.find((view) => view.id === activeId)!;
  return (
    <figure id="workspace" className="m-0 scroll-mt-8">
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-1 border-b bg-muted/40 p-1 sm:gap-2 sm:px-4 sm:py-2">
          <div role="group" aria-label="Workspace preview" className="flex items-center sm:gap-1">
            {views.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={activeId === id ? "outline" : "ghost"}
                aria-pressed={activeId === id}
                onClick={() => setActiveId(id)}
                className="h-11"
              >
                <Icon />
                <span>{label}</span>
              </Button>
            ))}
          </div>
          <a
            href={active.src}
            target="_blank"
            rel="noreferrer"
            aria-label="View full size"
            className={buttonVariants({ variant: "ghost", className: "h-11 w-11 sm:w-auto" })}
          >
            <span className="hidden sm:inline">View full size</span>{" "}
            <ArrowUpRight className="size-4" />
          </a>
        </div>
        <div>
          {views.map((view, index) => (
            <Image
              key={view.id}
              src={view.src}
              alt={view.alt}
              width={1280}
              height={900}
              priority={index === 0}
              loading={index === 0 ? undefined : "eager"}
              className={view.id === activeId ? "block h-auto w-full" : "hidden"}
            />
          ))}
        </div>
      </div>
      <figcaption className="mt-4 flex min-h-14 flex-col justify-between gap-1 text-xs leading-relaxed text-muted-foreground sm:min-h-6 sm:flex-row sm:gap-4">
        <span aria-live="polite">{active.caption}</span>
        <span className="shrink-0">Actual Relay UI · local demo data</span>
      </figcaption>
    </figure>
  );
}
