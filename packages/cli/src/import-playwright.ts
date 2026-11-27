import { UsageError } from "./errors.js";
import {
  capitalizeThe,
  compactCode,
  type ConvertedImportTest,
  humanizeFileStem,
  importComments,
  type ImportedStep,
  type ImportOverrides,
  kebabFileStem,
  renderRelayTestYaml,
  uniqueWarnings,
} from "./import-shared.js";

type ScriptBlock = {
  title?: string;
  body: string;
  start: number;
  end: number;
};

type PlaywrightEvent = { type: "goto"; url: string } | { type: "step"; step: ImportedStep };

function isIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_$]/u.test(value));
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function scanQuoted(source: string, start: number): number {
  const quote = source[start];
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function scanLineComment(source: string, start: number): number {
  const end = source.indexOf("\n", start + 2);
  return end < 0 ? source.length : end;
}

function scanBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start + 2);
  return end < 0 ? source.length : end + 2;
}

/** Match a delimiter while ignoring strings and comments. Template strings are
 * treated as opaque; imports only claim static templates as high confidence. */
function matchingDelimiter(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "'" || char === '"' || char === "`") {
      cursor = scanQuoted(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function decodeQuoted(token: string): string | undefined {
  const quote = token[0];
  if (!quote || token.length < 2) return undefined;
  const raw = token.slice(1, -1);
  if (quote === "`" && raw.includes("${")) return undefined;
  let output = "";
  let cursor = 0;
  while (cursor < raw.length) {
    const char = raw[cursor]!;
    if (char !== "\\") {
      output += char;
      cursor += 1;
      continue;
    }
    const escaped = raw[cursor + 1];
    if (escaped === undefined) {
      output += "\\";
      cursor += 1;
      continue;
    }
    const simple: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      v: "\v",
      "0": "\0",
      "\\": "\\",
      "'": "'",
      '"': '"',
      "`": "`",
      $: "$",
    };
    if (simple[escaped] !== undefined) {
      output += simple[escaped];
      cursor += 2;
      continue;
    }
    if (escaped === "x" && /^[\dA-Fa-f]{2}$/u.test(raw.slice(cursor + 2, cursor + 4))) {
      output += String.fromCharCode(Number.parseInt(raw.slice(cursor + 2, cursor + 4), 16));
      cursor += 4;
      continue;
    }
    if (escaped === "u" && raw[cursor + 2] === "{") {
      const end = raw.indexOf("}", cursor + 3);
      if (end > 0) {
        const point = Number.parseInt(raw.slice(cursor + 3, end), 16);
        if (Number.isFinite(point)) output += String.fromCodePoint(point);
        cursor = end + 1;
        continue;
      }
    }
    if (escaped === "u" && /^[\dA-Fa-f]{4}$/u.test(raw.slice(cursor + 2, cursor + 6))) {
      output += String.fromCharCode(Number.parseInt(raw.slice(cursor + 2, cursor + 6), 16));
      cursor += 6;
      continue;
    }
    output += escaped;
    cursor += 2;
  }
  return output;
}

function readStringLiteral(
  source: string,
  index: number,
): { value: string; end: number } | undefined {
  const quote = source[index];
  if (quote !== "'" && quote !== '"' && quote !== "`") return undefined;
  const end = scanQuoted(source, index);
  if (end <= index + 1 || source[end - 1] !== quote) return undefined;
  const value = decodeQuoted(source.slice(index, end));
  return value === undefined ? undefined : { value, end };
}

function findArrowBodyOpen(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "'" || char === '"' || char === "`") {
      cursor = scanQuoted(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }
    if (char === "=" && source[cursor + 1] === ">") {
      const open = skipWhitespace(source, cursor + 2);
      return source[open] === "{" ? open : -1;
    }
    if (char === ")" && source[cursor + 1] === "{") return -1;
    cursor += 1;
  }
  return -1;
}

function blockFromArrow(
  source: string,
  arrowSearchStart: number,
  start: number,
): ScriptBlock | undefined {
  const open = findArrowBodyOpen(source, arrowSearchStart);
  if (open < 0) return undefined;
  const close = matchingDelimiter(source, open, "{", "}");
  if (close < 0) return undefined;
  return { body: source.slice(open + 1, close), start, end: close + 1 };
}

function scanTestBlocks(source: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "'" || char === '"' || char === "`") {
      cursor = scanQuoted(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }
    const word = source.startsWith("test", cursor)
      ? "test"
      : source.startsWith("it", cursor)
        ? "it"
        : undefined;
    if (
      !word ||
      isIdentifierCharacter(source[cursor - 1]) ||
      isIdentifierCharacter(source[cursor + word.length])
    ) {
      cursor += 1;
      continue;
    }
    let probe = skipWhitespace(source, cursor + word.length);
    if (source[probe] === ".") {
      const propertyMatch = /^\.(only|skip|fixme)\b/u.exec(source.slice(probe));
      if (!propertyMatch) {
        cursor += 1;
        continue;
      }
      probe = skipWhitespace(source, probe + propertyMatch[0].length);
    }
    if (source[probe] !== "(") {
      cursor += 1;
      continue;
    }
    const titleStart = skipWhitespace(source, probe + 1);
    const title = readStringLiteral(source, titleStart);
    if (!title) {
      cursor += 1;
      continue;
    }
    const block = blockFromArrow(source, title.end, cursor);
    if (block) blocks.push({ ...block, title: title.value });
    cursor = Math.max(cursor + 1, title.end);
  }
  return blocks;
}

function scanBeforeEachBlocks(source: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "'" || char === '"' || char === "`") {
      cursor = scanQuoted(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      cursor = scanLineComment(source, cursor);
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      cursor = scanBlockComment(source, cursor);
      continue;
    }
    let probe = -1;
    if (
      source.startsWith("test.beforeEach", cursor) &&
      !isIdentifierCharacter(source[cursor - 1])
    ) {
      probe = cursor + "test.beforeEach".length;
    } else if (
      source.startsWith("beforeEach", cursor) &&
      !isIdentifierCharacter(source[cursor - 1]) &&
      !isIdentifierCharacter(source[cursor + "beforeEach".length])
    ) {
      probe = cursor + "beforeEach".length;
    }
    if (probe < 0) {
      cursor += 1;
      continue;
    }
    probe = skipWhitespace(source, probe);
    if (source[probe] !== "(") {
      cursor += 1;
      continue;
    }
    const block = blockFromArrow(source, probe + 1, cursor);
    if (block) blocks.push(block);
    cursor = probe + 1;
  }
  return blocks;
}

/** Split top-level JavaScript statements on semicolons, and on newlines when
 * the project style omits semicolons. Chained lines beginning with a dot stay
 * with their receiver. */
function splitStatements(body: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let round = 0;
  let curly = 0;
  let square = 0;
  const push = (end: number) => {
    const statement = body.slice(start, end).trim();
    if (statement) statements.push(statement);
  };
  const nextContinuesChain = (index: number): boolean => {
    let cursor = index;
    while (cursor < body.length) {
      if (/\s/u.test(body[cursor] ?? "")) {
        cursor += 1;
        continue;
      }
      if (body.startsWith("//", cursor)) {
        cursor = scanLineComment(body, cursor);
        continue;
      }
      if (body.startsWith("/*", cursor)) {
        cursor = scanBlockComment(body, cursor);
        continue;
      }
      break;
    }
    return body[cursor] === ".";
  };
  let cursor = 0;
  while (cursor < body.length) {
    const char = body[cursor]!;
    if (char === "'" || char === '"' || char === "`") {
      cursor = scanQuoted(body, cursor);
      continue;
    }
    if (char === "/" && body[cursor + 1] === "/") {
      const end = scanLineComment(body, cursor);
      cursor = end;
      continue;
    }
    if (char === "/" && body[cursor + 1] === "*") {
      cursor = scanBlockComment(body, cursor);
      continue;
    }
    if (char === "(") round += 1;
    else if (char === ")") round = Math.max(0, round - 1);
    else if (char === "{") curly += 1;
    else if (char === "}") curly = Math.max(0, curly - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    if (char === ";" && round === 0 && curly === 0 && square === 0) {
      push(cursor);
      cursor += 1;
      start = cursor;
      continue;
    }
    if (
      char === "\n" &&
      round === 0 &&
      curly === 0 &&
      square === 0 &&
      !nextContinuesChain(cursor + 1)
    ) {
      push(cursor);
      cursor += 1;
      start = cursor;
      continue;
    }
    cursor += 1;
  }
  push(body.length);
  return statements.map((statement) => statement.replace(/;+\s*$/u, "").trim()).filter(Boolean);
}

type CallArgument = { raw: string; value?: string };

function splitCallArguments(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let round = 0;
  let curly = 0;
  let square = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === "'" || char === '"' || char === "`") {
      cursor = scanQuoted(source, cursor);
      continue;
    }
    if (char === "(") round += 1;
    else if (char === ")") round = Math.max(0, round - 1);
    else if (char === "{") curly += 1;
    else if (char === "}") curly = Math.max(0, curly - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    if (char === "," && round === 0 && curly === 0 && square === 0) {
      parts.push(source.slice(start, cursor).trim());
      start = cursor + 1;
    }
    cursor += 1;
  }
  parts.push(source.slice(start).trim());
  return parts.filter((part) => part.length > 0);
}

/** Static string arguments of one method call. Dynamic values stay undefined,
 * which keeps the importer honest instead of guessing runtime data. */
function callArguments(expression: string, method: string): CallArgument[] | undefined {
  const at = expression.indexOf(`${method}(`);
  if (at < 0) return undefined;
  const open = at + method.length;
  const close = matchingDelimiter(expression, open, "(", ")");
  if (close < 0) return undefined;
  return splitCallArguments(expression.slice(open + 1, close)).map((raw) => {
    const literal = readStringLiteral(raw.trim(), 0);
    return {
      raw,
      ...(literal && literal.end === raw.trim().length ? { value: literal.value } : {}),
    };
  });
}

function staticArgument(expression: string, method: string, index: number): string | undefined {
  return callArguments(expression, method)?.[index]?.value;
}

function roleName(expression: string): { role: string; name: string } | undefined {
  const args = callArguments(expression, "getByRole");
  const role = args?.[0]?.value;
  const options = args?.[1]?.raw;
  if (!role || !options) return undefined;
  const nameMatch = /\bname\s*:\s*/u.exec(options);
  if (!nameMatch) return undefined;
  const start = nameMatch.index + nameMatch[0].length;
  const literal = readStringLiteral(options, start);
  return literal ? { role, name: literal.value } : undefined;
}

function unquoteTextTarget(value: string): string {
  const trimmed = value.trim();
  const literal = readStringLiteral(trimmed, 0);
  return literal && literal.end === trimmed.length ? literal.value : trimmed;
}

function textEngineTarget(raw: string): string | undefined {
  const match = /^text\s*=\s*([\s\S]+)$/iu.exec(raw.trim());
  return match ? unquoteTextTarget(match[1]!) : undefined;
}

function humanIdentifier(value: string): string {
  return value
    .replace(/[[\]#.]/gu, "")
    .replace(/[-_]+/gu, " ")
    .trim();
}

function technicalTarget(raw: string, noun: "control" | "field" | "element"): string | undefined {
  const value = raw.trim();
  const simpleId = /^#([A-Za-z][\w-]*)$/u.exec(value);
  if (simpleId) return `the ${noun} with identifier ${simpleId[1]}`;
  const dataTarget = /^\[data-(?:testid|test-id|test)=["']([^"']+)["']\]$/u.exec(value);
  if (dataTarget) return `the ${noun} with identifier ${dataTarget[1]}`;
  const inputName =
    /^input\[name=["']([^"']+)["']\]$/u.exec(value) ?? /^\[name=["']([^"']+)["']\]$/u.exec(value);
  if (inputName) {
    const human = humanIdentifier(inputName[1]!);
    return noun === "field" && human ? `the ${human} field` : `the ${noun} named ${human}`;
  }
  if (/^[A-Za-z][\w-]*$/u.test(value)) return `the ${noun} ${value}`;
  return undefined;
}

function clickTarget(raw: string): string | undefined {
  const text = textEngineTarget(raw);
  if (text) return `"${text}"`;
  return technicalTarget(raw, "control");
}

function clickStep(statement: string): ImportedStep | undefined {
  if (!/\.click\s*\(/u.test(statement) && !/\bpage\.click\s*\(/u.test(statement)) return undefined;
  const direct = staticArgument(statement, "page.click", 0);
  if (direct) {
    const target = clickTarget(direct);
    return target ? { kind: "instruction", intent: `Click ${target}` } : undefined;
  }
  const text = staticArgument(statement, "getByText", 0);
  if (text) return { kind: "instruction", intent: `Click "${text}"` };
  const role = roleName(statement);
  if (role) return { kind: "instruction", intent: `Click "${role.name}"` };
  const testId = staticArgument(statement, "getByTestId", 0);
  if (testId) {
    return {
      kind: "instruction",
      intent: `Click the control with identifier ${testId}`,
    };
  }
  const locator = staticArgument(statement, "locator", 0);
  if (locator) {
    const target = clickTarget(locator);
    return target ? { kind: "instruction", intent: `Click ${target}` } : undefined;
  }
  return undefined;
}

function fillStep(statement: string): ImportedStep | undefined {
  if (!/\.fill\s*\(/u.test(statement) && !/\bpage\.fill\s*\(/u.test(statement)) return undefined;
  const fillValue = staticArgument(statement, "fill", 0);
  const direct = callArguments(statement, "page.fill");
  if (direct) {
    const target = direct[0]?.value;
    const value = direct[1]?.value;
    if (!target || value === undefined) return undefined;
    const phrase = technicalTarget(target, "field");
    return phrase ? { kind: "instruction", intent: `Type "${value}" into ${phrase}` } : undefined;
  }
  if (fillValue === undefined) return undefined;
  for (const method of ["getByLabel", "getByPlaceholder"] as const) {
    const target = staticArgument(statement, method, 0);
    if (target) return { kind: "instruction", intent: `Type "${fillValue}" into ${target}` };
  }
  const role = roleName(statement);
  if (role) return { kind: "instruction", intent: `Type "${fillValue}" into ${role.name}` };
  const testId = staticArgument(statement, "getByTestId", 0);
  if (testId) {
    return {
      kind: "instruction",
      intent: `Type "${fillValue}" into the field with identifier ${testId}`,
    };
  }
  return undefined;
}

function keyboardStep(statement: string): ImportedStep | undefined {
  const key = staticArgument(statement, "page.keyboard.press", 0);
  return key ? { kind: "instruction", intent: `Press ${key}` } : undefined;
}

type Expectation = {
  locator: string;
  negative: boolean;
  kind: "visible" | "contains" | "exact-text";
  text?: string;
};

function expectation(statement: string): Expectation | undefined {
  const start = statement.search(/\bexpect\s*\(/u);
  if (start < 0) return undefined;
  const open = statement.indexOf("(", start);
  if (open < 0) return undefined;
  const close = matchingDelimiter(statement, open, "(", ")");
  if (close < 0) return undefined;
  const locator = statement.slice(open + 1, close).trim();
  let rest = statement.slice(close + 1).trimStart();
  let negative = false;
  if (rest.startsWith(".not")) {
    negative = true;
    rest = rest.slice(4).trimStart();
  }
  if (/^\.toBeVisible\s*\(/u.test(rest)) return { locator, negative, kind: "visible" };
  for (const [method, kind] of [
    ["toContainText", "contains"],
    ["toHaveText", "exact-text"],
  ] as const) {
    if (!rest.startsWith(`.${method}`)) continue;
    const text = staticArgument(rest, method, 0);
    return text === undefined ? undefined : { locator, negative, kind, text };
  }
  return undefined;
}

function locatorSubject(expression: string): string | undefined {
  const text = staticArgument(expression, "getByText", 0);
  if (text) return text;
  const role = roleName(expression);
  if (role) return `the ${role.role} "${role.name}"`;
  for (const method of ["getByLabel", "getByPlaceholder"] as const) {
    const label = staticArgument(expression, method, 0);
    if (label) return `the ${label} field`;
  }
  const testId = staticArgument(expression, "getByTestId", 0);
  if (testId) return `the control with identifier ${testId}`;
  const locator = staticArgument(expression, "locator", 0);
  if (locator) {
    const textTarget = textEngineTarget(locator);
    if (textTarget) return textTarget;
    return (
      technicalTarget(locator, "element") ?? `the element identified by ${compactCode(locator, 60)}`
    );
  }
  if (/^\s*page\s*$/u.test(expression)) return "the page";
  return undefined;
}

function expectationStep(statement: string): ImportedStep | undefined {
  const expected = expectation(statement);
  if (!expected) return undefined;
  const subject = locatorSubject(expected.locator);
  if (!subject) return undefined;
  const named = capitalizeThe(subject);
  if (expected.kind === "visible") {
    return {
      kind: "validation",
      intent: `${named} is ${expected.negative ? "not " : ""}visible`,
    };
  }
  if (expected.kind === "contains") {
    return {
      kind: "validation",
      intent: `${named} ${expected.negative ? "does not contain" : "contains"} "${expected.text}"`,
    };
  }
  return {
    kind: "validation",
    intent: `${named} text ${expected.negative ? "is not" : "is"} "${expected.text}"`,
  };
}

function unsupportedWarning(origin: string, index: number, statement: string): string {
  return `${origin} statement ${index + 1}: unsupported Playwright code: ${compactCode(statement, 100)}`;
}

function eventsFromStatements(
  statements: readonly string[],
  origin: string,
): { events: PlaywrightEvent[]; warnings: string[] } {
  const events: PlaywrightEvent[] = [];
  const warnings: string[] = [];
  statements.forEach((statement, index) => {
    const goto =
      staticArgument(statement, "page.goto", 0) ?? staticArgument(statement, "frame.goto", 0);
    if (goto) {
      events.push({ type: "goto", url: goto });
      return;
    }
    const click = clickStep(statement);
    if (click) {
      events.push({ type: "step", step: click });
      return;
    }
    const fill = fillStep(statement);
    if (fill) {
      events.push({ type: "step", step: fill });
      return;
    }
    const check = expectationStep(statement);
    if (check) {
      events.push({ type: "step", step: check });
      return;
    }
    const key = keyboardStep(statement);
    if (key) {
      events.push({ type: "step", step: key });
      return;
    }
    warnings.push(unsupportedWarning(origin, index, statement));
  });
  return { events, warnings };
}

function httpUrl(value: string, base?: string): string | undefined {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function materializeTest(input: {
  events: readonly PlaywrightEvent[];
  overrides: ImportOverrides;
  warnings: string[];
  sourceName: string;
  testTitle: string;
}): { app?: string; url?: string; steps: ImportedStep[] } {
  if (input.overrides.url && !/^https?:\/\/\S+$/iu.test(input.overrides.url)) {
    throw new UsageError(`${input.sourceName}: input url must start with http:// or https://`);
  }
  const steps: ImportedStep[] = [];
  let url: string | undefined;
  let firstGoto = true;
  for (const event of input.events) {
    if (event.type === "step") {
      steps.push(event.step);
      continue;
    }
    const resolved = httpUrl(event.url, input.overrides.url);
    if (firstGoto && steps.length === 0 && resolved) {
      url = resolved;
    } else {
      if (firstGoto && !resolved && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(event.url)) {
        input.warnings.push(
          `the first page.goto target ${compactCode(event.url, 80)} is not an http(s) Relay start URL; it was kept as a step`,
        );
      }
      steps.push({ kind: "instruction", intent: `Open ${resolved ?? event.url}` });
    }
    firstGoto = false;
  }
  if (!url && input.overrides.url) url = input.overrides.url;
  const app = input.overrides.app;
  if (!url && !app) {
    throw new UsageError(
      `${input.sourceName}: no absolute page.goto or input url/app gives this test a target.`,
    );
  }
  if (!steps.length) {
    throw new UsageError(
      `${input.sourceName}: no high-confidence Playwright actions or checks were found in ${input.testTitle}.`,
    );
  }
  return { ...(app ? { app } : {}), ...(url ? { url } : {}), steps };
}

/** Best-effort conversion of Playwright specs. Each static test block becomes
 * one Relay test; beforeEach bodies are prepended because they execute first. */
export function convertPlaywrightSpec(input: {
  source: string;
  sourceName: string;
  fileName: string;
  overrides?: ImportOverrides;
}): ConvertedImportTest[] {
  const tests = scanTestBlocks(input.source);
  if (!tests.length) {
    throw new UsageError(`${input.sourceName}: no static test(...) block was found.`);
  }
  const hooks = scanBeforeEachBlocks(input.source);
  const hookResults = hooks.map((hook, index) =>
    eventsFromStatements(splitStatements(hook.body), `beforeEach ${index + 1}`),
  );
  const hookEvents = hookResults.flatMap((result) => result.events);
  const hookWarnings = hookResults.flatMap((result) => result.warnings);
  if (hooks.length) {
    hookWarnings.unshift(
      "beforeEach statements were merged into every imported test; review hook scope",
    );
  }
  const baseStem = kebabFileStem(input.fileName);
  return tests.map((block, index) => {
    const testTitle = block.title?.trim() || humanizeFileStem(input.fileName);
    const converted = eventsFromStatements(splitStatements(block.body), `test ${index + 1}`);
    const mutableWarnings = uniqueWarnings([...hookWarnings, ...converted.warnings]);
    const materialized = materializeTest({
      events: [...hookEvents, ...converted.events],
      overrides: input.overrides ?? {},
      warnings: mutableWarnings,
      sourceName: input.sourceName,
      testTitle,
    });
    const warnings = uniqueWarnings(mutableWarnings);
    const name = input.overrides?.name?.trim() || testTitle;
    const yaml = renderRelayTestYaml({
      name,
      ...materialized,
      comments: importComments("playwright", input.sourceName, warnings),
    });
    const titleStem = kebabFileStem(`${testTitle}.yaml`);
    return {
      sourceName: input.sourceName,
      outputFileName: tests.length === 1 ? `${baseStem}.yaml` : `${baseStem}-${titleStem}.yaml`,
      name,
      yaml,
      warnings,
      stepCount: materialized.steps.length,
    };
  });
}
