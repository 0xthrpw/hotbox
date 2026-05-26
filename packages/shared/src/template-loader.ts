import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemplateSchema, type Template } from './templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(here, '..', 'templates');

const cache = new Map<string, Template>();

export async function loadTemplate(name: string): Promise<Template> {
  const cached = cache.get(name);
  if (cached) return cached;
  const raw = await readFile(join(TEMPLATES_DIR, `${name}.json`), 'utf8');
  const parsed = TemplateSchema.parse(JSON.parse(raw));
  cache.set(name, parsed);
  return parsed;
}

export async function listTemplates(): Promise<string[]> {
  const files = await readdir(TEMPLATES_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export function clearTemplateCache(): void {
  cache.clear();
}

/**
 * Apply the {svc} (and other) placeholders in a template, returning a deep clone.
 */
export function interpolateTemplate(template: Template, slug: string): Template {
  const replace = (s: string) => s.replaceAll('{svc}', slug);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return replace(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(template) as Template;
}
