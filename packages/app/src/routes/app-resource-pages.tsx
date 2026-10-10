/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { RotateCcw } from "lucide-react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { RecoveryState } from "../components/product-patterns";

export function AppResourceFrame({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LibraryPage className="max-w-5xl">
      <PageHeader title={title} description={description} actions={action} />
      {children}
    </LibraryPage>
  );
}

export function ResourceRecovery({
  detail,
  retrying,
  onRetry,
}: {
  detail: string;
  retrying: boolean;
  onRetry(): void;
}) {
  return (
    <RecoveryState
      layout="centered"
      title="Could not load resources"
      detail={detail}
      action={
        <Button variant="outline" onClick={onRetry} disabled={retrying}>
          <RotateCcw aria-hidden="true" />
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      }
    />
  );
}
