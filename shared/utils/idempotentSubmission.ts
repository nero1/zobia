/** Preserve one financial submission across transport retries. Changing form
 * inputs starts a new operation; relative campaign dates stay frozen on retry. */
export function createIdempotentSubmission(relativeWindow = false) {
  let pending: { fingerprint: string; body: Record<string, unknown> } | null =
    null;
  return {
    prepare<T extends Record<string, unknown>>(
      body: T,
    ): T & { idempotencyKey: string } {
      const identity = relativeWindow
        ? {
            ...body,
            startsAt: undefined,
            endsAt: undefined,
            durationMs:
              body.startsAt && body.endsAt
                ? Date.parse(String(body.endsAt)) -
                  Date.parse(String(body.startsAt))
                : null,
          }
        : body;
      const fingerprint = JSON.stringify(identity);
      if (!pending || pending.fingerprint !== fingerprint)
        pending = {
          fingerprint,
          body: { ...body, idempotencyKey: crypto.randomUUID() },
        };
      return pending.body as T & { idempotencyKey: string };
    },
    clear() {
      pending = null;
    },
  };
}
