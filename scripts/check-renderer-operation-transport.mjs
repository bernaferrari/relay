import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const appSourceRoot = resolve(repositoryRoot, "packages/app/src");
const appV2SourceRoot = resolve(repositoryRoot, "packages/app-v2/src");

/**
 * These are deliberately narrow escape hatches for resources that are not
 * operations: immutable reports/evidence, the target-profile catalog, and
 * media/event endpoints. A new exception should name
 * the resource here and explain why it cannot be an operation.
 */
export const unregisteredResourceAllowlist = [
  "/matrices/:matrixId/yaml",
  "/settings/devices/apple",
  "/settings/devices/apple/preflight",
  "/settings/devices/android",
  "/target-profiles",
  "/reports/matrix/:batchId",
  "/runs/:runId/signals",
];

const callKinds = [
  { name: "RelayClient.resource", pattern: /\bresource\s*(?:<[^>\n]+>)?\s*\(/gu },
  { name: "generic request helper", pattern: /\brequest\s*(?:<[^>\n]+>)?\s*\(/gu },
  { name: "raw fetch", pattern: /\bfetch\s*(?:<[^>\n]+>)?\s*\(/gu },
];

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function skipQuoted(source, index, quote) {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === quote) return cursor + 1;
  }
  return source.length;
}

function skipTemplate(source, index) {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "`") return cursor + 1;
  }
  return source.length;
}

function firstArgument(source, openIndex) {
  let depth = 0;
  let cursor = openIndex + 1;
  const start = cursor;
  for (; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "'" || character === '"') {
      cursor = skipQuoted(source, cursor, character) - 1;
      continue;
    }
    if (character === "`") {
      cursor = skipTemplate(source, cursor) - 1;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) return { argument: source.slice(start, cursor), end: cursor };
      depth -= 1;
      continue;
    }
    if (character === "," && depth === 0)
      return { argument: source.slice(start, cursor), end: cursor };
  }
  return { argument: source.slice(start), end: source.length };
}

function splitTopLevel(source, separator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "'" || character === '"') {
      cursor = skipQuoted(source, cursor, character) - 1;
      continue;
    }
    if (character === "`") {
      cursor = skipTemplate(source, cursor) - 1;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(source.slice(start, cursor));
      start = cursor + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function stringValue(expression) {
  const quote = expression[0];
  if ((quote !== "'" && quote !== '"') || expression.at(-1) !== quote) return null;
  try {
    if (quote === '"') return JSON.parse(expression);
    return expression.slice(1, -1).replace(/\\([\\'"nrt])/gu, (_, escaped) => {
      const values = { n: "\n", r: "\r", t: "\t" };
      return values[escaped] ?? escaped;
    });
  } catch {
    return null;
  }
}

/**
 * Reduce a path expression to literal segments and dynamic segments. This is
 * intentionally not a TypeScript parser: it understands the path forms used
 * by the renderer (`"/x"`, `` `/x/${id}` ``, and concatenation) while keeping
 * unknown expressions conservative.
 */
export function pathPattern(expression) {
  const source = expression.trim().replace(/;\s*$/u, "");
  const literal = stringValue(source);
  if (literal !== null) return literal;

  if (source.startsWith("`") && source.endsWith("`")) {
    let result = "";
    let cursor = 1;
    let segmentStart = cursor;
    while (cursor < source.length - 1) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] !== "$" || source[cursor + 1] !== "{") {
        cursor += 1;
        continue;
      }
      result += source.slice(segmentStart, cursor);
      let depth = 1;
      cursor += 2;
      while (cursor < source.length - 1 && depth > 0) {
        if (source[cursor] === "'" || source[cursor] === '"') {
          cursor = skipQuoted(source, cursor, source[cursor]);
          continue;
        }
        if (source[cursor] === "`") {
          cursor = skipTemplate(source, cursor);
          continue;
        }
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      result += "__DYNAMIC__";
      segmentStart = cursor;
    }
    return result + source.slice(segmentStart, -1);
  }

  const additions = splitTopLevel(source, "+");
  if (additions.length > 1)
    return additions.map((part) => pathPattern(part) ?? "__DYNAMIC__").join("");
  return null;
}

function pathPatterns(expression) {
  const source = expression.trim();
  const conditional = splitTopLevel(source, "?");
  if (conditional.length === 2) {
    const branches = splitTopLevel(conditional[1] ?? "", ":");
    if (branches.length === 2) {
      return [...pathPatterns(branches[0] ?? ""), ...pathPatterns(branches[1] ?? "")];
    }
  }
  const pattern = pathPattern(source);
  return pattern === null ? [] : [pattern];
}

function normalizedSegments(path) {
  const withoutQuery = path.split("?", 1)[0] ?? path;
  return withoutQuery
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .filter(Boolean);
}

function pathMatches(actual, expected) {
  const actualSegments = normalizedSegments(actual);
  const expectedSegments = normalizedSegments(expected);
  if (actualSegments.length !== expectedSegments.length) return false;
  return expectedSegments.every((segment, index) => {
    const actualSegment = actualSegments[index] ?? "";
    return segment.startsWith(":") || actualSegment === "__DYNAMIC__" || actualSegment === segment;
  });
}

function methodsFromCall(source, end) {
  if (source[end] !== ",") return ["GET"];
  const init = firstArgument(source, end).argument;
  const methodValue = init.match(/\bmethod\s*:\s*([\s\S]*?)(?:,|$)/u)?.[1] ?? "";
  const methods = [...methodValue.matchAll(/["']([A-Za-z]+)["']/gu)].map((match) =>
    match[1].toUpperCase(),
  );
  return methods.length ? [...new Set(methods)] : ["GET"];
}

function matchingDefinitions(path, method, definitions) {
  if (path === null) return [];
  return definitions.filter(
    (definition) =>
      definition.transport.method === method && pathMatches(path, definition.transport.path),
  );
}

export function scanRendererSource(path, source, definitions) {
  const violations = [];
  for (const kind of callKinds) {
    for (const match of source.matchAll(kind.pattern)) {
      const openIndex = (match.index ?? 0) + match[0].length - 1;
      const first = firstArgument(source, openIndex);
      const methods = methodsFromCall(source, first.end);
      for (const method of methods) {
        for (const pathExpression of pathPatterns(first.argument)) {
          const matches = matchingDefinitions(pathExpression, method, definitions);
          const allowlistedRead =
            method === "GET" &&
            unregisteredResourceAllowlist.some((allowed) => pathMatches(pathExpression, allowed));
          if (!matches.length && (kind.name !== "RelayClient.resource" || allowlistedRead)) {
            continue;
          }
          violations.push({
            file: path,
            line: lineAt(source, match.index ?? 0),
            kind: kind.name,
            method,
            path: pathExpression,
            operations: matches.map((definition) => definition.id),
          });
        }
      }
    }
  }
  return violations;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/u.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

export async function scanRendererOperationTransport(definitions, root = appSourceRoot) {
  const files = await sourceFiles(root);
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    violations.push(...scanRendererSource(relative(repositoryRoot, file), source, definitions));
  }
  return violations;
}

export function formatViolations(violations) {
  return violations.map(
    (violation) =>
      `${violation.file}:${violation.line} ${violation.kind} uses ${violation.method} ${violation.path}; ${violation.operations.length ? `registered operation(s): ${violation.operations.join(", ")}` : "unregistered resource is not in the immutable-read allowlist"}`,
  );
}

const requireFromApp = createRequire(resolve(repositoryRoot, "packages/app/package.json"));
export async function loadOperationDefinitions() {
  const protocolEntry = requireFromApp.resolve("@relay/protocol");
  return (await import(pathToFileURL(protocolEntry).href)).operationDefinitions;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RELAY_RENDERER_GUARD_TSX !== "1") {
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "node_modules/tsx/dist/cli.mjs"), fileURLToPath(import.meta.url)],
      {
        cwd: repositoryRoot,
        env: { ...process.env, RELAY_RENDERER_GUARD_TSX: "1" },
        stdio: "inherit",
      },
    );
    process.exitCode = result.status ?? 1;
  } else {
    const operationDefinitions = await loadOperationDefinitions();
    const violations = (
      await Promise.all(
        [appSourceRoot, appV2SourceRoot].map((root) =>
          scanRendererOperationTransport(operationDefinitions, root),
        ),
      )
    ).flat();
    if (violations.length) {
      console.error(
        `Renderer operation transport guard found ${violations.length} unsafe transport call(s). Use RelayClient.invoke(operationId, input) for registered operations; only the narrow unregistered immutable-read allowlist may use resources.`,
      );
      for (const violation of formatViolations(violations)) console.error(`- ${violation}`);
      process.exitCode = 1;
    } else {
      console.log("Renderer operation transport guard passed.");
    }
  }
}
