import { parseAllDocuments } from 'yaml';
import { expect, test } from 'vitest';
import type { SessionAction } from '@agent-device/contracts/session';
import {
  executeMaestroFlow,
  exportReplayActionsToMaestro,
  inspectMaestroFlow,
} from '../../index.ts';
import { createMaestroRuntimePort, makeOperations } from './runtime-port-fixtures.ts';

test.each(['android', 'ios'] as const)(
  'exports an app-to-home-to-app journey that executes in order on %s',
  async (platform) => {
    const result = exportReplayActionsToMaestro(
      [action('open', ['com.example.app']), action('home'), action('open', ['com.example.app'])],
      { resolveSelector: () => null },
    );

    expect(parseYamlDocs(result.yaml)).toEqual([
      { appId: 'com.example.app' },
      ['launchApp', { pressKey: 'Home' }, 'launchApp'],
    ]);
    expect(result.warnings).toEqual([]);

    const calls: string[] = [];
    const port = createMaestroRuntimePort(
      makeOperations({
        platform,
        launchApp: async ({ appId }) => {
          calls.push(`open ${appId}`);
        },
        pressKey: async ({ key }) => {
          calls.push(key);
        },
      }),
    );
    const outcome = await executeMaestroFlow(inspectMaestroFlow(result.yaml, 'home.yaml'), port, {
      platform,
      readSource: () => {
        throw new Error('unexpected flow include');
      },
    });

    expect(outcome).toMatchObject({ ok: true, replayed: 3 });
    expect(calls).toEqual(['open com.example.app', 'home', 'open com.example.app']);
  },
);

test('preserves launch options, deep links, back, and keyboard exports', () => {
  const result = exportReplayActionsToMaestro(
    [
      {
        ...action('open', ['com.example.app', 'example://checkout']),
        flags: { relaunch: true, clearAppState: true, launchArgs: ['--fixture'] },
      },
      action('back'),
      action('keyboard', ['dismiss']),
      action('keyboard', ['enter']),
      action('keyboard', ['return']),
      action('open', ['example://done']),
    ],
    { resolveSelector: () => null },
  );

  expect(parseYamlDocs(result.yaml)).toEqual([
    { appId: 'com.example.app' },
    [
      {
        launchApp: {
          appId: 'com.example.app',
          stopApp: true,
          clearState: true,
          launchArguments: ['--fixture'],
        },
      },
      { openLink: 'example://checkout' },
      'back',
      'hideKeyboard',
      { pressKey: 'Enter' },
      { pressKey: 'Enter' },
      { openLink: 'example://done' },
    ],
  ]);
  expect(result.warnings).toEqual([]);
});

test.each([
  { command: 'close', positionals: [], message: 'close has no Maestro equivalent' },
  { command: 'keyboard', positionals: ['status'], message: 'keyboard status' },
  { command: 'open', positionals: [], message: 'open requires an app id or URL' },
  {
    command: 'open',
    positionals: ['com.example.app', 'another-app'],
    message: 'open with a non-URL second argument is unsupported',
  },
])('rejects unsupported navigation: $command $positionals', ({ command, positionals, message }) => {
  expect(() =>
    exportReplayActionsToMaestro([action(command, positionals)], {
      actionLines: [7],
      resolveSelector: () => null,
    }),
  ).toThrowError(
    expect.objectContaining({
      code: 'INVALID_ARGS',
      details: { unsupported: [expect.objectContaining({ line: 7, message })] },
    }),
  );
});

function action(command: string, positionals: string[] = []): SessionAction {
  return { ts: 0, command, positionals, flags: {} };
}

function parseYamlDocs(script: string): unknown[] {
  return parseAllDocuments(script).map((document) => document.toJSON());
}
