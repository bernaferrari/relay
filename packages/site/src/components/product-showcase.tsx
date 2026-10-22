"use client";

import { useState } from "react";
import Image from "next/image";
import { GitBranch, Images, Play } from "lucide-react";

const views = [
  {
    id: "run",
    label: "Run",
    icon: Play,
    src: "/images/relay-run.webp",
    alt: "A passing Relay run of a checkout test: saved steps and the screen each one reached",
    title: "Follow every action.",
    caption: "Each step, its timing, and the screen it reached, in order.",
  },
  {
    id: "review",
    label: "Review",
    icon: Images,
    src: "/images/relay-review.webp",
    alt: "Relay's screenshot review with a captured checkout screen",
    title: "Decide on every screen.",
    caption: "Accept what looks right, flag what doesn't, and keep the decision.",
  },
  {
    id: "map",
    label: "Map",
    icon: GitBranch,
    src: "/images/relay-map.webp",
    alt: "Relay's app map connecting a product page to checkout",
    title: "See how screens connect.",
    caption: "The screens your tests reached, and the paths between them.",
  },
] as const;

/** Screens captured from the production UI against a sample store. */
export function ProductShowcase() {
  const [activeId, setActiveId] = useState<(typeof views)[number]["id"]>("run");
  return (
    <figure
      id="workspace"
      className="m-0 grid scroll-mt-24 gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10"
    >
      <div
        role="group"
        aria-label="Workspace preview"
        className="flex gap-1 rounded-xl border bg-muted/60 p-1 lg:flex-col lg:gap-2 lg:border-0 lg:bg-transparent lg:p-0"
      >
        {views.map(({ id, label, icon: Icon, title, caption }) => {
          const active = activeId === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveId(id)}
              className={`group flex-1 rounded-lg border px-3 py-2.5 text-left lg:rounded-xl lg:p-4 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex-none ${active ? "border-border bg-card shadow-sm" : "border-transparent hover:bg-muted"}`}
            >
              <span
                className={`flex items-center justify-center gap-2 text-sm font-medium lg:justify-start lg:text-xs ${active ? "text-foreground lg:text-muted-foreground" : "text-muted-foreground"}`}
              >
                <Icon className={`size-3.5 ${active ? "text-primary" : ""}`} />
                {label}
              </span>
              <span className="mt-2 hidden text-sm font-semibold tracking-tight lg:block">
                {title}
              </span>
              <span className="mt-1 hidden text-[0.8rem] leading-relaxed text-muted-foreground lg:block">
                {caption}
              </span>
            </button>
          );
        })}
      </div>
      <div>
        <div className="overflow-hidden rounded-2xl border bg-[#0d0f14] p-1.5 shadow-[0_30px_70px_-35px_color-mix(in_oklch,var(--ribbon-blue)_45%,transparent)]">
          {views.map((view, index) => (
            <Image
              key={view.id}
              src={view.src}
              alt={view.alt}
              width={1280}
              height={900}
              sizes="(min-width: 1024px) 860px, 100vw"
              priority={index === 0}
              loading={index === 0 ? undefined : "eager"}
              className={view.id === activeId ? "block h-auto w-full rounded-xl" : "hidden"}
            />
          ))}
        </div>
        <figcaption className="mt-3 flex justify-between gap-4 text-xs text-muted-foreground">
          <span className="lg:hidden">{views.find((v) => v.id === activeId)!.caption}</span>
          <span className="hidden lg:inline">
            Actual Relay UI, testing a sample store.
          </span>
        </figcaption>
      </div>
    </figure>
  );
}
