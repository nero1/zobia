import pino from "pino";
import {
  safeLogError,
  privacyLogOptions,
  monitoringError,
  safeMonitoringContext,
  safeLogRecord,
} from "../logPrivacy";
it("keeps error classification and source locations while discarding SQL values, messages, causes and transport configuration", () => {
  const secret = "PRIVATE_MARKER_4f2d";
  const cause = Object.assign(new Error("duplicate email " + secret), {
    code: "23505",
    detail: secret,
  });
  const error = Object.assign(
    new Error("Failed query INSERT private: " + secret),
    {
      cause,
      query: secret,
      params: [secret],
      config: { headers: { Authorization: "Bearer " + secret } },
      code: "ECONNRESET",
    },
  );
  const safe = safeLogError(error);
  expect(safe.code).toBe("ECONNRESET");
  expect(safe.cause?.code).toBe("23505");
  expect(safe.frames?.length).toBeGreaterThan(0);
  expect(JSON.stringify(safe)).not.toContain(secret);
  const sent = monitoringError(error);
  expect(sent.message).toContain("ECONNRESET");
  expect(JSON.stringify(sent)).not.toContain(secret);
  expect(sent.stack).not.toContain(secret);
  expect(
    safeMonitoringContext({
      requestId: "request-1",
      userId: "user-1",
      body: secret,
      email: "private@example.invalid",
      route: "/api/items?secret=" + secret,
    }),
  ).toEqual({ requestId: "request-1", userId: "user-1" });
});
it("redacts ordinary structured secret fields in a real pino output record", () => {
  let output = "";
  const log = pino(
    { ...privacyLogOptions, base: null, timestamp: false },
    {
      write(chunk: string) {
        output += chunk;
      },
    },
  );
  const secret = "PRIVATE_MARKER_9a3b";
  log.error(
    {
      err: Object.assign(new Error(secret), { params: [secret] }),
      requestId: "request-2",
      nested: {
        failure: Object.assign(new Error(secret), { params: [secret] }),
        deep: { config: { headers: { Authorization: secret } } },
      },
      password: secret,
      email: secret,
      request: { headers: { Authorization: secret, Cookie: secret } },
      payload: { text: secret },
    },
    "Operation failed",
  );
  expect(output).toContain("request-2");
  expect(output).not.toContain(secret);
  expect(JSON.parse(output).err.type).toBe("Error");
});
it("bounds causes, rejects non-errors and ignores fabricated/custom stack strings", () => {
  const error = new Error("private");
  (error as Error & { cause?: unknown }).cause = error;
  expect(safeLogError(error).cause).toBeUndefined();
  expect(
    safeLogError({ message: "private", config: { token: "private" } }),
  ).toEqual({ type: "NonError" });
  error.stack = "at PRIVATE_MARKER (/private:1:2)";
  expect(safeLogError(error).frames).toBeUndefined();
});

it("bounds structured record traversal and strips nested errors under arbitrary keys", () => {
  const record: Record<string, unknown> = {
    nested: { failure: new Error("private details") },
  };
  record.self = record;
  expect(JSON.stringify(safeLogRecord(record))).not.toContain(
    "private details",
  );
  expect(JSON.stringify(safeLogRecord(record))).toContain("[Circular]");
  const deep = {
    rows: Array.from({ length: 10000 }, () => ({ value: "x".repeat(10000) })),
  };
  const text = JSON.stringify(safeLogRecord(deep));
  expect(text.length).toBeLessThan(100000);
});
