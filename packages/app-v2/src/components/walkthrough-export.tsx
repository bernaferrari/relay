import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";

export function WalkthroughExport({
  pending,
  run,
  file,
}: {
  pending: boolean;
  run(): void;
  file?: { href: string; fileName: string };
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {file && !pending ? (
        <Button
          variant="secondary"
          size="sm"
          render={<a href={file.href} download={file.fileName} />}
          aria-label="Save walkthrough"
        >
          <Download className="size-4" aria-hidden="true" /> Save walkthrough
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={run}
        aria-label="Export walkthrough"
      >
        {pending ? (
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {pending ? "Preparing…" : "Export"}
      </Button>
    </div>
  );
}
