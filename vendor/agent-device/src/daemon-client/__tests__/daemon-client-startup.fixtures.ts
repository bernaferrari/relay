import assert from 'node:assert/strict';
import fs from 'node:fs';
import { vi } from 'vitest';
import { runCmdDetachedMonitored } from '@agent-device/host-kit/command';
import { readVersion } from '@agent-device/host-kit/version';
import { mkdtempForTestSync } from '../../__tests__/test-utils/tmp-dir.ts';
import { currentDaemonCodeSignature } from '../../__tests__/test-utils/daemon-http-fixture.ts';
import { spawnRegisteredDaemonFixture } from '../../__tests__/test-utils/registered-daemon-fixture.ts';
import type { DaemonPaths } from '../../daemon-resolution.ts';

const mockRunCmdDetached = vi.mocked(runCmdDetachedMonitored);

export function makeTempStateDir(prefix: string): string {
  return mkdtempForTestSync(prefix);
}

/** An unreachable observed daemon has no live registration to mutate. */
export function writeUnreachableDaemonInfo(paths: DaemonPaths, httpPort: number): void {
  fs.mkdirSync(paths.baseDir, { recursive: true });
  fs.writeFileSync(
    paths.infoPath,
    `${JSON.stringify({
      token: 'local-secret',
      pid: 999_999,
      version: readVersion(),
      codeOrigin: 'checkout',
      codeSignature: currentDaemonCodeSignature(),
      processStartTime: 'dead-fixture-start-time',
      httpPort,
      transport: 'http',
    })}\n`,
    'utf8',
  );
}

export function installSpawnedHttpDaemon(paths: DaemonPaths, httpPort: number): void {
  mockRunCmdDetached.mockImplementation((_command, _args, options) => {
    assert.equal(options?.env?.AGENT_DEVICE_STATE_DIR, paths.baseDir);
    return spawnRegisteredDaemonFixture(
      paths,
      {
        httpPort,
        token: 'local-secret',
        version: readVersion(),
        codeOrigin: 'checkout',
        codeSignature: currentDaemonCodeSignature(),
      },
      options,
    );
  });
}
