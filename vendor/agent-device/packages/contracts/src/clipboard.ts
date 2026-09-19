/**
 * Closed result of the `clipboard` command. Mirrors the session runtime's
 * literal return exactly (`src/daemon/handlers/session-clipboard.ts`): a
 * discriminated union on `action`. `read` returns the clipboard `text`; `write`
 * reports the written `textLength` plus the `successText` message. The handler
 * spreads nothing else, so each branch is closed.
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
      /** Relay fork: the atomic field transactions return the transferred text. */
      action: 'paste' | 'copy';
      text: string;
      textLength: number;
      message: string;
    };
