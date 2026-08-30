import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceChangeContext } from "@relay/protocol";

const execFileAsync = promisify(execFile);

export type WorkspaceChangeGitRunner = (args: readonly string[], cwd: string) => Promise<string>;

async function defaultGitRunner(args: readonly string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

async function optionalGit(
  runner: WorkspaceChangeGitRunner,
  args: readonly string[],
  cwd: string,
): Promise<string | undefined> {
  try {
    return (await runner(args, cwd)).trim();
  } catch {
    return undefined;
  }
}

function repositoryIdentity(remote: string | undefined): string | undefined {
  const value = remote?.trim().replace(/\/+$/u, "");
  if (!value) return undefined;
  const scp = /^(?:[^@\s]+@)?([^:\s]+):(.+)$/u.exec(value);
  if (scp && !value.includes("://")) {
    const path = scp[2]!.replace(/^\/+|\.git$/gu, "");
    return scp[1] === "github.com" ? path : `${scp[1]}/${path}`;
  }
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.replace(/^\/+|\.git$/gu, "");
    if (!path) return undefined;
    return parsed.hostname === "github.com" ? path : `${parsed.hostname}/${path}`;
  } catch {
    return undefined;
  }
}

function nulList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("\0")
    .map((item) => item.trim())
    .filter(Boolean);
}

function boundedPaths(paths: Iterable<string>): { count: number; paths: string[] } {
  const unique = [...new Set(paths)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return { count: unique.length, paths: unique.slice(0, 100) };
}

function displayRef(ref: string): string {
  return ref.replace(/^refs\/remotes\//u, "").replace(/^origin\//u, "");
}

function unavailable(name: string, blocker: string): WorkspaceChangeContext {
  return {
    status: "unavailable",
    workspace: { name },
    baseCandidates: [],
    changedFileCount: 0,
    changedFiles: [],
    localChangeCount: 0,
    localChanges: [],
    readyForProof: false,
    blockers: [blocker],
  };
}

/**
 * Resolve the change from the server's active worktree. Restored renderer tabs,
 * selected documents, and previous-session navigation are deliberately absent
 * from this boundary and can never become source authority.
 */
export async function inspectWorkspaceChange(
  input: {
    startPath?: string;
    baseRef?: string;
    preferredBaseRef?: string;
    git?: WorkspaceChangeGitRunner;
  } = {},
): Promise<WorkspaceChangeContext> {
  const startPath = input.startPath ?? process.cwd();
  const git = input.git ?? defaultGitRunner;
  const root = await optionalGit(git, ["rev-parse", "--show-toplevel"], startPath);
  if (!root) return unavailable(basename(startPath), "The active workspace is not a repository.");

  const workspace = { name: basename(root) };
  const headSha = await optionalGit(git, ["rev-parse", "--verify", "HEAD^{commit}"], root);
  if (!headSha || !/^[a-f0-9]{40}$/u.test(headSha)) {
    return unavailable(
      workspace.name,
      "The active workspace does not have a frozen head revision.",
    );
  }

  const [remote, branch, headSummary, trackedLocal, untrackedLocal] = await Promise.all([
    optionalGit(git, ["remote", "get-url", "origin"], root),
    optionalGit(git, ["symbolic-ref", "--quiet", "--short", "HEAD"], root),
    optionalGit(git, ["show", "-s", "--format=%s", "HEAD"], root),
    optionalGit(git, ["diff", "--name-only", "-z", "HEAD", "--"], root),
    optionalGit(git, ["ls-files", "--others", "--exclude-standard", "-z"], root),
  ]);
  const repository = repositoryIdentity(remote);
  const local = boundedPaths([...nulList(trackedLocal), ...nulList(untrackedLocal)]);

  const explicitBase = input.baseRef?.trim() || input.preferredBaseRef?.trim();
  const configuredDefault = explicitBase
    ? undefined
    : await optionalGit(
        git,
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        root,
      );
  const candidateRefs = new Set<string>();
  if (explicitBase) candidateRefs.add(explicitBase);
  if (configuredDefault) candidateRefs.add(configuredDefault);
  if (!candidateRefs.size) {
    const remoteRefs = await optionalGit(
      git,
      ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
      root,
    );
    for (const ref of remoteRefs?.split("\n") ?? []) {
      const trimmed = ref.trim();
      if (trimmed && trimmed !== "origin/HEAD" && trimmed !== branch) candidateRefs.add(trimmed);
    }
  }

  const baseCandidates: WorkspaceChangeContext["baseCandidates"] = [];
  for (const ref of [...candidateRefs].slice(0, 32)) {
    const sha = await optionalGit(
      git,
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      root,
    );
    if (sha && /^[a-f0-9]{40}$/u.test(sha)) {
      baseCandidates.push({ ref, sha, label: displayRef(ref) });
    }
  }

  const selectedBase = explicitBase
    ? baseCandidates.find(({ ref }) => ref === explicitBase)
    : configuredDefault
      ? baseCandidates.find(({ ref }) => ref === configuredDefault)
      : baseCandidates.length === 1
        ? baseCandidates[0]
        : undefined;
  const mergeBaseSha = selectedBase
    ? await optionalGit(git, ["merge-base", "--", selectedBase.sha, headSha], root)
    : undefined;
  const frozenBase =
    mergeBaseSha && /^[a-f0-9]{40}$/u.test(mergeBaseSha)
      ? { sha: mergeBaseSha, label: selectedBase!.label }
      : undefined;
  const changeRef =
    selectedBase && mergeBaseSha && /^[a-f0-9]{40}$/u.test(mergeBaseSha)
      ? {
          baseTipSha: selectedBase.sha,
          mergeBaseSha,
          requestedHeadSha: headSha,
          testedSha: headSha,
          testedKind: "head" as const,
          ...(branch ? { targetBranch: branch } : {}),
          ...(repository ? { repositoryId: repository } : {}),
        }
      : undefined;
  const changed = frozenBase
    ? boundedPaths(
        nulList(
          await optionalGit(
            git,
            ["diff", "--name-only", "-z", frozenBase.sha, headSha, "--"],
            root,
          ),
        ),
      )
    : { count: 0, paths: [] };

  const blockers: string[] = [];
  if (!repository)
    blockers.push("Connect this workspace to one repository before starting a Proof.");
  if (!selectedBase) {
    blockers.push(
      baseCandidates.length > 1
        ? "Choose which reviewed change this workspace should be compared with."
        : "Set the workspace's default comparison branch before starting a Proof.",
    );
  } else if (!frozenBase) {
    blockers.push(
      "The current revision does not share a verifiable history with its comparison branch.",
    );
  } else if (frozenBase.sha === headSha) {
    blockers.push("The workspace head is the same as its comparison revision.");
  }
  if (local.count) {
    blockers.push(
      `${local.count} local ${local.count === 1 ? "change is" : "changes are"} not part of the frozen head.`,
    );
  }

  return {
    status: selectedBase ? "resolved" : baseCandidates.length ? "needs-selection" : "unavailable",
    workspace,
    ...(repository ? { repository } : {}),
    ...(branch ? { branch } : {}),
    head: { sha: headSha, label: headSummary || branch || headSha.slice(0, 12) },
    ...(frozenBase ? { base: frozenBase } : {}),
    ...(changeRef ? { changeRef } : {}),
    baseCandidates,
    changedFileCount: changed.count,
    changedFiles: changed.paths,
    localChangeCount: local.count,
    localChanges: local.paths,
    readyForProof: blockers.length === 0,
    blockers,
  };
}
