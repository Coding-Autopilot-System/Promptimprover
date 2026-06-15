import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "GitHub personal access token", expression: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: "OpenAI API key", expression: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Azure storage connection string", expression: /\bDefaultEndpointsProtocol=https?;AccountName=[^;\s]+;AccountKey=[^;\s]+/gi },
  { name: "Private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const ALLOWED_FIXTURE_MARKER = "secret-scan: allow-fixture";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes(ALLOWED_FIXTURE_MARKER)) continue;

  for (const pattern of PATTERNS) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(content)) findings.push(`${pattern.name}: ${file}`);
  }
}

if (findings.length > 0) {
  console.error(`Secret scan failed:\n${findings.join("\n")}`);
  process.exit(1);
}

console.log(`Secret scan passed for ${files.length} tracked files.`);
