const GITHUB_TOKEN_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[opsru]_[A-Za-z0-9_]{20,}\b/g,
  /\bghs_[A-Za-z0-9_]{20,}\b/g
];

const URL_CREDENTIAL_PATTERN = /https:\/\/([^/\s:@]+):([^@\s]+)@github\.com/gi;
const X_ACCESS_TOKEN_PATTERN = /x-access-token:([^@\s]+)@/gi;
const AUTH_HEADER_PATTERN = /\b(Bearer|token)\s+[A-Za-z0-9._\-]{20,}/gi;
const POSTGRES_URL_PATTERN = /\b(postgres(?:ql)?:\/\/[^:\s/@]+:)([^@\s]+)(@[^?\s]+(?:\?[^\s]*)?)/gi;
const DATABASE_URL_ASSIGNMENT_PATTERN = /\b(DATABASE_URL=)([^\s]+)/gi;

function processEnvSecretValues() {
  if (typeof process === "undefined") return [];
  return [
    process.env.ANTHROPIC_API_KEY,
    process.env.CLAUDE_CODE_API_KEY,
    process.env.DAYTONA_API_KEY,
    process.env.WORKPOWERS_SECRET_ENCRYPTION_KEY
  ].filter((value): value is string => Boolean(value));
}

export function redactSecrets(value: string, extraSecrets: string[] = []) {
  let redacted = value;

  for (const secret of [...processEnvSecretValues(), ...extraSecrets].filter(Boolean)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  redacted = redacted.replace(URL_CREDENTIAL_PATTERN, "https://$1:[REDACTED]@github.com");
  redacted = redacted.replace(X_ACCESS_TOKEN_PATTERN, "x-access-token:[REDACTED]@");
  redacted = redacted.replace(AUTH_HEADER_PATTERN, "$1 [REDACTED]");
  redacted = redacted.replace(DATABASE_URL_ASSIGNMENT_PATTERN, "$1[REDACTED]");
  redacted = redacted.replace(POSTGRES_URL_PATTERN, "$1[REDACTED]$3");

  for (const pattern of GITHUB_TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }

  return redacted;
}

export function redactCommandResult<T extends { stdout: string; stderr: string }>(result: T, extraSecrets: string[] = []): T {
  return {
    ...result,
    stdout: redactSecrets(result.stdout, extraSecrets),
    stderr: redactSecrets(result.stderr, extraSecrets)
  };
}
