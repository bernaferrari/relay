import { useEffect, useRef } from "react";
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
  const downloaded = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!file || pending || downloaded.current === file.href) return;
    downloaded.current = file.href;
    const link = document.createElement("a");
    link.href = file.href;
    link.download = file.fileName;
    document.body.append(link);
    link.click();
    link.remove();
  }, [file, pending]);
  return (
    <div className="flex shrink-0 items-center gap-1">
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
