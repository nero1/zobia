/**
 * lib/export/tabular.ts
 *
 * Streaming CSV/TSV writer utility, generalized from the escaping convention
 * already used in app/api/business/pages/stats/export/route.ts and
 * app/api/blogs/[slug]/stats/export/route.ts.
 *
 * Designed to be fed rows incrementally (batch-by-batch from the DB) so a
 * multi-million-row export never needs the whole dataset in memory — feed it
 * one keyset-paginated batch at a time and the underlying ReadableStream
 * backpressures naturally when the HTTP response is being streamed out.
 *
 * @example
 * ```ts
 * const writer = createDelimitedStream(',');
 * writer.writeHeader(['id', 'email']);
 * for (const batch of batches) {
 *   for (const row of batch) writer.writeRow([row.id, row.email]);
 * }
 * writer.close();
 * return new NextResponse(writer.toReadableStream(), { headers: {...} });
 * ```
 */

export type DelimitedValue = string | number | boolean | null | undefined;

/**
 * Quote/escape a single value for CSV/TSV per RFC 4180-ish conventions: any
 * value containing the delimiter, a double quote, or a newline is wrapped in
 * double quotes, with internal double quotes doubled.
 */
export function escapeDelimitedValue(value: DelimitedValue, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Incremental CSV/TSV writer. Backed by a ReadableStream so it can be handed
 * straight to a NextResponse for real HTTP streaming (bytes are enqueued as
 * writeHeader/writeRow are called, not buffered into one giant string).
 */
export class DelimitedStreamWriter {
  private delimiter: string;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private stream: ReadableStream<Uint8Array>;
  private pending: string[] = [];
  private closed = false;

  constructor(delimiter: "," | "\t") {
    this.delimiter = delimiter;
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        // Flush anything queued before the stream was pulled (e.g. writeHeader
        // called synchronously right after construction).
        for (const chunk of this.pending) controller.enqueue(this.encoder.encode(chunk));
        this.pending = [];
        if (this.closed) controller.close();
      },
    });
  }

  private enqueue(line: string): void {
    if (this.controller) {
      this.controller.enqueue(this.encoder.encode(line));
    } else {
      this.pending.push(line);
    }
  }

  writeHeader(fields: string[]): void {
    this.enqueue(fields.map((f) => escapeDelimitedValue(f, this.delimiter)).join(this.delimiter) + "\r\n");
  }

  writeRow(values: DelimitedValue[]): void {
    this.enqueue(values.map((v) => escapeDelimitedValue(v, this.delimiter)).join(this.delimiter) + "\r\n");
  }

  close(): void {
    this.closed = true;
    if (this.controller) {
      this.controller.close();
    }
  }

  toReadableStream(): ReadableStream<Uint8Array> {
    return this.stream;
  }
}

/**
 * Create a streaming CSV (',') or TSV ('\t') writer.
 */
export function createDelimitedStream(delimiter: "," | "\t"): DelimitedStreamWriter {
  return new DelimitedStreamWriter(delimiter);
}

/** MIME content types for each supported export format. */
export const EXPORT_CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ndjson: "application/x-ndjson; charset=utf-8",
} as const;
