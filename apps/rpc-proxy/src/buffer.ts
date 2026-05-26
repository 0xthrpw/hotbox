import type { HotboxDb } from '@hotbox/db';

export interface RpcLogRow {
  token_id: string | null;
  service_id: string;
  method: string;
  params_bytes: number;
  response_bytes: number;
  latency_ms: number;
  status: number;
  error_code: string | null;
}

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_THRESHOLD = 1000;

export class RequestLogBuffer {
  private buf: RpcLogRow[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: HotboxDb) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  push(row: RpcLogRow): void {
    this.buf.push(row);
    if (this.buf.length >= FLUSH_THRESHOLD) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buf.length === 0) return;
    const batch = this.buf;
    this.buf = [];
    try {
      await this.db.insertInto('rpc_requests').values(batch).execute();
    } catch (err) {
      console.error('rpc-proxy: failed to flush requests', err);
      // Best-effort: drop the batch rather than retry forever and OOM.
    }
  }
}
