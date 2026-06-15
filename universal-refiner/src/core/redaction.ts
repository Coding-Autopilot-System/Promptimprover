export const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set_cookie",
  "password",
  "passwd",
  "pwd",
  "secret",
  "clientsecret",
  "client_secret",
  "token",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "api_key",
  "apikey",
  "x_api_key",
  "private_key",
  "privatekey",
  "connection_string",
  "connectionstring",
  "accountkey",
  "sig",
  "aws_access_key_id",
  "aws_secret_access_key",
  "azure_client_secret",
  "openai_api_key",
  "github_token",
  "gitlab_token",
  "database_url",
  "redis_url",
]);
const SENSITIVE_FILE = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|service-account(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:key|pem|p12|pfx))$/i;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT_PATTERN = /(\b(?:authorization|password|passwd|pwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|private[_-]?key|connection[_-]?string|accountkey|sig|token|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)|azure[_-]?client[_-]?secret|openai[_-]?api[_-]?key|github[_-]?token|gitlab[_-]?token|database[_-]?url|redis[_-]?url)\b\s*[:=]\s*)(["']?)([^"',;&#\s}\]]+)\2/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i;
const CREDENTIAL_LITERAL_PATTERN = /\b(?:authorization|password|passwd|pwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|private[_-]?key|connection[_-]?string|accountkey|sig|token|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)|azure[_-]?client[_-]?secret|openai[_-]?api[_-]?key|github[_-]?token|gitlab[_-]?token|database[_-]?url|redis[_-]?url)\b\s*[:=]\s*(?:(["'])[^"'\r\n]{8,}\1|[A-Za-z0-9._~+/=-]{16,})/i;
const URL_SECRET_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/(?:[^/\s:@]+:[^@\s]+@|[^\s?#]+[?&](?:password|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|x-api-key|accountkey|sig|token)=)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.replace(/[-\s]/g, "_").toLowerCase());
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return value;
  }
}

/** Redacts secrets embedded in free-form text, including URL credentials and query parameters. */
export function redactString(value: string): string {
  return value
    .replace(URL_PATTERN, redactUrl)
    .replace(BEARER_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(ASSIGNMENT_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}${REDACTED}${quote}`);
}

function redactRecursive(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : "",
    };
  }

  if (Array.isArray(value)) return value.map(item => redactRecursive(item, seen));

  try {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? REDACTED : redactRecursive(item, seen),
      ]),
    );
  } catch {
    return REDACTED;
  }
}

/** Produces a log-safe recursive clone without mutating the caller's value. */
export function redact(value: unknown): unknown {
  return redactRecursive(value, new WeakSet<object>());
}

export function isSensitiveFilename(filePath: string): boolean {
  const filename = filePath.replace(/\\/g, "/").split("/").pop() || "";
  return SENSITIVE_FILE.test(filename);
}

/** Returns true when source content appears to contain credential material rather than references to environment variables. */
export function containsSensitiveContent(content: string): boolean {
  BEARER_PATTERN.lastIndex = 0;
  if (PRIVATE_KEY_PATTERN.test(content) || BEARER_PATTERN.test(content)) return true;
  return CREDENTIAL_LITERAL_PATTERN.test(content) || URL_SECRET_PATTERN.test(content);
}
