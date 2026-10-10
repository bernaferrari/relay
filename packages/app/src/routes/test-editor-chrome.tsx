/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ProductTestEditorDocument } from "../data/test-editor-product-service";
import { TestEditorDoneButton } from "./test-editor-done-button";
import { TestEditorSettingsPanel } from "./test-editor-page-sections";

export function TestEditorChrome({
  embedded,
  editorDocument,
  saveState,
  saving,
  hasUnsavedChanges,
  hasUnsavedCheckpoint,
  onLeave,
  settingsName,
  settingsOrigin,
  settingsOpen,
  settingsSaving,
  settingsError,
  onNameChange,
  onOriginChange,
  onSettingsOpenChange,
  onSaveSettings,
}: {
  embedded: boolean;
  editorDocument?: ProductTestEditorDocument;
  saveState: ReactNode;
  saving: boolean;
  hasUnsavedChanges: boolean;
  hasUnsavedCheckpoint: boolean;
  onLeave(): void;
  settingsName: string;
  settingsOrigin: string;
  settingsOpen: boolean;
  settingsSaving: boolean;
  settingsError?: unknown;
  onNameChange(name: string): void;
  onOriginChange(origin: string): void;
  onSettingsOpenChange(open: boolean | ((current: boolean) => boolean)): void;
  onSaveSettings(): void;
}) {
  return (
    <>
      {embedded ? (
        <TestEditorDoneButton
          saving={saving}
          hasUnsavedChanges={hasUnsavedChanges}
          hasUnsavedCheckpoint={hasUnsavedCheckpoint}
          onLeave={onLeave}
          showDoneButton={false}
        />
      ) : null}
      {embedded ? null : (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold" title={editorDocument?.test.name}>
              {editorDocument?.test.name ?? "Edit test"}
            </h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {editorDocument?.appName}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saveState}
            <Button
              size="icon-sm"
              aria-label="Test settings"
              title="Test settings"
              variant="ghost"
              onClick={() => onSettingsOpenChange((open) => !open)}
            >
              <Settings2 aria-hidden="true" />
            </Button>
            <TestEditorDoneButton
              saving={saving}
              hasUnsavedChanges={hasUnsavedChanges}
              hasUnsavedCheckpoint={hasUnsavedCheckpoint}
              onLeave={onLeave}
            />
          </div>
        </header>
      )}
      <TestEditorSettingsPanel
        name={settingsName}
        originApplication={settingsOrigin}
        open={settingsOpen}
        saving={settingsSaving}
        error={settingsError}
        onNameChange={(name) => {
          onNameChange(name);
        }}
        onOriginChange={(origin) => {
          onOriginChange(origin);
        }}
        onOpenChange={onSettingsOpenChange}
        onRetry={() => onSaveSettings()}
        onSave={() => onSaveSettings()}
      />
    </>
  );
}
