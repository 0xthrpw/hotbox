import { describe, it, expect } from 'vitest';
import { parseCommandLine } from '../src/command.js';

describe('parseCommandLine', () => {
  it('splits on whitespace', () => {
    expect(parseCommandLine('postgres -c wal_level=logical')).toEqual([
      'postgres',
      '-c',
      'wal_level=logical',
    ]);
  });

  it('collapses runs of whitespace and trims ends', () => {
    expect(parseCommandLine('  a   b\tc ')).toEqual(['a', 'b', 'c']);
  });

  it('groups double-quoted arguments', () => {
    expect(parseCommandLine('sh -c "echo hi there"')).toEqual(['sh', '-c', 'echo hi there']);
  });

  it('groups single-quoted arguments and preserves double quotes inside', () => {
    expect(parseCommandLine(`sh -c 'echo "hi"'`)).toEqual(['sh', '-c', 'echo "hi"']);
  });

  it('supports quotes joined to a token', () => {
    expect(parseCommandLine(`--opt="a b"`)).toEqual(['--opt=a b']);
  });

  it('produces an empty arg from bare quotes', () => {
    expect(parseCommandLine(`a "" b`)).toEqual(['a', '', 'b']);
  });

  it('throws on an unbalanced quote', () => {
    expect(() => parseCommandLine('sh -c "echo hi')).toThrow(/unbalanced/);
    expect(() => parseCommandLine("it's broken")).toThrow(/unbalanced/);
  });

  it('returns [] for an empty or whitespace-only line', () => {
    expect(parseCommandLine('')).toEqual([]);
    expect(parseCommandLine('   ')).toEqual([]);
  });
});
