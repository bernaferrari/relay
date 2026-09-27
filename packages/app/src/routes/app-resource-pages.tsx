/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Box, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import type { ProductAppVersion } from "../data/app-resources-product-service";
import { VersionEditorDialog, VersionRow, type VersionDraft } from "./app-resource-dialogs";
import { PageLoading } from "./recording-shared";
import { productLinkClassName } from "../lib/class-names";

export function AppVersionsPage() {
  const { appResourcesService } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<ProductAppVersion | "create">();
  const versions = useQuery({
    queryKey: ["app-resources", "versions"],
    queryFn: () => appResourcesService.listVersions(),
    staleTime: 15_000,
  });
  const error = versions.error;
  const loading = versions.isPending;
  const saveVersion = useMutation({
    mutationFn: async ({ mode, input }: { mode: "create" | "edit"; input: VersionDraft }) => {
      const operation =
        mode === "edit"
          ? (appResourcesService.updateVersion ?? appResourcesService.saveVersion)
          : (appResourcesService.createVersion ?? appResourcesService.saveVersion);
      if (!operation) throw new Error("Version editing is unavailable in this Relay connection.");
      return operation(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "versions"] });
      setEditor(undefined);
    },
  });
  const canWriteVersions = Boolean(
    appResourcesService.createVersion ?? appResourcesService.saveVersion,
  );

  return (
    <AppResourceFrame
      title="Versions"
      description="Builds Relay can run against."
      action={
        canWriteVersions ? (
          <Button variant="default" onClick={() => setEditor("create")}>
            <Plus aria-hidden="true" /> Add version
          </Button>
        ) : undefined
      }
    >
      {loading ? <PageLoading label="Loading registered versions…" /> : null}
      {error ? (
        <ResourceRecovery
          detail="Start Relay, then try loading registered versions again."
          retrying={versions.isFetching}
          onRetry={() => {
            void versions.refetch();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <section aria-label="Versions">
          {versions.data?.length ? (
            <ul className="list-none overflow-hidden rounded-lg border border-border bg-card p-0">
              {versions.data.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  canEdit={Boolean(
                    appResourcesService.updateVersion ?? appResourcesService.saveVersion,
                  )}
                  onEdit={() => setEditor(version)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Box}
              title="No registered versions"
              detail="No mobile build or web deployment has been registered in this workspace yet."
              action={
                <Link className={productLinkClassName} to="/tests">
                  Open Tests
                </Link>
              }
            />
          )}
        </section>
      ) : null}
      {editor ? (
        <VersionEditorDialog
          value={editor === "create" ? undefined : editor}
          pending={saveVersion.isPending}
          error={saveVersion.error}
          onClose={() => {
            if (!saveVersion.isPending) {
              saveVersion.reset();
              setEditor(undefined);
            }
          }}
          onSubmit={(input) =>
            saveVersion.mutate({ mode: editor === "create" ? "create" : "edit", input })
          }
        />
      ) : null}
    </AppResourceFrame>
  );
}

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
      <PageHeader context="Workspace" title={title} description={description} actions={action} />
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
