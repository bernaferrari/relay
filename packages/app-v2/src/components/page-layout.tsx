/** @jsxImportSource react */
import type { ComponentProps, ReactNode } from "react";

type PageProps = ComponentProps<"section">;

function Page({ pattern, className = "", ...props }: PageProps & { pattern: string }) {
  return <section {...props} className={`relay-page relay-page-layout ${className}`} data-page-pattern={pattern} />;
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

export function PageHeader({ title, context, description, actions, children }: {
  title: ReactNode;
  context?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="relay-workspace-header">
      <div className="relay-workspace-heading">
        {context ? <div className="relay-workspace-context">{context}</div> : null}
        <h1>{title}</h1>
        {description ? <p className="relay-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="relay-workspace-actions">{actions}</div> : null}
      {children ? <div className="relay-workspace-header-footer">{children}</div> : null}
    </header>
  );
}

export function WorkbenchPanes({ outline, stage, inspector }: {
  outline: ReactNode;
  stage: ReactNode;
  inspector?: ReactNode;
}) {
  return <div className="relay-workspace-panes" data-inspector={Boolean(inspector)}>
    <div className="relay-workspace-outline">{outline}</div>
    <div className="relay-workspace-stage">{stage}</div>
    {inspector ? <div className="relay-workspace-inspector">{inspector}</div> : null}
  </div>;
}
