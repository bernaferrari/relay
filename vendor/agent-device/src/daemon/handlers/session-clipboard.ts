import type {
  ClipboardCopyInput,
  ClipboardPasteInput,
  ClipboardReadInput,
  ClipboardWriteInput,
} from '@agent-device/contracts/clipboard-runtime';
import {
  clipboardCopyUse,
  clipboardPasteUse,
  clipboardReadUse,
  clipboardWriteUse,
} from '@agent-device/contracts/platform-runtime-operations';
import type { BoundDeviceRuntime } from '@agent-device/contracts/platform-runtime';
import { publicPlatformString, type DeviceInfo } from '@agent-device/kernel/device';
import { AppError } from '@agent-device/kernel/errors';
import { PUBLIC_COMMANDS } from '@agent-device/command-registry/catalog';
import { contextFromFlags, type DaemonCommandContext } from '../context.ts';
import type { DaemonRequest, DaemonResponse } from '../daemon-request.ts';
import type { SessionStore } from '../session-store.ts';
import type { BindDeviceRuntime, InspectDeviceRuntimeFacts } from '../request-runtime-binding.ts';
import { admitRuntimeUse, type RuntimeAdmissionBindings } from '../runtime-admission.ts';
import { runtimeExecutionFromContext } from '../snapshot-runtime-capture-input.ts';
import { successText } from '@agent-device/kernel/success-text';
import { errorResponse, type DaemonFailureResponse } from '../response.ts';
import { recordSessionAction } from '../session-action-recorder.ts';
import {
  requireSessionOrExplicitSelector,
  resolveCommandDevice,
} from '../session-device-resolution.ts';

type ClipboardAction = 'read' | 'write' | 'paste' | 'copy';

/**
 * What the admit-then-bind step reports: either the refusal an unadmitted cell produced — nothing
 * has touched the device yet — or the one bound invocation to run. Mirrors
 * {@link ResolvedKeyboardExecution}'s shape for the same reason: the plan is chosen from the
 * parsed action, and only the chosen leg ever binds.
 */
type ResolvedClipboardExecution =
  | Readonly<{ ok: false; response: DaemonFailureResponse }>
  | Readonly<{
      ok: true;
      execute: (context: DaemonCommandContext) => Promise<Record<string, unknown>>;
    }>;

/**
 * `clipboard <read|write>`, on the same parse the retired leaf used. The subcommand is read
 * before any device is resolved, exactly as the retired daemon handler did, so a typo still
 * fails as `INVALID_ARGS` without waking a device.
 */
function readClipboardAction(positionals: readonly string[]): ClipboardAction | undefined {
  const action = (positionals[0] ?? '').toLowerCase();
  return action === 'read' || action === 'write' || action === 'paste' || action === 'copy'
    ? action
    : undefined;
}

/** The four selector keys a paste/copy field selector accepts, shared by parse and validation. */
const CLIPBOARD_SELECTOR_KEYS = ['id', 'label', 'text', 'value'] as const;

function clipboardSelectorKey(raw: string): (typeof CLIPBOARD_SELECTOR_KEYS)[number] {
  if (!(CLIPBOARD_SELECTOR_KEYS as readonly string[]).includes(raw)) {
    throw new AppError(
      'INVALID_ARGS',
      `clipboard selector key must be one of: ${CLIPBOARD_SELECTOR_KEYS.join(', ')}`,
    );
  }
  return raw as (typeof CLIPBOARD_SELECTOR_KEYS)[number];
}

function clipboardInput(context: DaemonCommandContext): ClipboardReadInput {
  return {
    ...(context.appBundleId === undefined ? {} : { options: { appBundleId: context.appBundleId } }),
    execution: runtimeExecutionFromContext(context),
  };
}

/**
 * `clipboard read`. The argument check stays inside the bound execution rather than moving ahead
 * of admission: the retired leaf validated it in `dispatchCommand`, downstream of the capability
 * gate, so an over-argued read on an unsupported device must still report the unsupported cell.
 */
async function executeClipboardRead(
  runtime: BoundDeviceRuntime<typeof clipboardReadUse>,
  context: DaemonCommandContext,
  positionals: readonly string[],
): Promise<Record<string, unknown>> {
  if (positionals.length !== 1) {
    throw new AppError('INVALID_ARGS', 'clipboard read does not accept additional arguments');
  }
  const text = await runtime.operations.readClipboard(clipboardInput(context));
  return { action: 'read', text };
}

/** `clipboard write <text…>`; `""` clears, so an empty string is a value, not a missing argument. */
async function executeClipboardWrite(
  runtime: BoundDeviceRuntime<typeof clipboardWriteUse>,
  context: DaemonCommandContext,
  positionals: readonly string[],
): Promise<Record<string, unknown>> {
  if (positionals.length < 2) {
    throw new AppError('INVALID_ARGS', 'clipboard write requires text (use "" to clear clipboard)');
  }
  const text = positionals.slice(1).join(' ');
  const input: ClipboardWriteInput = { ...clipboardInput(context), text };
  await runtime.operations.writeClipboard(input);
  return {
    action: 'write',
    textLength: Array.from(text).length,
    ...successText('Clipboard updated'),
  };
}

/**
 * Relay fork: `clipboard paste <text> <selectorKey> <selectorValue>`. Write and Paste are one
 * verified runner transaction, so the pasteboard cannot be cleared between them.
 */
async function executeClipboardPaste(
  runtime: BoundDeviceRuntime<typeof clipboardPasteUse>,
  context: DaemonCommandContext,
  positionals: readonly string[],
): Promise<Record<string, unknown>> {
  if (positionals.length !== 4) {
    throw new AppError(
      'INVALID_ARGS',
      'clipboard paste requires text, selector key, and selector value',
    );
  }
  const input: ClipboardPasteInput = {
    ...clipboardInput(context),
    text: positionals[1]!,
    selector: {
      key: clipboardSelectorKey(positionals[2]!),
      value: positionals[3]!,
    },
  };
  const pasted = await runtime.operations.pasteClipboard(input);
  return {
    action: 'paste',
    text: pasted,
    textLength: Array.from(pasted).length,
    ...successText('Clipboard pasted'),
  };
}

/** Relay fork: `clipboard copy <selectorKey> <selectorValue> [expectedText]`. */
async function executeClipboardCopy(
  runtime: BoundDeviceRuntime<typeof clipboardCopyUse>,
  context: DaemonCommandContext,
  positionals: readonly string[],
): Promise<Record<string, unknown>> {
  if (positionals.length < 3 || positionals.length > 4) {
    throw new AppError(
      'INVALID_ARGS',
      'clipboard copy requires selector key and selector value, with optional expected text',
    );
  }
  const input: ClipboardCopyInput = {
    ...clipboardInput(context),
    selector: {
      key: clipboardSelectorKey(positionals[1]!),
      value: positionals[2]!,
    },
    ...(positionals[3] !== undefined ? { expectedText: positionals[3] } : {}),
  };
  const copied = await runtime.operations.copyClipboard(input);
  return {
    action: 'copy',
    text: copied,
    textLength: Array.from(copied).length,
    ...successText('Clipboard copied'),
  };
}

/**
 * The one place `clipboard` reaches a device (ADR 0019 §9). Exactly one action-selected use is
 * admitted and bound — one of `read`, `write`, `paste`, or `copy`, never two. Each branch admits
 * its own literal use, so the bound runtime narrows from that instantiation rather than from an
 * assertion. Both name the bare command in their refusal: the retired
 * `requireCommandSupported('clipboard', device)` gate refused per command, not per subcommand,
 * and the wording is parity-pinned.
 */
async function resolveBoundClipboardRuntime(
  params: Readonly<{
    device: DeviceInfo;
    action: ClipboardAction;
    positionals: readonly string[];
  }> &
    RuntimeAdmissionBindings,
): Promise<ResolvedClipboardExecution> {
  const { device, action, positionals, inspectFacts, bindDevice } = params;
  if (action === 'read') {
    const admission = await admitRuntimeUse({
      command: 'clipboard',
      device,
      use: clipboardReadUse,
      inspectFacts,
      bindDevice,
      readiness: {},
    });
    if (admission.type === 'response') return { ok: false, response: admission.response };
    const runtime = admission.runtime;
    return { ok: true, execute: (context) => executeClipboardRead(runtime, context, positionals) };
  }
  if (action === 'paste') {
    const admission = await admitRuntimeUse({
      command: 'clipboard',
      device,
      use: clipboardPasteUse,
      inspectFacts,
      bindDevice,
      readiness: {},
    });
    if (admission.type === 'response') return { ok: false, response: admission.response };
    const runtime = admission.runtime;
    return { ok: true, execute: (context) => executeClipboardPaste(runtime, context, positionals) };
  }
  if (action === 'copy') {
    const admission = await admitRuntimeUse({
      command: 'clipboard',
      device,
      use: clipboardCopyUse,
      inspectFacts,
      bindDevice,
      readiness: {},
    });
    if (admission.type === 'response') return { ok: false, response: admission.response };
    const runtime = admission.runtime;
    return { ok: true, execute: (context) => executeClipboardCopy(runtime, context, positionals) };
  }
  const admission = await admitRuntimeUse({
    command: 'clipboard',
    device,
    use: clipboardWriteUse,
    inspectFacts,
    bindDevice,
    readiness: {},
  });
  if (admission.type === 'response') return { ok: false, response: admission.response };
  const runtime = admission.runtime;
  return { ok: true, execute: (context) => executeClipboardWrite(runtime, context, positionals) };
}

export async function handleSessionClipboardCommand(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  inspectFacts?: InspectDeviceRuntimeFacts;
  bindDevice?: BindDeviceRuntime;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore, inspectFacts, bindDevice } = params;
  const session = sessionStore.get(sessionName);
  const flags = req.flags ?? {};
  const guard = requireSessionOrExplicitSelector(PUBLIC_COMMANDS.clipboard, session, flags);
  if (guard) return guard;

  const positionals = req.positionals ?? [];
  const action = readClipboardAction(positionals);
  if (!action) {
    return errorResponse(
      'INVALID_ARGS',
      'clipboard requires a subcommand: read, write, paste, or copy',
    );
  }

  const device = await resolveCommandDevice({ session, flags });
  const bound = await resolveBoundClipboardRuntime({
    device,
    action,
    positionals,
    inspectFacts,
    bindDevice,
  });
  if (!bound.ok) return bound.response;

  const result = await bound.execute(
    contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath),
  );
  recordSessionAction(sessionStore, session, req, req.command, result);
  return { ok: true, data: { platform: publicPlatformString(device), ...result } };
}
