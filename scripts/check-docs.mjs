import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = resolve(repositoryRoot, "README.md");
const packagePath = resolve(repositoryRoot, "package.json");

function bashBlocks(markdown) {
  return [...markdown.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function localLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter((target) => target.startsWith("./"))
    .map((target) => target.split("#", 1)[0]);
}

function documentedPnpmScripts(markdown) {
  const scripts = new Set();
  for (const block of bashBlocks(markdown)) {
    for (const line of block.split("\n")) {
      const command = line.trim().match(/^pnpm\s+(?!run\s+|--filter\s+|exec\s+)([^\s\\]+)/)?.[1];
      if (command) scripts.add(command);
      const runCommand = line.trim().match(/^pnpm\s+run\s+([^\s\\]+)/)?.[1];
      if (runCommand) scripts.add(runCommand);
    }
  }
  return scripts;
}

const [readme, packageSource] = await Promise.all([
  readFile(readmePath, "utf8"),
  readFile(packagePath, "utf8"),
]);
const packageJson = JSON.parse(packageSource);
const violations = [];

for (const link of localLinks(readme)) {
  try {
    await access(resolve(repositoryRoot, link));
  } catch {
    violations.push(`README.md links to missing file: ${link}`);
  }
}

for (const command of documentedPnpmScripts(readme)) {
  if (!packageJson.scripts?.[command]) {
    violations.push(`README.md documents missing root script: pnpm ${command}`);
  }
}

for (const block of bashBlocks(readme)) {
  if (/^relay\s+/m.test(block)) {
    violations.push("README.md uses bare `relay`; use the verified `pnpm relay` workspace entry.");
  }
}

if (violations.length) {
  console.error("Documentation verification failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Documentation verification passed: ${localLinks(readme).length} local links and ${documentedPnpmScripts(readme).size} root commands checked.`,
  );
}
