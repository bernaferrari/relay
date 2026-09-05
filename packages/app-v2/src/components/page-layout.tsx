/** @jsxImportSource react */
import type { ComponentProps, ReactNode } from "react";

type PageProps = ComponentProps<"section">;

function Page({ pattern, className = "", ...props }: PageProps & { pattern: string }) {
  return (
    <section
      {...props}
      className={`relay-page relay-page-layout mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 ${pattern === "library" ? "max-w-[1440px]" : pattern === "form" ? "max-w-[1040px]" : "max-w-none"} ${className}`}
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
  description,
  actions,
  children,
}: {
  title: ReactNode;
  context?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relay-workspace-header mt-3 mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 max-[720px]:gap-3">
      <div className="relay-workspace-heading min-w-0 flex-[1_1_280px]">
        {context ? (
          <div className="relay-workspace-context flex flex-wrap gap-x-3 gap-y-2 text-xs text-muted-foreground">
            {context}
          </div>
        ) : null}
        <h1 className="mt-1.5 text-[clamp(24px,2.2vw,30px)] leading-[1.2] font-semibold tracking-tight wrap-anywhere">
          {title}
        </h1>
        {description ? (
          <p className="relay-page-description mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="relay-workspace-actions flex flex-wrap items-center gap-2 pt-1.5 max-[720px]:w-full">
          {actions}
        </div>
      ) : null}
      {children ? (
        <div className="relay-workspace-header-footer min-w-0 basis-full">{children}</div>
      ) : null}
    </header>
  );
}

export function WorkbenchPanes({
  outline,
  stage,
  inspector,
}: {
  outline: ReactNode;
  stage: ReactNode;
  inspector?: ReactNode;
}) {
  return (
    <div
      className={`relay-workspace-panes grid items-start gap-4 max-[720px]:grid-cols-1 ${inspector ? "min-[1101px]:grid-cols-[minmax(230px,0.85fr)_minmax(0,1.25fr)_minmax(280px,1fr)] min-[721px]:max-[1100px]:grid-cols-[minmax(200px,0.7fr)_minmax(0,1.6fr)]" : "min-[721px]:grid-cols-[minmax(210px,0.65fr)_minmax(0,1.6fr)]"}`}
      data-inspector={Boolean(inspector)}
    >
      <div className="relay-workspace-outline min-w-0">{outline}</div>
      <div className="relay-workspace-stage min-w-0">{stage}</div>
      {inspector ? (
        <div className="relay-workspace-inspector min-w-0 max-[1100px]:col-span-full">
          {inspector}
        </div>
      ) : null}
    </div>
  );
}
