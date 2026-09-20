import { AppError } from '@agent-device/kernel/errors';
import type { ElementSelectorKey, Interactor, RunnerContext } from './interactor-types.ts';
import type { RuntimeOperationFact, RuntimeOperationUnavailability } from './platform-runtime.ts';
import type { SnapshotRuntimeExecution } from './snapshot-runtime.ts';

/**
 * Neutral intent for one clipboard read. The operation names no command, request, session, or CLI
 * flag: `clipboard read`'s whole input is the runner metadata every request-bound operation
 * forwards, which is why the read and the write share this base.
 */
export type ClipboardReadInput = Readonly<{
  options?: Readonly<{ appBundleId?: string }>;
  /** Same runner metadata a capture needs; reuses that type rather than restating it. */
  execution?: SnapshotRuntimeExecution;
}>;

/**
 * One clipboard write. `text` is already joined and validated by the caller (`clipboard write`
 * accepts `""` to clear), so the owner receives content, never argv.
 */
export type ClipboardWriteInput = ClipboardReadInput & Readonly<{ text: string }>;

/** One atomic field selector, exactly as the runner commands accept it. */
export type ClipboardFieldSelector = Readonly<{
  key: ElementSelectorKey;
  value: string;
}>;

/**
 * One verified field paste inside a single runner command.
 *
 * The command **replaces the entire field** with `text` (empty `text` clears
 * the field). It is not insert-at-caret, not replace-selection, and not a
 * rollback-capable transaction: the runner may switch to its probe app, write
 * the pasteboard, and reactivate the product before Paste. Those intermediate
 * changes remain if a later step fails. A lost response after Paste was
 * dispatched is outcome-unknown — the host must not send the command again.
 *
 * Physical iOS clears runner-owned pasteboard data when a one-command test
 * process exits, so the write and the paste cannot be two requests.
 */
export type ClipboardPasteInput = ClipboardReadInput &
  Readonly<{ text: string; selector: ClipboardFieldSelector }>;

/**
 * One atomic copy: select the field's text through the real edit menu, copy it, and
 * return the copied text — optionally verified against `expectedText` — before the
 * runner process exits.
 */
export type ClipboardCopyInput = ClipboardReadInput &
  Readonly<{ selector: ClipboardFieldSelector; expectedText?: string }>;

export type ClipboardReadRuntimeOperations = Readonly<{
  readClipboard(input: ClipboardReadInput): Promise<string>;
}>;

/**
 * The write returns nothing. The retired leaf discarded whatever the interactor answered and
 * reported only the length of the text it sent, so a result type here would be a surface the
 * command never had.
 */
export type ClipboardWriteRuntimeOperations = Readonly<{
  writeClipboard(input: ClipboardWriteInput): Promise<void>;
}>;

export type ClipboardPasteRuntimeOperations = Readonly<{
  pasteClipboard(input: ClipboardPasteInput): Promise<string>;
}>;

export type ClipboardCopyRuntimeOperations = Readonly<{
  copyClipboard(input: ClipboardCopyInput): Promise<string>;
}>;

export type ClipboardRuntimeOperations = ClipboardReadRuntimeOperations &
  ClipboardWriteRuntimeOperations &
  ClipboardPasteRuntimeOperations &
  ClipboardCopyRuntimeOperations;

export type ClipboardRuntimeOperationFacts = Readonly<{
  readClipboard: RuntimeOperationFact;
  writeClipboard: RuntimeOperationFact;
  pasteClipboard: RuntimeOperationFact;
  copyClipboard: RuntimeOperationFact;
}>;

/**
 * What an owner declares about the clipboard. Read and write stay separate cells because an owner
 * can genuinely have one without the other — a WebDriver provider whose Appium clipboard extension
 * exposes only a getter is the real case — and `clipboard read` must not be refused because the
 * write half is missing.
 *
 * Both halves ride one shell command set on every other owner, so an owner with neither names
 * `unsupported` once and a half it never names reports that denial verbatim: omission is a
 * classified refusal, never an unclassified half and never an implied success. An owner states a
 * half only to say something the family denial does not.
 */
export type ClipboardRuntimeOperationFactsInput = Readonly<{
  unsupported: RuntimeOperationUnavailability;
  read?: RuntimeOperationFact;
  write?: RuntimeOperationFact;
  /**
   * The field-oriented paste/copy commands exist only where a runner can
   * perform them in one verified command; owners that name neither leave
   * both cells to the family denial above.
   */
  paste?: RuntimeOperationFact;
  copy?: RuntimeOperationFact;
}>;

/** Builds the exhaustive owner claims for the clipboard operations. */
export function clipboardRuntimeOperationFacts(
  input: ClipboardRuntimeOperationFactsInput,
): ClipboardRuntimeOperationFacts {
  const declared = (fact: RuntimeOperationFact | undefined): RuntimeOperationFact =>
    fact ?? input.unsupported;
  return Object.freeze({
    readClipboard: declared(input.read),
    writeClipboard: declared(input.write),
    pasteClipboard: declared(input.paste),
    copyClipboard: declared(input.copy),
  });
}

/**
 * Captures one selected owner's interactor authority for the lifetime of a request binding. The
 * owner is already chosen by the time a binder is called, so each entry point supplies its own
 * resolution and this holds only what both operations share: the runner context.
 */
async function resolveClipboardInteractor(
  signal: AbortSignal,
  resolveInteractor: (runner: RunnerContext) => Promise<Interactor>,
  input: ClipboardReadInput,
): Promise<Interactor> {
  signal.throwIfAborted();
  return await resolveInteractor({
    ...input.execution,
    appBundleId: input.options?.appBundleId,
    signal,
  });
}

export function bindClipboardRead(
  signal: AbortSignal,
  resolveInteractor: (runner: RunnerContext) => Promise<Interactor>,
): ClipboardReadRuntimeOperations {
  return Object.freeze({
    readClipboard: async (input: ClipboardReadInput) => {
      const interactor = await resolveClipboardInteractor(signal, resolveInteractor, input);
      return await interactor.readClipboard();
    },
  });
}

export function bindClipboardWrite(
  signal: AbortSignal,
  resolveInteractor: (runner: RunnerContext) => Promise<Interactor>,
): ClipboardWriteRuntimeOperations {
  return Object.freeze({
    writeClipboard: async (input: ClipboardWriteInput) => {
      const interactor = await resolveClipboardInteractor(signal, resolveInteractor, input);
      await interactor.writeClipboard(input.text);
    },
  });
}

export function bindClipboardPaste(
  signal: AbortSignal,
  resolveInteractor: (runner: RunnerContext) => Promise<Interactor>,
): ClipboardPasteRuntimeOperations {
  return Object.freeze({
    pasteClipboard: async (input: ClipboardPasteInput) => {
      const interactor = await resolveClipboardInteractor(signal, resolveInteractor, input);
      if (!interactor.pasteClipboard) {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'atomic clipboard paste is unavailable on this backend',
        );
      }
      return await interactor.pasteClipboard(input.text, input.selector);
    },
  });
}

export function bindClipboardCopy(
  signal: AbortSignal,
  resolveInteractor: (runner: RunnerContext) => Promise<Interactor>,
): ClipboardCopyRuntimeOperations {
  return Object.freeze({
    copyClipboard: async (input: ClipboardCopyInput) => {
      const interactor = await resolveClipboardInteractor(signal, resolveInteractor, input);
      if (!interactor.copyClipboard) {
        throw new AppError(
          'UNSUPPORTED_OPERATION',
          'atomic clipboard copy is unavailable on this backend',
        );
      }
      return await interactor.copyClipboard(input.selector, input.expectedText);
    },
  });
}
