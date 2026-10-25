/** Read a PostgreSQL SQLSTATE through wrapped errors without exposing SQL or parameters. */
export function postgresErrorCode(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== 'object' || seen.has(current)) return undefined;
    seen.add(current);
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = cause;
  }
  return undefined;
}

/** Deliberately exclude error messages/stacks: Drizzle embeds query parameters in both. */
export function authFailureLogDetails(error: unknown): { code: string; databaseCode?: string } {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const databaseCode = postgresErrorCode(error);
  return {
    code: typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'AUTH_CALLBACK_FAILED',
    ...(databaseCode ? { databaseCode } : {}),
  };
}
