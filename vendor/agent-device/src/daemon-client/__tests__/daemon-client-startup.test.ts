import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, test, vi } from 'vitest';

vi.mock('@agent-device/host-kit/command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-device/host-kit/command')>()),
  runCmdDetached: vi.fn(),
  runCmdDetachedMonitored: vi.fn(),
  runCmdSync: vi.fn(() => ({ exitCode: 1, stdout: '', stderr: '' })),
}));
vi.mock('@agent-device/host-kit/retry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-device/host-kit/retry')>()),
  sleep: vi.fn(async () => {}),
}));

import { resolveDaemonPaths } from '../../daemon-resolution.ts';
import { sendToDaemon } from '../daemon-client.ts';
import { ensureDaemon } from '../daemon-client-startup.ts';
import { closeLoopbackServer, supportsLoopbackBind } from '../../__tests__/test-utils/loopback.ts';
import {
  captureStderr,
  startHttpDaemonFixture,
} from '../../__tests__/test-utils/daemon-http-fixture.ts';
import { AppError } from '@agent-device/kernel/errors';
import { runCmdDetachedMonitored, runCmdSync } from '@agent-device/host-kit/command';
import { sleep } from '@agent-device/host-kit/retry';
import { readVersion } from '@agent-device/host-kit/version';
import {
  installSpawnedHttpDaemon,
  makeTempStateDir,
  writeDaemonInfo,
  writeDaemonLock,
} from './daemon-client-startup.fixtures.ts';

const mockRunCmdDetached = vi.mocked(runCmdDetachedMonitored);
const mockRunCmdSync = vi.mocked(runCmdSync);
const mockSleep = vi.mocked(sleep);

afterEach(() => {
  mockRunCmdDetached.mockReset();
  mockRunCmdSync.mockClear();
  mockSleep.mockClear();
  vi.unstubAllEnvs();
});

test('sendToDaemon retries daemon spawn failures and cleans partial metadata on terminal failure', async () => {
  const stateDir = makeTempStateDir('agent-device-daemon-spawn-retry-');
  const paths = resolveDaemonPaths(stateDir);
  vi.stubEnv('AGENT_DEVICE_STATE_DIR', stateDir);
  let attempts = 0;

  mockRunCmdDetached.mockImplementation((_command, _args, options) => {
    attempts += 1;
    assert.equal(options?.env?.AGENT_DEVICE_STATE_DIR, stateDir);
    fs.mkdirSync(paths.baseDir, { recursive: true });
    fs.writeFileSync(paths.infoPath, '{"partial":true}\n', 'utf8');
    fs.writeFileSync(paths.lockPath, 'not-json\n', 'utf8');
    throw new Error(`spawn failed ${attempts}`);
  });

  try {
    let thrown: unknown;
    try {
      await sendToDaemon({
        session: 'default',
        command: 'spawn-retry-smoke',
        positionals: [],
        flags: { stateDir },
        meta: { requestId: 'req-spawn-retry' },
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof AppError);
    assert.equal(thrown.message, 'Failed to start daemon');
    assert.equal(thrown.details?.startError, 'spawn failed 2');
    assert.equal(thrown.details?.startupAttempts, 2);
    const cleanupResults = thrown.details?.cleanupResults;
    assert.ok(Array.isArray(cleanupResults));
    assert.deepEqual(
      cleanupResults.map((result) => ({
        reason: result.reason,
        removedInfo: result.removedInfo,
        removedLock: result.removedLock,
      })),
      [
        { reason: 'start_error', removedInfo: true, removedLock: true },
        { reason: 'start_error', removedInfo: true, removedLock: true },
      ],
    );
    assert.equal(attempts, 2);
    assert.equal(mockSleep.mock.calls[0]?.[0], 150);
    assert.equal(fs.existsSync(paths.infoPath), false);
    assert.equal(fs.existsSync(paths.lockPath), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('sendToDaemon reports early daemon exit with log tail and startup paths', async () => {
  const stateDir = makeTempStateDir('agent-device-daemon-early-exit-');
  const paths = resolveDaemonPaths(stateDir);
  vi.stubEnv('AGENT_DEVICE_STATE_DIR', stateDir);
  let attempts = 0;

  mockRunCmdDetached.mockImplementation((_command, _args, options) => {
    attempts += 1;
    const stderrFd = options?.stdio?.[2];
    if (typeof stderrFd === 'number') {
      fs.writeSync(stderrFd, `early daemon failure ${attempts}\n`);
    }
    return {
      pid: 43_200 + attempts,
      exited: Promise.resolve({ pid: 43_200 + attempts, exitCode: 1 }),
    };
  });

  try {
    let thrown: unknown;
    try {
      await sendToDaemon({
        session: 'default',
        command: 'early-exit-smoke',
        positionals: [],
        flags: { stateDir },
        meta: { requestId: 'req-early-exit' },
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof AppError);
    assert.equal(thrown.message, 'Failed to start daemon');
    assert.equal(thrown.details?.stateDir, paths.baseDir);
    assert.equal(thrown.details?.logPath, paths.logPath);
    assert.match(String(thrown.details?.startError), /daemon process 43202 exited/);
    assert.deepEqual(thrown.details?.daemonProcess, { pid: 43_202, exitCode: 1 });
    assert.match(String(thrown.details?.daemonLogTail), /early daemon failure 2/);
    assert.equal(attempts, 2);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('sendToDaemon removes stale daemon lock before spawning a fresh daemon', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  const stateDir = makeTempStateDir('agent-device-daemon-stale-lock-');
  const paths = resolveDaemonPaths(stateDir);
  const daemon = await startHttpDaemonFixture({ via: 'fresh-daemon' });
  vi.stubEnv('AGENT_DEVICE_STATE_DIR', stateDir);
  writeDaemonLock(paths, {
    pid: process.pid,
    processStartTime: 'stale-start-time',
  });
  installSpawnedHttpDaemon(paths, daemon.port);

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'stale-lock-smoke',
      positionals: [],
      flags: { stateDir, daemonTransport: 'http' },
      meta: { requestId: 'req-stale-lock' },
    });

    const freshLock = JSON.parse(fs.readFileSync(paths.lockPath, 'utf8')) as {
      pid?: number;
      processStartTime?: string;
    };
    assert.deepEqual(response, { ok: true, data: { via: 'fresh-daemon' } });
    assert.equal(mockRunCmdDetached.mock.calls.length, 1);
    assert.equal(freshLock.pid, process.pid);
    assert.notEqual(freshLock.processStartTime, 'stale-start-time');
    assert.deepEqual(daemon.seenPaths, ['GET /health', 'POST /rpc']);
  } finally {
    await closeLoopbackServer(daemon.server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('sendToDaemon does not reuse reachable daemon metadata with mismatched version or signature', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  const cases: Array<{
    name: string;
    version?: string;
    codeSignature?: string;
    expectedReason: (clientVersion: string) => string;
  }> = [
    {
      name: 'version',
      version: '0.0.0-mismatch',
      expectedReason: (clientVersion) => `version mismatch (client v${clientVersion})`,
    },
    {
      name: 'code-signature',
      codeSignature: 'mismatched-signature',
      expectedReason: () => 'code-signature mismatch',
    },
  ];

  for (const fixture of cases) {
    const stateDir = makeTempStateDir(`agent-device-daemon-${fixture.name}-mismatch-`);
    const paths = resolveDaemonPaths(stateDir);
    const staleDaemon = await startHttpDaemonFixture({ via: 'stale-daemon' });
    const freshDaemon = await startHttpDaemonFixture({ via: 'fresh-daemon' });
    vi.stubEnv('AGENT_DEVICE_STATE_DIR', stateDir);
    mockRunCmdDetached.mockReset();
    installSpawnedHttpDaemon(paths, freshDaemon.port);
    writeDaemonInfo(paths, {
      httpPort: staleDaemon.port,
      transport: 'http',
      pid: 999_999,
      ...(fixture.version ? { version: fixture.version } : {}),
      ...(fixture.codeSignature ? { codeSignature: fixture.codeSignature } : {}),
    });
    const stderrCapture = captureStderr();

    try {
      const response = await sendToDaemon({
        session: 'default',
        command: `mismatch-${fixture.name}-smoke`,
        positionals: [],
        flags: { stateDir, daemonTransport: 'http' },
        meta: { requestId: `req-mismatch-${fixture.name}` },
      });

      assert.deepEqual(response, { ok: true, data: { via: 'fresh-daemon' } });
      assert.equal(mockRunCmdDetached.mock.calls.length, 1);
      assert.deepEqual(staleDaemon.seenPaths, ['GET /health']);
      assert.deepEqual(freshDaemon.seenPaths, ['GET /health', 'POST /rpc']);
      const staleVersion = fixture.version ?? readVersion();
      assert.equal(
        stderrCapture.read(),
        `Replacing daemon (pid 999999, v${staleVersion}) in ${paths.baseDir}: ` +
          `${fixture.expectedReason(readVersion())}\n`,
      );
    } finally {
      stderrCapture.restore();
      await closeLoopbackServer(staleDaemon.server);
      await closeLoopbackServer(freshDaemon.server);
      fs.rmSync(stateDir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  }
});

test('sendToDaemon prints a takeover notice before replacing an unreachable daemon', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  const stateDir = makeTempStateDir('agent-device-daemon-unreachable-takeover-');
  const paths = resolveDaemonPaths(stateDir);
  // Bind fresh BEFORE freeing the port below: a later bind can reclaim it and skip the takeover.
  const freshDaemon = await startHttpDaemonFixture({ via: 'fresh-daemon' });
  const unreachable = await startHttpDaemonFixture({ via: 'unused' });
  await closeLoopbackServer(unreachable.server);
  vi.stubEnv('AGENT_DEVICE_STATE_DIR', stateDir);
  installSpawnedHttpDaemon(paths, freshDaemon.port);
  writeDaemonInfo(paths, {
    httpPort: unreachable.port,
    transport: 'http',
    pid: 999_999,
  });
  const stderrCapture = captureStderr();

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'unreachable-takeover-smoke',
      positionals: [],
      flags: { stateDir, daemonTransport: 'http' },
      meta: { requestId: 'req-unreachable-takeover' },
    });

    assert.deepEqual(response, { ok: true, data: { via: 'fresh-daemon' } });
    assert.equal(
      stderrCapture.read(),
      `Replacing daemon (pid 999999, v${readVersion()}) in ${paths.baseDir}: unreachable\n`,
    );
  } finally {
    stderrCapture.restore();
    await closeLoopbackServer(freshDaemon.server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('sendToDaemon replaces socket-only daemon metadata when HTTP transport is requested', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  const stateDir = makeTempStateDir('agent-device-daemon-http-takeover-');
  const paths = resolveDaemonPaths(stateDir);
  const freshDaemon = await startHttpDaemonFixture({ via: 'fresh-http-daemon' });
  vi.stubEnv('AGENT_DEVICE_STATE_DIR', stateDir);
  installSpawnedHttpDaemon(paths, freshDaemon.port);
  writeDaemonInfo(paths, {
    port: 65_532,
    transport: 'socket',
    pid: 999_999,
  });
  const stderrCapture = captureStderr();

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'http-takeover-smoke',
      positionals: [],
      flags: { stateDir, daemonTransport: 'http' },
      meta: { requestId: 'req-http-takeover' },
    });

    assert.deepEqual(response, { ok: true, data: { via: 'fresh-http-daemon' } });
    assert.equal(mockRunCmdDetached.mock.calls.length, 1);
    assert.deepEqual(freshDaemon.seenPaths, ['GET /health', 'POST /rpc']);
    assert.equal(
      stderrCapture.read(),
      `Replacing daemon (pid 999999, v${readVersion()}) in ${paths.baseDir}: unreachable\n`,
    );
  } finally {
    stderrCapture.restore();
    await closeLoopbackServer(freshDaemon.server);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

for (const initialState of ['cold start', 'unreachable replacement'] as const) {
  test(`concurrent requests serialize one local daemon ${initialState}`, async (t) => {
    if (!(await supportsLoopbackBind())) {
      t.skip('loopback listeners are not permitted in this environment');
      return;
    }
    const stateDir = makeTempStateDir('agent-device-daemon-concurrent-startup-');
    const paths = resolveDaemonPaths(stateDir);
    const freshDaemon = await startHttpDaemonFixture({ via: 'single-owner' });
    installSpawnedHttpDaemon(paths, freshDaemon.port);
    if (initialState === 'unreachable replacement') {
      const unreachable = await startHttpDaemonFixture({ via: 'unused' });
      await closeLoopbackServer(unreachable.server);
      writeDaemonInfo(paths, { httpPort: unreachable.port, transport: 'http', pid: 999_999 });
    }
    const stderr = captureStderr();
    try {
      const responses = await Promise.all(
        ['first', 'second'].map((id) =>
          sendToDaemon({
            session: 'default',
            command: 'concurrent-startup-smoke',
            positionals: [],
            flags: { stateDir, daemonTransport: 'http' },
            meta: { requestId: id },
          }),
        ),
      );
      assert.deepEqual(responses, [
        { ok: true, data: { via: 'single-owner' } },
        { ok: true, data: { via: 'single-owner' } },
      ]);
      assert.equal(
        mockRunCmdDetached.mock.calls.length,
        1,
        'one lifecycle owner launches the daemon',
      );
      assert.deepEqual(
        freshDaemon.rpcRequests.map((request) => request.params.meta.requestId).sort(),
        ['first', 'second'],
      );
      assert.equal(
        stderr.read().split('Replacing daemon').length - 1,
        initialState === 'cold start' ? 0 : 1,
      );
    } finally {
      stderr.restore();
      await closeLoopbackServer(freshDaemon.server);
    }
  });
}

test('queued startup callers retain one teardown owner and retry after failed startup', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }
  const stateDir = makeTempStateDir('agent-device-daemon-startup-owner-');
  const paths = resolveDaemonPaths(stateDir);
  const daemon = await startHttpDaemonFixture({ via: 'startup-owner' });
  installSpawnedHttpDaemon(paths, daemon.port);
  const settings = { paths, transportPreference: 'http', serverMode: 'http' } as const;
  try {
    const first = await Promise.all([ensureDaemon(settings), ensureDaemon(settings)]);
    assert.deepEqual(
      first.map(({ startedByClient }) => startedByClient),
      [true, false],
    );
    assert.equal(mockRunCmdDetached.mock.calls.length, 1);

    fs.rmSync(paths.infoPath);
    fs.rmSync(paths.lockPath);
    mockRunCmdDetached.mockClear();
    mockRunCmdDetached.mockImplementationOnce(() => {
      throw new Error('first launch failed');
    });
    mockRunCmdDetached.mockImplementationOnce(() => {
      throw new Error('retry launch failed');
    });
    const recovery = await Promise.allSettled([ensureDaemon(settings), ensureDaemon(settings)]);
    assert.equal(recovery[0]?.status, 'rejected');
    assert.equal(recovery[1]?.status, 'fulfilled');
    if (recovery[1]?.status === 'fulfilled') assert.equal(recovery[1].value.startedByClient, true);
    assert.equal(mockRunCmdDetached.mock.calls.length, 3, 'failed owner releases the startup lock');
  } finally {
    await closeLoopbackServer(daemon.server);
  }
});
