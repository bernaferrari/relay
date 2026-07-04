/** Optional monorepo package — may be missing during partial workspace installs. */
declare module "@grok-device/tui" {
  export function main(argv?: string[]): void | Promise<void>;
  export function run(argv?: string[]): void | Promise<void>;
  const _default: (argv?: string[]) => void | Promise<void>;
  export default _default;
}
