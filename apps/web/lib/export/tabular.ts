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
  let str = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  // Preserve numeric cells; escape strings Excel/LibreOffice can execute.
  if(typeof value==='string' && /^[\s\u0000-\u001f]*[=+@-]/.test(str)) str="'"+str;
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
/** Pull-driven writes keep one small byte queue; cancellation rejects the producer. */
class ByteStreamWriter {
  private transform = new TransformStream<Uint8Array,Uint8Array>(undefined,
    {highWaterMark:64*1024,size:chunk=>chunk.byteLength},
    {highWaterMark:64*1024,size:chunk=>chunk.byteLength});
  private writer=this.transform.writable.getWriter();
  private encoder=new TextEncoder();
  private closed=false;
  constructor(){void this.writer.closed.catch(()=>{this.closed=true;});}
  protected async enqueue(line:string):Promise<void>{
    if(this.closed)throw new Error('Export stream closed');
    try {await this.writer.write(this.encoder.encode(line));}
    catch(error){this.closed=true;throw error instanceof Error?error:new Error("Export stream cancelled");}
  }
  async close():Promise<void>{if(this.closed)return;this.closed=true;await this.writer.close();}
  async abort(reason:unknown):Promise<void>{this.closed=true;await this.writer.abort(reason).catch(()=>{});}
  toReadableStream():ReadableStream<Uint8Array>{return this.transform.readable;}
}
export class DelimitedStreamWriter extends ByteStreamWriter {
  constructor(private delimiter:','|'\t'){super();}
  writeHeader(fields:string[]):Promise<void>{return this.writeRow(fields);}
  writeRow(values:DelimitedValue[]):Promise<void>{return this.enqueue(values.map(v=>escapeDelimitedValue(v,this.delimiter)).join(this.delimiter)+'\r\n');}
}
export function createDelimitedStream(delimiter:','|'\t'):DelimitedStreamWriter{return new DelimitedStreamWriter(delimiter);}
export class PlainLineStreamWriter extends ByteStreamWriter {
  async writeLine(value:string|null|undefined):Promise<void>{if(value)await this.enqueue(value.replace(/[\r\n]/g,'')+'\n');}
}
export function createPlainLineStream():PlainLineStreamWriter{return new PlainLineStreamWriter();}

/** MIME content types for each supported export format. */
export const EXPORT_CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ndjson: "application/x-ndjson; charset=utf-8",
  txt: "text/plain; charset=utf-8",
} as const;
