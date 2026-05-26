/**
 * Allowed/denied JSON-RPC namespaces by token tier.
 * - block: never allowed for anyone
 * - public: allowed for tier=public AND tier=internal
 * - internal: only allowed for tier=internal
 */
const BLOCKED_PREFIXES = ['admin_', 'personal_', 'miner_'];
const INTERNAL_ONLY_PREFIXES = ['debug_', 'erigon_'];

export type Decision =
  | { kind: 'allow' }
  | { kind: 'block'; reason: string }
  | { kind: 'rewrite_error'; reason: string; code: number };

export function decide(method: string, tier: 'public' | 'internal'): Decision {
  for (const p of BLOCKED_PREFIXES) {
    if (method.startsWith(p)) return { kind: 'block', reason: `${p}* methods are disabled` };
  }
  if (tier !== 'internal') {
    for (const p of INTERNAL_ONLY_PREFIXES) {
      if (method.startsWith(p)) {
        return { kind: 'block', reason: `${p}* requires internal token` };
      }
    }
  }
  return { kind: 'allow' };
}

const MAX_GETLOGS_BLOCK_RANGE = 10_000;

/**
 * Mutates the params array to enforce server-side limits. Returns an error
 * string if the request is unsalvageable.
 */
export function applyParamLimits(method: string, params: unknown): string | null {
  if (method !== 'eth_getLogs') return null;
  if (!Array.isArray(params) || params.length === 0) return null;
  const filter = params[0];
  if (typeof filter !== 'object' || filter === null) return null;
  const f = filter as { fromBlock?: unknown; toBlock?: unknown };
  const from = parseBlockTag(f.fromBlock);
  const to = parseBlockTag(f.toBlock);
  if (from !== null && to !== null && to - from > MAX_GETLOGS_BLOCK_RANGE) {
    return `eth_getLogs block range exceeds ${MAX_GETLOGS_BLOCK_RANGE}`;
  }
  return null;
}

function parseBlockTag(tag: unknown): number | null {
  if (typeof tag !== 'string') return null;
  if (tag.startsWith('0x')) return parseInt(tag, 16);
  return null;
}
