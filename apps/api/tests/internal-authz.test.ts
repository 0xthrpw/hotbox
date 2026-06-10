import { describe, it, expect } from 'vitest';
import { tokenFromForwardedUri } from '../src/routes/internal-authz.js';

describe('api/internal-authz tokenFromForwardedUri', () => {
  it('extracts a token-shaped first path segment', () => {
    expect(tokenFromForwardedUri('/hbx_rpc_abc-123')).toBe('hbx_rpc_abc-123');
  });

  it('accepts the full base64url alphabet', () => {
    expect(tokenFromForwardedUri('/hbx_rpc_a1B2-c_D3')).toBe('hbx_rpc_a1B2-c_D3');
  });

  it('ignores a query string after the token', () => {
    expect(tokenFromForwardedUri('/hbx_rpc_abc?id=1')).toBe('hbx_rpc_abc');
  });

  it('ignores trailing path segments after the token', () => {
    expect(tokenFromForwardedUri('/hbx_rpc_abc/')).toBe('hbx_rpc_abc');
    expect(tokenFromForwardedUri('/hbx_rpc_abc/extra')).toBe('hbx_rpc_abc');
  });

  it('returns null for non-token paths', () => {
    expect(tokenFromForwardedUri('/')).toBeNull();
    expect(tokenFromForwardedUri('/eth_blockNumber')).toBeNull();
    expect(tokenFromForwardedUri('/api/hbx_rpc_abc')).toBeNull();
  });

  it('returns null for empty or missing uri', () => {
    expect(tokenFromForwardedUri('')).toBeNull();
    expect(tokenFromForwardedUri(undefined)).toBeNull();
  });

  it('requires the hbx_<kind>_ prefix shape', () => {
    expect(tokenFromForwardedUri('/hbx_rpc_')).toBeNull();
    expect(tokenFromForwardedUri('/hbxrpc_abc')).toBeNull();
    expect(tokenFromForwardedUri('/hbx_RPC_abc')).toBeNull();
  });
});
