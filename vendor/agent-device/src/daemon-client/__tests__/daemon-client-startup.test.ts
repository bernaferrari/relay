import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test, vi } from 'vitest';

vi.mock('@agent-device/host-kit/command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@agent-device/host-kit/command')>()),
  runCmdDetachedMonitored: vi.fn(),
}));

import { resolveDaemonPaths } from '../../daemon-resolution.ts';
import { sendToDaemon } from '../daemon-client.ts';
import { ensureDaemon } from '../daemon-client-lifecycle.ts';
import { closeLoopbackServer, supportsLoopbackBind } from '../../__tests__/test-utils/loopback.ts';
import {
  captureStderr,
  currentDaemonCodeSignature,
  startHttpDaemonFixture,
} from '../../__tests__/test-utils/daemon-http-fixture.ts';
import {
  finishRegisteredDaemonFixture,
  finishRegisteredDaemonFixtures,
  spawnRegisteredDaemonFixture,
} from '../../__tests__/test-utils/registered-daemon-fixture.ts';
import { runCmdDetachedMonitored } from '@agent-device/host-kit/command';
import { sleep } from '@agent-device/host-kit/retry';
import { readVersion } from '@agent-device/host-kit/version';
import {
  installSpawnedHttpDaemon,
  makeTempStateDir,
  writeUnreachableDaemonInfo,
} from './daemon-client-startup.fixtures.ts';

const mockRunCmdDetached = vi.mocked(runCmdDetachedMonitored);

afterEach(async () => {
  await finishRegisteredDaemonFixtures();
  mockRunCmdDetached.mockReset();
  vi.unstubAllEnvs();
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
      writeUnreachableDaemonInfo(paths, unreachable.port);
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
  }, 15_000);
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

    await finishRegisteredDaemonFixture(stateDir);
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
}, 15_000);

test('startup serialization does not block an independent state directory', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }
  const firstPaths = resolveDaemonPaths(makeTempStateDir('agent-device-daemon-blocked-startup-'));
  const secondPaths = resolveDaemonPaths(
    makeTempStateDir('agent-device-daemon-independent-startup-'),
  );
  const daemon = await startHttpDaemonFixture({ via: 'independent-startup' });
  const deferredPublication = path.join(firstPaths.baseDir, 'defer-publication');
  fs.writeFileSync(deferredPublication, 'wait');
  mockRunCmdDetached.mockImplementation((_command, _args, options) => {
    const paths = resolveDaemonPaths(String(options?.env?.AGENT_DEVICE_STATE_DIR));
    return spawnRegisteredDaemonFixture(
      paths,
      {
        httpPort: daemon.port,
        token: 'local-secret',
        version: readVersion(),
        codeOrigin: 'checkout',
        codeSignature: currentDaemonCodeSignature(),
      },
      options,
    );
  });
  let firstReady = false;
  const first = ensureDaemon({
    paths: firstPaths,
    transportPreference: 'http',
    serverMode: 'http',
  }).then((result) => {
    firstReady = true;
    return result;
  });
  try {
    for (
      let attempt = 0;
      !fs.existsSync(path.join(firstPaths.baseDir, 'registration-held'));
      attempt += 1
    ) {
      assert.ok(attempt < 400, 'first fixture did not acquire its registration');
      await sleep(10);
    }
    const second = await ensureDaemon({
      paths: secondPaths,
      transportPreference: 'http',
      serverMode: 'http',
    });
    assert.equal(second.startedByClient, true);
    assert.equal(
      firstReady,
      false,
      'another directory can start while the first is still publishing',
    );
    fs.rmSync(deferredPublication);
    assert.equal((await first).startedByClient, true);
    assert.equal(mockRunCmdDetached.mock.calls.length, 2);
  } finally {
    fs.rmSync(deferredPublication, { force: true });
    await first.catch(() => {});
    await closeLoopbackServer(daemon.server);
  }
}, 15_000);
