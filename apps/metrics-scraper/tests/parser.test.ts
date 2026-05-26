import { describe, it, expect } from 'vitest';
import { parseProm } from '../src/parser.js';

describe('metrics-scraper/parseProm', () => {
  it('parses a label-less metric', () => {
    const out = parseProm('process_resident_memory_bytes 123456\n');
    expect(out).toEqual([{ metric: 'process_resident_memory_bytes', labels: {}, value: 123456 }]);
  });

  it('parses metrics with labels', () => {
    const out = parseProm('sync_stage_progress{stage="Headers"} 0.92\nsync_stage_progress{stage="Bodies"} 1\n');
    expect(out).toEqual([
      { metric: 'sync_stage_progress', labels: { stage: 'Headers' }, value: 0.92 },
      { metric: 'sync_stage_progress', labels: { stage: 'Bodies' }, value: 1 },
    ]);
  });

  it('skips comment and TYPE/HELP lines', () => {
    const text = `# HELP foo bar
# TYPE foo counter
foo 42
`;
    expect(parseProm(text)).toEqual([{ metric: 'foo', labels: {}, value: 42 }]);
  });

  it('ignores blank lines and surrounding whitespace', () => {
    expect(parseProm('\n\nfoo 1\n\n')).toEqual([{ metric: 'foo', labels: {}, value: 1 }]);
  });

  it('drops malformed values (NaN, +Inf)', () => {
    const out = parseProm('a 1\nb NaN\nc +Inf\nd 2\n');
    expect(out.map((s) => s.metric)).toEqual(['a', 'd']);
  });

  it('ignores any trailing timestamp', () => {
    const out = parseProm('foo 7 1700000000000\n');
    expect(out).toEqual([{ metric: 'foo', labels: {}, value: 7 }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseProm('')).toEqual([]);
  });
});
