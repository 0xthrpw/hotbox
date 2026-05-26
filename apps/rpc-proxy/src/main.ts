import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createDb } from '@hotbox/db';
import { decide, applyParamLimits } from './policy.js';
import { RequestLogBuffer } from './buffer.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: unknown;
}

const dbUrl = required('DATABASE_URL');
const upstream = required('UPSTREAM_URL');     // e.g. http://erigon:8545
const port = Number(process.env.PORT ?? 9090);

const db = createDb({ connectionString: dbUrl });
const buffer = new RequestLogBuffer(db);
buffer.start();

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('rpc-proxy handler crashed', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(port, () => console.log(`hotbox-rpc-proxy listening on :${port} -> ${upstream}`));

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  const tokenId = headerOne(req, 'x-hotbox-token-id');
  const tier = (headerOne(req, 'x-hotbox-token-tier') ?? 'public') as 'public' | 'internal';
  const serviceId = headerOne(req, 'x-hotbox-service-id');
  if (!serviceId) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('missing x-hotbox-service-id');
    return;
  }

  const body = await readBody(req);
  const t0 = Date.now();

  let parsed: JsonRpcRequest | JsonRpcRequest[];
  try {
    parsed = JSON.parse(body.toString('utf8')) as JsonRpcRequest | JsonRpcRequest[];
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
    logSingle(buffer, { tokenId, serviceId, method: 'parse_error', paramsBytes: body.length, responseBytes: 0, status: 400, latencyMs: 0, errorCode: '-32700' });
    return;
  }

  const calls = Array.isArray(parsed) ? parsed : [parsed];

  // Pre-check all calls; if any are rejected, short-circuit with per-call errors.
  const decisions = calls.map((c) => ({ call: c, decision: decide(c.method ?? '', tier) }));
  const limitErrors = calls.map((c) => applyParamLimits(c.method ?? '', c.params));

  if (decisions.some((d) => d.decision.kind === 'block') || limitErrors.some((e) => e !== null)) {
    const responses = decisions.map((d, i) => {
      const limit = limitErrors[i];
      if (d.decision.kind === 'block') {
        logSingle(buffer, { tokenId, serviceId, method: d.call.method, paramsBytes: byteLen(d.call.params), responseBytes: 0, status: 403, latencyMs: 0, errorCode: 'blocked' });
        return errorResponse(d.call.id, -32601, d.decision.reason);
      }
      if (limit) {
        logSingle(buffer, { tokenId, serviceId, method: d.call.method, paramsBytes: byteLen(d.call.params), responseBytes: 0, status: 400, latencyMs: 0, errorCode: 'range_limit' });
        return errorResponse(d.call.id, -32602, limit);
      }
      return null;
    });
    if (responses.every((r) => r !== null)) {
      const payload = Array.isArray(parsed) ? responses : responses[0];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    // Mixed allow/block: forward only allowed; reconstruct combined response.
    // For v1 simplicity, if any call is blocked we reject the whole batch.
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'mixed batches not supported when any call is blocked' }));
    return;
  }

  // Proxy upstream.
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unreachable' }));
    for (const c of calls) {
      logSingle(buffer, { tokenId, serviceId, method: c.method, paramsBytes: byteLen(c.params), responseBytes: 0, status: 502, latencyMs: Date.now() - t0, errorCode: 'upstream' });
    }
    return;
  }

  const responseBuf = Buffer.from(await upstreamResponse.arrayBuffer());
  res.writeHead(upstreamResponse.status, { 'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json' });
  res.end(responseBuf);

  const latencyMs = Date.now() - t0;
  const perCallBytes = Math.floor(responseBuf.length / calls.length);
  for (const c of calls) {
    logSingle(buffer, {
      tokenId,
      serviceId,
      method: c.method,
      paramsBytes: byteLen(c.params),
      responseBytes: perCallBytes,
      latencyMs,
      status: upstreamResponse.status,
      errorCode: upstreamResponse.ok ? null : String(upstreamResponse.status),
    });
  }
}

function errorResponse(id: JsonRpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function logSingle(
  buf: RequestLogBuffer,
  r: {
    tokenId: string | null;
    serviceId: string;
    method: string;
    paramsBytes: number;
    responseBytes: number;
    latencyMs: number;
    status: number;
    errorCode: string | null;
  },
): void {
  buf.push({
    token_id: r.tokenId,
    service_id: r.serviceId,
    method: r.method,
    params_bytes: r.paramsBytes,
    response_bytes: r.responseBytes,
    latency_ms: r.latencyMs,
    status: r.status,
    error_code: r.errorCode,
  });
}

function byteLen(p: unknown): number {
  if (p === undefined || p === null) return 0;
  return Buffer.byteLength(JSON.stringify(p));
}

function headerOne(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`missing env var: ${name}`); process.exit(1); }
  return v;
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    console.log(`got ${sig}, flushing buffer`);
    buffer.stop();
    await buffer.flush();
    server.close(() => db.destroy().then(() => process.exit(0)));
  });
}

