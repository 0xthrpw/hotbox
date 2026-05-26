/**
 * Minimal Prometheus text-format parser. Handles:
 *   - comments and # HELP / # TYPE lines (ignored)
 *   - simple `metric value` lines
 *   - `metric{label="v",label2="v2"} value` lines
 *   - optional trailing timestamp (ignored — we use scrape time)
 *
 * Does NOT handle exemplars, NaN / +Inf / -Inf parsing (skipped), or
 * histogram/summary buckets specially (they come through as plain
 * `_bucket` / `_sum` / `_count` series, which is what we want anyway).
 */

export interface PromSample {
  metric: string;
  labels: Record<string, string>;
  value: number;
}

export function parseProm(text: string): PromSample[] {
  const out: PromSample[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const lbraceIdx = line.indexOf('{');
    let metric: string;
    let labels: Record<string, string> = {};
    let rest: string;

    if (lbraceIdx === -1) {
      const sp = line.indexOf(' ');
      if (sp === -1) continue;
      metric = line.slice(0, sp);
      rest = line.slice(sp + 1).trim();
    } else {
      metric = line.slice(0, lbraceIdx);
      const rbraceIdx = line.indexOf('}', lbraceIdx);
      if (rbraceIdx === -1) continue;
      labels = parseLabels(line.slice(lbraceIdx + 1, rbraceIdx));
      rest = line.slice(rbraceIdx + 1).trim();
    }

    const valueStr = rest.split(/\s+/)[0];
    if (!valueStr) continue;
    const value = parseFloat(valueStr);
    if (!Number.isFinite(value)) continue;

    out.push({ metric, labels, value });
  }
  return out;
}

function parseLabels(s: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const eq = s.indexOf('=', i);
    if (eq < 0) break;
    const name = s.slice(i, eq).trim();
    if (s[eq + 1] !== '"') break;
    let end = eq + 2;
    let value = '';
    while (end < s.length) {
      const ch = s[end];
      if (ch === '\\' && end + 1 < s.length) {
        const next = s[end + 1];
        value += next === 'n' ? '\n' : next ?? '';
        end += 2;
        continue;
      }
      if (ch === '"') break;
      value += ch;
      end += 1;
    }
    labels[name] = value;
    i = end + 1;
    while (i < s.length && (s[i] === ',' || s[i] === ' ')) i += 1;
  }
  return labels;
}
