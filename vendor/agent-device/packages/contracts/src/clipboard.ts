/**
 * Closed result of the `clipboard` command. Mirrors the dispatch handler's
 * literal return exactly (src/core/dispatch.ts `handleClipboardCommand`): a
 * discriminated union on `action`.
 */
export type ClipboardCommandResult =
  | {
      action: 'read';
      text: string;
    }
  | {
      action: 'write';
      textLength: number;
      message: string;
    }
  | {
      action: 'paste' | 'copy';
      text: string;
      textLength: number;
      message: string;
    };
