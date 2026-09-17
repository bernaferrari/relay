/** @jsxImportSource react */
import type { ComponentProps, ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "./product-patterns";

type PageProps = ComponentProps<"section">;

function Page({ pattern, className = "", ...props }: PageProps & { pattern: string }) {
  return (
    <section
      {...props}
      className={`mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 ${pattern === "library" ? "max-w-7xl" : pattern === "form" ? "max-w-5xl" : "max-w-none"} ${className}`}
      data-page-pattern={pattern}
    />
  );
}

export function LibraryPage(props: PageProps) {
  return <Page {...props} pattern="library" />;
}

export function FormPage(props: PageProps) {
  return <Page {...props} pattern="form" />;
}

export function WorkbenchPage(props: PageProps) {
  return <Page {...props} pattern="workbench" />;
}

export function PageHeader({
  title,
  context,
  crumbs,
  description,
  actions,
  children,
  titleHidden = false,
}: {
  title: ReactNode;
  context?: ReactNode;
  crumbs?: readonly BreadcrumbItem[];
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  titleHidden?: boolean;
}) {
  const eyebrow = crumbs?.length ? <Breadcrumbs items={crumbs} /> : context;
  return (
    <header data-slot="page-header" className="mb-6">
      {eyebrow ? (
        <div
          data-slot="page-context"
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground"
        >
          {eyebrow}
        </div>
      ) : null}
      <div
        data-slot="page-title-row"
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 ${eyebrow ? "mt-1" : ""}`}
      >
        <h1
          className={`${titleHidden ? "sr-only" : ""} min-w-0 min-w-60 flex-1 text-3xl leading-8 font-semibold tracking-tight wrap-anywhere`}
        >
          {title}
        </h1>
        {actions ? (
          <div data-slot="page-actions" className="flex flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {description ? (
        <p
          data-slot="page-description"
          className="mt-1.5 max-w-prose text-sm leading-5 text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4 min-w-0">{children}</div> : null}
    </header>
  );
}

export function WorkbenchPanes({
  outline,
  stage,
  inspector,
  inspectorKind = "form",
}: {
  outline: ReactNode;
  stage: ReactNode;
  inspector?: ReactNode;
  inspectorKind?: "form" | "device";
}) {
  const device = inspectorKind === "device";
  return (
    <div
      className={`grid items-start gap-4 max-[720px]:grid-cols-1 ${
        inspector
          ? device
            ? "min-[900px]:grid-cols-[minmax(210px,0.7fr)_minmax(0,1fr)_360px]"
            : "min-[1101px]:grid-cols-[minmax(230px,0.85fr)_minmax(0,1.25fr)_minmax(280px,1fr)] min-[721px]:max-[1100px]:grid-cols-[minmax(200px,0.7fr)_minmax(0,1.6fr)]"
          : "min-[721px]:grid-cols-[minmax(210px,0.65fr)_minmax(0,1.6fr)]"
      }`}
      data-inspector={Boolean(inspector)}
      data-inspector-kind={inspector ? inspectorKind : undefined}
    >
      <div className="min-w-0">{outline}</div>
      <div className="min-w-0">{stage}</div>
      {inspector ? (
        <div
          className={`min-w-0 ${
            device
              ? "max-[899px]:order-first min-[900px]:sticky min-[900px]:top-4"
              : "max-[1100px]:col-span-full"
          }`}
        >
          {inspector}
        </div>
      ) : null}
    </div>
  );
}
