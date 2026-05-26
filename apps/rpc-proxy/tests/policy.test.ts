import { describe, it, expect } from 'vitest';
import { decide, applyParamLimits } from '../src/policy.js';

describe('rpc-proxy/policy decide()', () => {
  it('always blocks admin_*, personal_*, miner_*', () => {
    for (const m of ['admin_addPeer', 'personal_listAccounts', 'miner_start']) {
      expect(decide(m, 'public').kind).toBe('block');
      expect(decide(m, 'internal').kind).toBe('block');
    }
  });

  it('gates debug_* and erigon_* to internal tier only', () => {
    expect(decide('debug_traceTransaction', 'public').kind).toBe('block');
    expect(decide('debug_traceTransaction', 'internal').kind).toBe('allow');
    expect(decide('erigon_getHeaderByNumber', 'public').kind).toBe('block');
    expect(decide('erigon_getHeaderByNumber', 'internal').kind).toBe('allow');
  });

  it('allows standard namespaces for both tiers', () => {
    for (const m of ['eth_call', 'eth_getLogs', 'net_version', 'web3_clientVersion', 'trace_block', 'txpool_status']) {
      expect(decide(m, 'public').kind).toBe('allow');
      expect(decide(m, 'internal').kind).toBe('allow');
    }
  });
});

describe('rpc-proxy/policy applyParamLimits()', () => {
  it('ignores non-getLogs methods', () => {
    expect(applyParamLimits('eth_call', [{}])).toBeNull();
    expect(applyParamLimits('eth_blockNumber', [])).toBeNull();
  });

  it('passes through getLogs with a small range', () => {
    expect(applyParamLimits('eth_getLogs', [{ fromBlock: '0x1000', toBlock: '0x2000' }])).toBeNull();
  });

  it('rejects getLogs with a 50k-block range', () => {
    const err = applyParamLimits('eth_getLogs', [{ fromBlock: '0x0', toBlock: '0xc350' }]);
    expect(err).toMatch(/10000/);
  });

  it('passes through getLogs missing block tags (tagged blocks like "latest")', () => {
    expect(applyParamLimits('eth_getLogs', [{ fromBlock: 'latest' }])).toBeNull();
    expect(applyParamLimits('eth_getLogs', [{}])).toBeNull();
  });
});
