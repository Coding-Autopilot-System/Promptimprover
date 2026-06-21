import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "GitHub personal access token", expression: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: "OpenAI API key", expression: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Azure storage connection string", expression: /\bDefaultEndpointsProtocol=https?;AccountName=[^;\s]+;AccountKey=[^;\s]+/gi },
  { name: "Private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: "Credential assignment",
    expression: /\b(?:authorization|password|passwd|pwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|private[_-]?key|connection[_-]?string|accountkey|sig|token|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)|azure[_-]?client[_-]?secret|openai[_-]?api[_-]?key|github[_-]?token|gitlab[_-]?token|database[_-]?url|redis[_-]?url)\b\s*[:=]\s*(?:(["'])[^"'\r\n]{8,}\1|[A-Za-z0-9._~+/=-]{16,})/gi,
  },
  {
    name: "URL embedded credential",
    expression: /\b[a-z][a-z0-9+.-]*:\/\/(?:[^/\s:@]+:[^@\s]+@|[^\s?#]+[?&](?:password|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|accountkey|sig|token)=)/gi,
  },
];

const ALLOWED_FIXTURE_MARKER = "secret-scan: allow-fixture";
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
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

console.log(`Secret scan passed for ${files.length} tracked and untracked non-ignored files.`);
