/**
 * Split a human-typed command line into an exec-form argv for docker
 * Cmd/Entrypoint. UX convenience only — the resulting array is passed to the
 * Docker Engine API directly and no shell is ever involved, so there is no
 * escaping/injection surface here; we just need predictable tokenization.
 *
 * Supports single and double quotes (no escapes inside them — this is not a
 * shell, and pretending to be one invites confusion). Throws on an unbalanced
 * quote so the UI can surface the mistake instead of silently mangling args.
 */
export function parseCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | null = null;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (inToken) {
        args.push(current);
        current = '';
        inToken = false;
      }
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (quote) throw new Error(`unbalanced ${quote} quote in command`);
  if (inToken) args.push(current);
  return args;
}
