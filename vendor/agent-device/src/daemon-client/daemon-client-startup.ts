import fs from 'node:fs';
import { AppError } from '@agent-device/kernel/errors';
import { withKeyedLock } from '@agent-device/kernel/keyed-lock';
import { runCmdDetachedMonitored, type ExecDetachedExit } from '@agent-device/host-kit/command';
import { shellQuoteIfNeeded } from '@agent-device/kernel/device-shell';
import { sleep } from '@agent-device/host-kit/retry';
import type { DaemonClientSettings } from './daemon-client-lifecycle.ts';
import type { DaemonTransportPreference } from '../daemon-resolution.ts';
import {
  resolveDaemonLaunchSpec,
  resolveDaemonTakeover,
  type DaemonTakeoverDecision,
} from './daemon-launch-spec.ts';
import {
  cleanupFailedDaemonStartupMetadata,
  cleanupStaleDaemonLockIfSafe,
  getDaemonMetadataState,
  readDaemonInfo,
  recoverDaemonLockHolder,
  removeDaemonInfo,
  resolveDaemonStartupHint,
  stopDaemonProcessForTakeover,
  type DaemonInfo,
  type DaemonStartupCleanupResult,
} from './daemon-client-metadata.ts';
import {
  canConnect,
  DAEMON_HTTP_ENDPOINT_UNAVAILABLE_MESSAGE,
  DAEMON_SOCKET_ENDPOINT_UNAVAILABLE_MESSAGE,
  readRemoteDaemonHealth,
} from './daemon-client-transport.ts';

export type EnsuredDaemon = {
  info: DaemonInfo;
  startedByClient: boolean;
};

type DaemonStartupLaunch = {
  pid: number;
  exited: Promise<ExecDetachedExit>;
};

type DaemonStartupWaitResult =
  | { kind: 'ready'; info: DaemonInfo }
  | { kind: 'early_exit'; exit: ExecDetachedExit }
  | { kind: 'timeout' };

const DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DAEMON_STARTUP_ATTEMPTS = 2;
const DAEMON_STARTUP_LOG_TAIL_BYTES = 64_000;
const localDaemonStartupLocks = new Map<string, Promise<unknown>>();

export async function ensureDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
  if (settings.remoteBaseUrl) {
    return await ensureRemoteDaemon(settings);
  }

  return await withKeyedLock(localDaemonStartupLocks, settings.paths.baseDir, async () => {
    const reusable = await readReusableLocalDaemon(settings);
    if (reusable) return { info: reusable, startedByClient: false };

    cleanupStaleDaemonLockIfSafe(settings.paths);
    return await startLocalDaemon(settings);
  });
}

async function ensureRemoteDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
  const remoteInfo: DaemonInfo = {
    transport: 'http',
    // Remote mode reuses the auth token as the daemon token so the existing JSON-RPC contract still works.
    token: settings.remoteAuthToken ?? '',
    pid: 0,
    baseUrl: settings.remoteBaseUrl,
  };
  if ((await readRemoteDaemonHealth(remoteInfo)).reachable) {
    return { info: remoteInfo, startedByClient: false };
  }
  throw new AppError('COMMAND_FAILED', 'Remote daemon is unavailable', {
    daemonBaseUrl: settings.remoteBaseUrl,
    hint: 'Verify AGENT_DEVICE_DAEMON_BASE_URL points to a reachable daemon with GET /health and POST /rpc. If this CLI was connected with connect proxy, run agent-device disconnect to return to the local daemon.',
  });
}

async function readReusableLocalDaemon(settings: DaemonClientSettings): Promise<DaemonInfo | null> {
  const existing = readDaemonInfo(settings.paths.infoPath);
  if (!existing) return null;

  const viaClientTransport = await canConnectReusableDaemon(existing, settings.transportPreference);
  const decision = await resolveDaemonTakeover(existing, {
    viaClientTransport,
    onAnyAdvertisedTransport: async () =>
      viaClientTransport || (await canConnectReusableDaemon(existing, 'auto')),
  });
  if (decision.kind === 'reuse') return existing;
  if (decision.kind === 'refuseNewer') {
    throw newerDaemonRefusedError(existing, decision, settings.paths.baseDir);
  }

  emitDaemonTakeoverNotice(existing, decision.reason, settings.paths.baseDir);
  await stopDaemonProcessForTakeover(existing);
  removeDaemonInfo(settings.paths.infoPath);
  return null;
}

async function canConnectReusableDaemon(
  info: DaemonInfo,
  preference: DaemonTransportPreference,
): Promise<boolean> {
  try {
    return await canConnect(info, preference);
  } catch (error) {
    if (isDaemonTransportUnavailableError(error)) return false;
    throw error;
  }
}

function isDaemonTransportUnavailableError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === 'COMMAND_FAILED' &&
    (error.message === DAEMON_HTTP_ENDPOINT_UNAVAILABLE_MESSAGE ||
      error.message === DAEMON_SOCKET_ENDPOINT_UNAVAILABLE_MESSAGE)
  );
}

function newerDaemonRefusedError(
  info: DaemonInfo,
  decision: Extract<DaemonTakeoverDecision, { kind: 'refuseNewer' }>,
  stateDir: string,
): AppError {
  const { daemonVersion, clientVersion } = decision;
  return new AppError(
    'COMMAND_FAILED',
    `Daemon (pid ${info.pid}, v${daemonVersion}) is newer than this client (v${clientVersion}); refusing to replace it.`,
    {
      daemonPid: info.pid,
      daemonVersion,
      clientVersion,
      hint: `Use the agent-device v${daemonVersion} CLI that started it, or stop it deliberately: agent-device daemon stop --state-dir ${shellQuoteIfNeeded(stateDir)}`,
    },
  );
}

function emitDaemonTakeoverNotice(info: DaemonInfo, reason: string, stateDir: string): void {
  try {
    const identity = info.version ? `pid ${info.pid}, v${info.version}` : `pid ${info.pid}`;
    process.stderr.write(`Replacing daemon (${identity}) in ${stateDir}: ${reason}\n`);
  } catch {
    // The takeover notice is best effort; never fail the command on stderr issues.
  }
}

async function startLocalDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
  let lockRecoveryCount = 0;
  const cleanupResults: DaemonStartupCleanupResult[] = [];
  let startError: string | undefined;
  let daemonProcess: ExecDetachedExit | { pid: number } | undefined;
  for (let attempt = 1; attempt <= DAEMON_STARTUP_ATTEMPTS; attempt += 1) {
    let launch: DaemonStartupLaunch;
    try {
      launch = startDaemon(settings);
      daemonProcess = { pid: launch.pid };
    } catch (error) {
      startError = error instanceof Error ? error.message : String(error);
      cleanupResults.push(await cleanupFailedDaemonStartupMetadata(settings.paths, 'start_error'));
      if (attempt < DAEMON_STARTUP_ATTEMPTS) {
        await sleep(150);
        continue;
      }
      break;
    }

    const startup = await waitForDaemonStartup(DAEMON_STARTUP_TIMEOUT_MS, settings, launch);
    if (startup.kind === 'ready') return { info: startup.info, startedByClient: true };
    if (startup.kind === 'early_exit') {
      daemonProcess = startup.exit;
      startError = describeDaemonEarlyExit(startup.exit);
      cleanupResults.push(await cleanupFailedDaemonStartupMetadata(settings.paths, 'start_error'));
      if (attempt < DAEMON_STARTUP_ATTEMPTS) {
        await sleep(150);
        continue;
      }
      break;
    }

    if (await recoverDaemonLockHolder(settings.paths)) {
      lockRecoveryCount += 1;
      continue;
    }

    const metadataState = getDaemonMetadataState(settings.paths);
    const hasAnotherAttempt = attempt < DAEMON_STARTUP_ATTEMPTS;
    const cleanup = await cleanupFailedDaemonStartupMetadata(settings.paths, 'startup_timeout', {
      stopLiveProcesses: false,
    });
    cleanupResults.push(cleanup);
    if (cleanup.retainedInfoProcess || cleanup.retainedLockProcess) {
      const extended = await waitForDaemonStartup(DAEMON_STARTUP_TIMEOUT_MS, settings, launch);
      if (extended.kind === 'ready') return { info: extended.info, startedByClient: true };
      if (extended.kind === 'early_exit') {
        daemonProcess = extended.exit;
        startError = describeDaemonEarlyExit(extended.exit);
      }
      break;
    }
    if (!hasAnotherAttempt) break;

    // Detached daemon startup can race on busy CI hosts; retry when no metadata exists yet.
    if (!metadataState.hasInfo && !metadataState.hasLock) await sleep(150);
  }

  const state = getDaemonMetadataState(settings.paths);
  const daemonLogTail = readRecentLogTail(settings.paths.logPath);
  throw new AppError('COMMAND_FAILED', 'Failed to start daemon', {
    kind: 'daemon_startup_failed',
    stateDir: settings.paths.baseDir,
    infoPath: settings.paths.infoPath,
    lockPath: settings.paths.lockPath,
    logPath: settings.paths.logPath,
    startupTimeoutMs: DAEMON_STARTUP_TIMEOUT_MS,
    startupAttempts: DAEMON_STARTUP_ATTEMPTS,
    lockRecoveryCount,
    cleanupResults,
    startError,
    daemonProcess,
    ...(daemonLogTail ? { daemonLogTail } : {}),
    metadataState: state,
    hint: resolveDaemonStartupHint(state, settings.paths),
  });
}

async function waitForDaemonStartup(
  timeoutMs: number,
  settings: DaemonClientSettings,
  launch: DaemonStartupLaunch,
): Promise<DaemonStartupWaitResult> {
  const start = Date.now();
  let earlyExit: ExecDetachedExit | undefined;
  void launch.exited.then((exit) => {
    earlyExit = exit;
  });

  while (Date.now() - start < timeoutMs) {
    if (earlyExit) return { kind: 'early_exit', exit: earlyExit };
    const info = readDaemonInfo(settings.paths.infoPath);
    if (info && (await canConnect(info, settings.transportPreference))) {
      return { kind: 'ready', info };
    }
    if (earlyExit) return { kind: 'early_exit', exit: earlyExit };
    await sleep(100);
  }
  return { kind: 'timeout' };
}

function startDaemon(settings: DaemonClientSettings): DaemonStartupLaunch {
  const launchSpec = resolveDaemonLaunchSpec();
  const args = launchSpec.useSrc
    ? ['--experimental-strip-types', launchSpec.srcPath]
    : [launchSpec.distPath];
  const env = {
    ...process.env,
    AGENT_DEVICE_STATE_DIR: settings.paths.baseDir,
    AGENT_DEVICE_DAEMON_SERVER_MODE: settings.serverMode,
  };

  fs.mkdirSync(settings.paths.baseDir, { recursive: true });
  const stdoutFd = fs.openSync(settings.paths.logPath, 'a');
  const stderrFd = fs.openSync(settings.paths.logPath, 'a');
  try {
    return runCmdDetachedMonitored(process.execPath, args, {
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
}

function describeDaemonEarlyExit(exit: ExecDetachedExit): string {
  if (exit.error) return `daemon process ${exit.pid} failed to start: ${exit.error}`;
  if (exit.signal)
    return `daemon process ${exit.pid} exited before readiness with signal ${exit.signal}`;
  return `daemon process ${exit.pid} exited before readiness with code ${exit.exitCode ?? 0}`;
}

function readRecentLogTail(logPath: string): string | undefined {
  try {
    if (!fs.existsSync(logPath)) return undefined;
    const stats = fs.statSync(logPath);
    if (stats.size <= 0) return undefined;
    const length = Math.min(stats.size, DAEMON_STARTUP_LOG_TAIL_BYTES);
    const fd = fs.openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, stats.size - length);
      const text = buffer.toString('utf8').trim();
      return text.length > 0 ? text : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}
